import type { ChainTracker } from '@bsv/sdk';
import * as Toolbox from '@bsv/wallet-toolbox-client';
import type { Chain } from '@bsv/wallet-toolbox-client';

interface ChaintracksClientApi extends ChainTracker {
  startListening(): Promise<void>;
  listening(): Promise<void>;
  findHeaderForHeight(height: number): Promise<{ hash: string } | undefined>;
}

export type ChaintracksMode = 'local-primary' | 'remote-only';
export type ChaintracksConsistency =
  'unchecked' | 'agreed' | 'lagging' | 'diverged' | 'insufficient-references' | 'error';

export interface ChaintracksDeviceStatus {
  chain: Chain;
  mode: ChaintracksMode;
  phase: 'idle' | 'bootstrapping' | 'ready' | 'recovering' | 'error';
  activeSource: 'local' | 'remote-fallback';
  consistency: ChaintracksConsistency;
  checkpointHeight: number;
  localHeight?: number;
  localTipHash?: string;
  referenceHeight?: number;
  heightLag?: number;
  checkedAt?: string;
  storageBytes?: number;
  lastError?: string;
}

interface ManagedLocalTracker extends ChainTracker {
  getStatus?: () => Record<string, unknown>;
  getMode?: () => ChaintracksMode;
  setMode?: (mode: ChaintracksMode) => void;
  synchronize?: () => Promise<Record<string, unknown>>;
  checkConsistency?: () => Promise<Record<string, unknown>>;
  clearLocalData?: () => Promise<Record<string, unknown>>;
}

interface CreatedLocal {
  chaintracks: ChaintracksClientApi & {
    destroy?: () => Promise<void>;
    findChainTipHash?: () => Promise<string>;
  };
  storage?: {
    db?: { close: () => void };
    dbName?: string;
  };
  available: Promise<void>;
}

interface BulkFileDescriptor {
  chain?: string;
  fileName: string;
  fileHash?: string;
}

interface CheckpointManifest {
  checkpointHeight: number;
  files: Array<{ fileName: string }>;
}

const CHECKPOINT_HEIGHT = 899999;
const MODE_KEY = 'chaintracks-mode-v1';
const CACHE_NAME = 'chaintracks-bulk-v1';
const SYNC_INTERVAL_MS = 60_000;
const CONSISTENCY_INTERVAL_MS = 5 * 60_000;
const ARCADE_URLS: Record<'main' | 'test', string> = {
  main: 'https://arcade-v2-us-1.bsvblockchain.tech',
  test: 'https://arcade-v2-testnet-us-1.bsvblockchain.tech',
};

const optionalToolboxExport = (name: string): unknown =>
  (Toolbox as unknown as Record<string, unknown>)[name];

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class PackagedCheckpointCache {
  private manifest?: Promise<CheckpointManifest>;

  private async getManifest(): Promise<CheckpointManifest> {
    this.manifest ??= fetch(`${import.meta.env.BASE_URL}chaintracks/checkpoint.json`).then(
      async (response) => {
        if (!response.ok)
          throw new Error(`Packaged checkpoint manifest is unavailable (${response.status}).`);
        return (await response.json()) as CheckpointManifest;
      }
    );
    return await this.manifest;
  }

  private cacheRequest(file: BulkFileDescriptor): Request {
    const identity = encodeURIComponent(file.fileHash || file.fileName);
    return new Request(new URL(`/__chaintracks_bulk_cache__/${identity}`, window.location.origin));
  }

  async get(file: BulkFileDescriptor): Promise<Uint8Array | undefined> {
    if (file.chain === 'main') {
      const manifest = await this.getManifest();
      if (manifest.files.some((entry) => entry.fileName === file.fileName)) {
        const response = await fetch(
          `${import.meta.env.BASE_URL}chaintracks/${encodeURIComponent(file.fileName)}`
        );
        if (!response.ok)
          throw new Error(`Packaged checkpoint file is unavailable: ${file.fileName}`);
        return new Uint8Array(await response.arrayBuffer());
      }
    }

    if (typeof caches === 'undefined') return undefined;
    const response = await (await caches.open(CACHE_NAME)).match(this.cacheRequest(file));
    return response == null ? undefined : new Uint8Array(await response.arrayBuffer());
  }

  async set(file: BulkFileDescriptor, data: Uint8Array): Promise<void> {
    if (typeof caches === 'undefined') return;
    await (
      await caches.open(CACHE_NAME)
    ).put(
      this.cacheRequest(file),
      new Response(data.slice(), { headers: { 'content-type': 'application/octet-stream' } })
    );
  }

  async delete(file: BulkFileDescriptor): Promise<void> {
    if (typeof caches === 'undefined') return;
    await (await caches.open(CACHE_NAME)).delete(this.cacheRequest(file));
  }

  async clear(): Promise<void> {
    if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
  }
}

class CompatibilityLocalTracker implements ManagedLocalTracker {
  private mode: ChaintracksMode;
  private status: Record<string, unknown>;

  constructor(
    private readonly local: ChaintracksClientApi,
    private readonly fallbacks: ChaintracksClientApi[],
    mode: ChaintracksMode
  ) {
    this.mode = mode;
    this.status = {
      mode,
      activeSource: mode === 'remote-only' ? 'fallback' : 'local',
      consistency: 'unchecked',
    };
  }

  getMode(): ChaintracksMode {
    return this.mode;
  }

  setMode(mode: ChaintracksMode): void {
    this.mode = mode;
    this.status = {
      ...this.status,
      mode,
      activeSource: mode === 'remote-only' ? 'fallback' : 'local',
    };
  }

  getStatus(): Record<string, unknown> {
    return { ...this.status };
  }

  async currentHeight(): Promise<number> {
    if (this.mode === 'remote-only') return await this.remoteHeight();
    try {
      return await this.local.currentHeight();
    } catch {
      return await this.remoteHeight();
    }
  }

  async isValidRootForHeight(root: string, height: number): Promise<boolean> {
    if (this.mode !== 'remote-only') {
      try {
        return await this.local.isValidRootForHeight(root, height);
      } catch {
        // Exceptional compatibility fallback only.
      }
    }
    const results = await Promise.allSettled(
      this.fallbacks.map((source) => source.isValidRootForHeight(root, height))
    );
    const votes = results.filter((result) => result.status === 'fulfilled' && result.value).length;
    if (votes < Math.min(2, this.fallbacks.length)) {
      throw new Error('Independent header references did not reach fallback agreement.');
    }
    return true;
  }

  async synchronize(): Promise<Record<string, unknown>> {
    await this.local.startListening();
    await this.local.listening();
    return await this.checkConsistency();
  }

  async checkConsistency(): Promise<Record<string, unknown>> {
    const localHeight = await this.local.currentHeight();
    const localTip = await this.local.findHeaderForHeight(localHeight);
    const references = (
      await Promise.allSettled(
        this.fallbacks.map(async (source) => {
          const height = await source.currentHeight();
          return { source, height };
        })
      )
    )
      .filter(
        (
          result
        ): result is PromiseFulfilledResult<{ source: ChaintracksClientApi; height: number }> =>
          result.status === 'fulfilled'
      )
      .map((result) => result.value);

    if (references.length < 2) {
      this.status = {
        ...this.status,
        localHeight,
        localTipHash: localTip?.hash,
        consistency: 'insufficient-references',
        checkedAt: new Date().toISOString(),
      };
      return this.getStatus();
    }

    const referenceHeight = Math.min(...references.map((reference) => reference.height));
    const comparisonHeight = Math.min(localHeight, referenceHeight);
    const localAtComparison = await this.local.findHeaderForHeight(comparisonHeight);
    const hashes = await Promise.all(
      references.map(
        async (reference) => (await reference.source.findHeaderForHeight(comparisonHeight))?.hash
      )
    );
    const votes = new Map<string, number>();
    for (const hash of hashes) if (hash != null) votes.set(hash, (votes.get(hash) || 0) + 1);
    const expected = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const lag = referenceHeight - localHeight;
    const consistency: ChaintracksConsistency =
      expected == null || expected[1] < 2
        ? 'insufficient-references'
        : localAtComparison?.hash !== expected[0]
          ? 'diverged'
          : lag > 6
            ? 'lagging'
            : 'agreed';

    this.status = {
      ...this.status,
      localHeight,
      localTipHash: localTip?.hash,
      referenceHeight,
      heightLag: lag,
      consistency,
      checkedAt: new Date().toISOString(),
    };
    return this.getStatus();
  }

  private async remoteHeight(): Promise<number> {
    const results = await Promise.allSettled(
      this.fallbacks.map((source) => source.currentHeight())
    );
    const heights = results
      .filter((result): result is PromiseFulfilledResult<number> => result.status === 'fulfilled')
      .map((result) => result.value);
    if (heights.length === 0) throw new Error('No remote header reference is available.');
    return Math.max(...heights);
  }
}

class ChainTrackerProxy implements ChainTracker {
  constructor(
    private readonly manager: LocalChaintracksManager,
    private readonly chain: Chain
  ) {}

  async currentHeight(): Promise<number> {
    return await this.manager.currentTracker(this.chain).currentHeight();
  }

  async isValidRootForHeight(root: string, height: number): Promise<boolean> {
    return await this.manager.currentTracker(this.chain).isValidRootForHeight(root, height);
  }
}

export class LocalChaintracksManager {
  private tracker?: ManagedLocalTracker;
  private local?: CreatedLocal;
  private remote: ChaintracksClientApi[] = [];
  private proxy?: ChainTrackerProxy;
  private initializing?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private onlineHandler?: () => void;
  private lastConsistencyCheck = 0;
  private subscribers = new Set<() => void>();
  private status: ChaintracksDeviceStatus = {
    chain: 'main',
    mode: 'local-primary',
    phase: 'idle',
    activeSource: 'remote-fallback',
    consistency: 'unchecked',
    checkpointHeight: CHECKPOINT_HEIGHT,
  };

  getSnapshot = (): ChaintracksDeviceStatus => this.status;

  subscribe = (subscriber: () => void): (() => void) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  async getChainTracker(chain: Chain): Promise<ChainTracker> {
    if (this.proxy == null || this.status.chain !== chain)
      this.proxy = new ChainTrackerProxy(this, chain);
    void this.ensure(chain);
    return this.proxy;
  }

  currentTracker(chain: Chain): ChainTracker {
    if (this.status.chain !== chain) void this.ensure(chain);
    if (this.tracker != null) return this.tracker;
    if (this.remote.length === 0) this.remote = this.createRemoteReferences(chain);
    return this.remote[0];
  }

  async setMode(mode: ChaintracksMode): Promise<void> {
    localStorage.setItem(`${MODE_KEY}:${this.status.chain}`, mode);
    this.tracker?.setMode?.(mode);
    this.update({
      mode,
      activeSource: mode === 'remote-only' || this.tracker == null ? 'remote-fallback' : 'local',
    });
  }

  async syncNow(): Promise<void> {
    await this.ensure(this.status.chain);
    if (this.tracker?.synchronize == null) throw new Error('Local ChainTracks is not ready.');
    this.update({ phase: 'bootstrapping', lastError: undefined });
    try {
      const next = await this.tracker.synchronize();
      await this.applyTrackerStatus(next);
      this.update({ phase: 'ready' });
    } catch (error) {
      this.update({ phase: 'error', consistency: 'error', lastError: errorMessage(error) });
      throw error;
    }
  }

  async checkConsistency(): Promise<void> {
    await this.ensure(this.status.chain);
    if (this.tracker?.checkConsistency == null) throw new Error('Local ChainTracks is not ready.');
    try {
      const next = await this.tracker.checkConsistency();
      await this.applyTrackerStatus(next);
    } catch (error) {
      this.update({
        consistency: 'error',
        checkedAt: new Date().toISOString(),
        lastError: errorMessage(error),
      });
      throw error;
    }
  }

  async clearLocalData(): Promise<void> {
    await this.ensure(this.status.chain);
    if (this.tracker?.clearLocalData == null)
      throw new Error('Local ChainTracks clearing is not ready.');
    this.update({ phase: 'recovering', lastError: undefined });
    try {
      const next = await this.tracker.clearLocalData();
      await this.applyTrackerStatus(next);
      this.update({ phase: 'ready' });
    } catch (error) {
      this.update({ phase: 'error', lastError: errorMessage(error) });
      throw error;
    }
  }

  private async ensure(chain: Chain): Promise<void> {
    if (this.initializing != null && this.status.chain === chain) return await this.initializing;
    if (this.tracker != null && this.status.chain === chain) return;
    this.initializing = this.initialize(chain).finally(() => {
      this.initializing = undefined;
    });
    return await this.initializing;
  }

  private async initialize(chain: Chain): Promise<void> {
    this.stopBackground();
    this.remote = this.createRemoteReferences(chain);
    const storedMode = localStorage.getItem(`${MODE_KEY}:${chain}`);
    const mode: ChaintracksMode = storedMode === 'remote-only' ? 'remote-only' : 'local-primary';
    this.update({
      chain,
      mode,
      phase: 'bootstrapping',
      activeSource: 'remote-fallback',
      consistency: 'unchecked',
      localHeight: undefined,
      localTipHash: undefined,
      referenceHeight: undefined,
      heightLag: undefined,
      lastError: undefined,
    });

    try {
      const local = await this.createLocal(chain);
      await local.available;
      const LocalTracker = optionalToolboxExport('Local' + 'ChainTracker') as
        (new (options: unknown) => ManagedLocalTracker) | undefined;
      this.tracker =
        LocalTracker == null
          ? new CompatibilityLocalTracker(local.chaintracks, this.remote, mode)
          : new LocalTracker({
              local: local.chaintracks,
              fallbacks: this.remote,
              mode,
              fallbackOnLocalError: true,
              requiredFallbackAgreement: 2,
              requiredConsistencyAgreement: 2,
              maxHeightLag: 6,
              autoRecover: true,
              recoverLocal: async () => (await this.recreateLocal(chain)).chaintracks,
              clearLocal: async () => (await this.recreateLocal(chain)).chaintracks,
            });
      this.update({
        phase: 'ready',
        activeSource: mode === 'remote-only' ? 'remote-fallback' : 'local',
      });
      this.startBackground();
      void this.syncNow();
    } catch (error) {
      this.tracker = undefined;
      this.update({
        phase: 'error',
        activeSource: 'remote-fallback',
        consistency: 'error',
        lastError: errorMessage(error),
      });
      this.startBackground();
    }
  }

  private async createLocal(chain: Chain): Promise<CreatedLocal> {
    const cache = new PackagedCheckpointCache();
    const Budget = optionalToolboxExport('FixedWindow' + 'BulkFileDownloadBudget') as
      (new (options: { maxBytes: number; windowMsecs: number }) => unknown) | undefined;
    const sources = {
      bulkFileCache: cache,
      bulkFileDownloadBudget:
        Budget == null
          ? undefined
          : new Budget({ maxBytes: 32 * 1024 * 1024, windowMsecs: 60 * 60 * 1000 }),
    };
    const create = Toolbox.createIdbChaintracks as unknown as (
      ...args: unknown[]
    ) => Promise<CreatedLocal>;
    const local = await create(
      chain,
      '',
      100000,
      2,
      undefined,
      undefined,
      2000,
      400,
      500,
      400,
      36,
      sources
    );
    this.local = local;
    return local;
  }

  private async recreateLocal(chain: Chain): Promise<CreatedLocal> {
    await this.local?.chaintracks.destroy?.().catch(() => {});
    this.local?.storage?.db?.close();
    const dbName = this.local?.storage?.dbName || `chaintracks-${chain}net`;
    await this.deleteDatabase(dbName);
    await new PackagedCheckpointCache().clear();
    const local = await this.createLocal(chain);
    await local.available;
    return local;
  }

  private createRemoteReferences(chain: Chain): ChaintracksClientApi[] {
    if (chain !== 'main' && chain !== 'test') return [];
    const GoClient = Toolbox.GoChaintracksServiceClient as unknown as new (
      chain: Chain,
      url: string,
      options: Record<string, unknown>
    ) => ChaintracksClientApi;
    return [
      new GoClient(chain, ARCADE_URLS[chain], {
        apiPrefix: '/chaintracks/v2',
        requestTimeoutMsecs: 15_000,
      }),
      new Toolbox.ChaintracksServiceClient(
        chain,
        `https://${chain}net-chaintracks.babbage.systems`
      ),
    ];
  }

  private async applyTrackerStatus(next: Record<string, unknown>): Promise<void> {
    let storage: StorageEstimate | undefined;
    try {
      storage = await navigator.storage?.estimate?.();
    } catch {
      storage = undefined;
    }
    this.update({
      mode: (next.mode as ChaintracksMode | undefined) ?? this.status.mode,
      activeSource: next.activeSource === 'fallback' ? 'remote-fallback' : 'local',
      consistency:
        (next.consistency as ChaintracksConsistency | undefined) ?? this.status.consistency,
      localHeight: next.localHeight as number | undefined,
      localTipHash: next.localTipHash as string | undefined,
      referenceHeight: next.referenceHeight as number | undefined,
      heightLag: next.heightLag as number | undefined,
      checkedAt: (next.checkedAt as string | undefined) ?? new Date().toISOString(),
      storageBytes: storage?.usage,
      lastError: next.lastError as string | undefined,
    });
  }

  private startBackground(): void {
    this.stopBackground();
    const run = () => {
      if (this.tracker == null) {
        void this.ensure(this.status.chain);
        return;
      }
      const now = Date.now();
      if (now - this.lastConsistencyCheck >= CONSISTENCY_INTERVAL_MS) {
        this.lastConsistencyCheck = now;
        void this.checkConsistency().catch(() => {});
      } else {
        void this.tracker.synchronize?.().catch((error) => {
          this.update({ lastError: errorMessage(error) });
        });
      }
    };
    this.timer = setInterval(run, SYNC_INTERVAL_MS);
    this.onlineHandler = run;
    window.addEventListener('online', this.onlineHandler);
  }

  private stopBackground(): void {
    if (this.timer != null) clearInterval(this.timer);
    this.timer = undefined;
    if (this.onlineHandler != null) window.removeEventListener('online', this.onlineHandler);
    this.onlineHandler = undefined;
  }

  private async deleteDatabase(name: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`Could not delete ${name}.`));
      request.onblocked = () =>
        reject(new Error(`Close other wallet windows before clearing ${name}.`));
    });
  }

  private update(next: Partial<ChaintracksDeviceStatus>): void {
    this.status = { ...this.status, ...next };
    for (const subscriber of this.subscribers) subscriber();
  }
}

export const localChaintracksManager = new LocalChaintracksManager();
