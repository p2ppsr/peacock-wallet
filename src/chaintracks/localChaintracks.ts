import type { ChainTracker } from '@bsv/sdk';
import {
  ChaintracksServiceClient,
  FixedWindowBulkFileDownloadBudget,
  LocalChainTracker,
  WhatsOnChainServices,
  createIdbChaintracks,
  wocGetHeadersHeaderToBlockHeader,
  type BaseBlockHeader,
  type BlockHeader,
  type BulkFileDataCacheApi,
  type BulkHeaderFileInfo,
  type Chain,
  type ChaintracksClientApi,
  type ChaintracksInfoApi,
  type HeaderListener,
  type ReorgListener,
} from '@bsv/wallet-toolbox-client';

export type ChaintracksMode = 'local-primary' | 'remote-only';
export const DEFAULT_CHAINTRACKS_MODE: ChaintracksMode = 'remote-only';

export const resolveChaintracksMode = (storedMode: string | null): ChaintracksMode =>
  storedMode === 'local-primary' ? 'local-primary' : DEFAULT_CHAINTRACKS_MODE;
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

type CreatedLocal = Awaited<ReturnType<typeof createIdbChaintracks>>;

interface CheckpointManifest {
  checkpointHeight: number;
  files: Array<{ fileName: string }>;
}

const CHECKPOINT_HEIGHT = 899999;
const MODE_KEY = 'chaintracks-mode-v1';
const CACHE_NAME = 'chaintracks-bulk-v1';
const SYNC_INTERVAL_MS = 60_000;
const CONSISTENCY_INTERVAL_MS = 5 * 60_000;
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class WhatsOnChainReference implements ChaintracksClientApi {
  private readonly service: WhatsOnChainServices;

  constructor(readonly chain: 'main' | 'test') {
    this.service = new WhatsOnChainServices(
      WhatsOnChainServices.createWhatsOnChainServicesOptions(chain)
    );
  }

  currentHeight = async (): Promise<number> => await this.getPresentHeight();

  async isValidRootForHeight(root: string, height: number): Promise<boolean> {
    return (await this.findHeaderForHeight(height))?.merkleRoot === root;
  }

  async getChain(): Promise<Chain> {
    return this.chain;
  }

  async getInfo(): Promise<ChaintracksInfoApi> {
    const height = await this.getPresentHeight();
    return {
      chain: this.chain,
      heightBulk: height,
      heightLive: height,
      storage: 'whatsonchain-reference',
      bulkIngestors: [],
      liveIngestors: ['WhatsOnChainReference'],
      packages: [],
    };
  }

  async getPresentHeight(): Promise<number> {
    return await this.service.getChainTipHeight();
  }

  async getHeaders(_height: number, _count: number): Promise<string> {
    throw new Error('Bulk header downloads are not supported by the consistency reference.');
  }

  async findChainTipHeader(): Promise<BlockHeader> {
    const headers = await this.service.getHeaders();
    const tip = headers.sort((a, b) => b.height - a.height)[0];
    if (tip == null) throw new Error('WhatsOnChain returned no tip headers.');
    return wocGetHeadersHeaderToBlockHeader(tip);
  }

  async findChainTipHash(): Promise<string> {
    return await this.service.getChainTipHash();
  }

  async findHeaderForHeight(height: number): Promise<BlockHeader | undefined> {
    const header = (await this.service.getHeaders()).find((candidate) => candidate.height === height);
    return header == null ? undefined : wocGetHeadersHeaderToBlockHeader(header);
  }

  async findHeaderForBlockHash(hash: string): Promise<BlockHeader | undefined> {
    return await this.service.getHeaderByHash(hash);
  }

  async addHeader(_header: BaseBlockHeader): Promise<void> {
    throw new Error('Adding headers is not supported by the consistency reference.');
  }

  async startListening(): Promise<void> {
    await this.getPresentHeight();
  }

  async listening(): Promise<void> {
    await this.getPresentHeight();
  }

  async isListening(): Promise<boolean> {
    try {
      await this.getPresentHeight();
      return true;
    } catch {
      return false;
    }
  }

  async isSynchronized(): Promise<boolean> {
    return await this.isListening();
  }

  async subscribeHeaders(_listener: HeaderListener): Promise<string> {
    throw new Error('Header subscriptions are not supported by the consistency reference.');
  }

  async subscribeReorgs(_listener: ReorgListener): Promise<string> {
    throw new Error('Reorg subscriptions are not supported by the consistency reference.');
  }

  async unsubscribe(_subscriptionId: string): Promise<boolean> {
    return false;
  }
}

class PackagedCheckpointCache implements BulkFileDataCacheApi {
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

  private cacheRequest(file: Readonly<BulkHeaderFileInfo>): Request {
    const identity = encodeURIComponent(file.fileHash || file.fileName);
    return new Request(new URL(`/__chaintracks_bulk_cache__/${identity}`, window.location.origin));
  }

  async get(file: Readonly<BulkHeaderFileInfo>): Promise<Uint8Array | undefined> {
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

  async set(file: Readonly<BulkHeaderFileInfo>, data: Uint8Array): Promise<void> {
    if (typeof caches === 'undefined') return;
    await (
      await caches.open(CACHE_NAME)
    ).put(
      this.cacheRequest(file),
      new Response(data.slice(), { headers: { 'content-type': 'application/octet-stream' } })
    );
  }

  async delete(file: Readonly<BulkHeaderFileInfo>): Promise<void> {
    if (typeof caches === 'undefined') return;
    await (await caches.open(CACHE_NAME)).delete(this.cacheRequest(file));
  }

  async clear(): Promise<void> {
    if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
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
  private tracker?: LocalChainTracker;
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
    mode: DEFAULT_CHAINTRACKS_MODE,
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
    const fallback = this.remote[0];
    if (fallback == null) throw new Error(`No ChainTracks source is configured for ${chain}.`);
    return fallback;
  }

  async setMode(mode: ChaintracksMode): Promise<void> {
    localStorage.setItem(`${MODE_KEY}:${this.status.chain}`, mode);
    if (mode === this.status.mode) return;

    if (mode === 'local-primary') {
      this.update({ mode, phase: 'bootstrapping', activeSource: 'remote-fallback' });
      await this.initialize(this.status.chain);
      return;
    }

    this.stopBackground();
    await this.local?.chaintracks.destroy().catch(() => {});
    this.local?.storage.db?.close();
    this.local = undefined;
    this.tracker = undefined;
    this.update({
      mode,
      phase: 'ready',
      activeSource: 'remote-fallback',
      consistency: 'unchecked',
      lastError: undefined,
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
    while (this.initializing != null) await this.initializing;
    if (
      this.status.chain === chain &&
      this.status.mode === 'remote-only' &&
      this.status.phase === 'ready'
    ) return;
    if (this.tracker != null && this.status.chain === chain) return;
    const initialization = this.initialize(chain);
    this.initializing = initialization;
    try {
      await initialization;
    } finally {
      if (this.initializing === initialization) this.initializing = undefined;
    }
  }

  private async initialize(chain: Chain): Promise<void> {
    this.stopBackground();
    const previous = this.local;
    this.local = undefined;
    this.tracker = undefined;
    this.remote = this.createRemoteReferences(chain);
    const storedMode = localStorage.getItem(`${MODE_KEY}:${chain}`);
    const mode = resolveChaintracksMode(storedMode);
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

    await previous?.chaintracks.destroy().catch(() => {});
    previous?.storage.db?.close();

    if (mode === 'remote-only') {
      this.update({ phase: 'ready' });
      return;
    }

    try {
      const local = await this.createLocal(chain);
      await local.available;
      this.tracker = new LocalChainTracker({
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
        activeSource: 'local',
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
    const sources = {
      bulkFileCache: cache,
      bulkFileDownloadBudget: new FixedWindowBulkFileDownloadBudget({
        maxBytes: 32 * 1024 * 1024,
        windowMsecs: 60 * 60 * 1000,
      }),
    };
    const local = await createIdbChaintracks(
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
    return [
      new WhatsOnChainReference(chain),
      new ChaintracksServiceClient(chain, `https://${chain}net-chaintracks.babbage.systems`),
    ];
  }

  private async applyTrackerStatus(next: ReturnType<LocalChainTracker['getStatus']>): Promise<void> {
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
