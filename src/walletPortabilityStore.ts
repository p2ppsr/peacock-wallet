import { captureIdbArchive, restoreIdbArchive } from './walletPortabilityIdb';
import { deleteDB, openDB, type DBSchema } from 'idb';
import { PrivateKey } from '@bsv/sdk';
import { createSHA256 } from 'hash-wasm';
import { StorageIdb, type BRC38WalletData } from '@bsv/wallet-toolbox-client';
import { mergeArchivePages } from './walletPortabilityMerge';
import { localWalletDatabaseName } from './walletStorageLocal';
import {
  ARCHIVE_TABLES,
  PortabilityError,
  canonicalArchiveJson,
  checkArchiveSize,
  decodeArchive,
  matchesArchiveWallet,
  summarizeArchive,
  type ArchiveSource,
  type ArchiveSummary,
} from './walletPortability';

export interface ArchiveJob {
  id: string;
  state: 'preparing' | 'ready' | 'restored' | 'merging' | 'merged' | 'activating' | 'active';
  createdAt: string;
  fileName: string;
  fileBytes: number;
  summary?: ArchiveSummary;
  databaseName: string;
  storageIdentityKey: string;
  digest?: string;
  beforeDatabaseName?: string;
  mergeDatabaseName?: string;
  mergeStorageIdentityKey?: string;
  target?: string;
  inserts?: number;
  updates?: number;
  completedAt?: string;
  activationDatabaseName?: string;
  activationStorageIdentityKey?: string;
}
interface StoredArchiveJob extends ArchiveJob {
  original: Blob;
}
interface ArchiveDb extends DBSchema {
  jobs: { key: string; value: StoredArchiveJob };
}
const journal = () =>
  openDB<ArchiveDb>('peacock-wallet-portability-v1', 1, {
    upgrade(db) {
      db.createObjectStore('jobs', { keyPath: 'id' });
    },
  });

function publicJob(job: StoredArchiveJob): ArchiveJob {
  const { original: _original, ...metadata } = job;
  return metadata;
}
export async function listArchiveJobs(): Promise<ArchiveJob[]> {
  const db = await journal();
  try {
    return (await db.getAll('jobs'))
      .map(publicJob)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    db.close();
  }
}
export async function loadArchiveJob(id: string): Promise<ArchiveJob> {
  const db = await journal();
  try {
    const row = await db.get('jobs', id);
    if (!row) throw new PortabilityError('storage');
    return publicJob(row);
  } finally {
    db.close();
  }
}
export async function updateArchiveJob(
  id: string,
  changes: Partial<ArchiveJob>
): Promise<ArchiveJob> {
  const db = await journal();
  try {
    const tx = db.transaction('jobs', 'readwrite');
    const row = await tx.store.get(id);
    if (!row) throw new PortabilityError('storage');
    const next = { ...row, ...changes, id };
    await tx.store.put(next);
    await tx.done;
    return publicJob(next);
  } finally {
    db.close();
  }
}

/** Archive reads must not run Toolbox's on-open managed-basket policy migration. */
class ArchiveStorage extends StorageIdb {
  override async processSyncChunk(
    ...args: Parameters<StorageIdb['processSyncChunk']>
  ): ReturnType<StorageIdb['processSyncChunk']> {
    const result = await super.processSyncChunk(...args);
    if (
      result.error ||
      !Number.isSafeInteger(result.inserts) ||
      !Number.isSafeInteger(result.updates)
    )
      throw new PortabilityError('storage');
    return result;
  }
  override async verifyDB(): ReturnType<StorageIdb['verifyDB']> {
    if (!this.db) {
      this.db = await openDB(this.dbName, undefined, {
        upgrade(_db, _old, _new, transaction) {
          transaction.abort();
        },
      });
      this._settings = (await this.db.getAll('settings'))[0];
      if (!this._settings || this.db.version !== 6) {
        this.db.close();
        this.db = undefined;
        throw new PortabilityError('unsupported');
      }
    }
    return this.db;
  }
}

export async function openArchiveStorage(
  databaseName: string,
  chain: 'main' | 'test' | 'ttn'
): Promise<StorageIdb> {
  const storage = new ArchiveStorage({
    chain,
    commissionSatoshis: 0,
    feeModel: { model: 'sat/kb', value: 1 },
  });
  storage.dbName = databaseName;
  const settings = await storage.makeAvailable();
  if (settings.chain !== chain) {
    await storage.destroy();
    throw new PortabilityError('identity');
  }
  return storage;
}

/** Read-only, consistent snapshot with packed byte buffers. */
export async function captureArchive(
  source: ArchiveSource,
  report: (message: string) => void = () => {}
): Promise<BRC38WalletData> {
  const storage = await openArchiveStorage(source.databaseName, source.chain);
  try {
    const document = await captureIdbArchive(storage, source.identityKey, report);
    if (!matchesArchiveWallet(summarizeArchive(document), source.identityKey, source.chain))
      throw new PortabilityError('identity');
    return document;
  } finally {
    await storage.destroy();
  }
}

/** Row order is irrelevant for semantic verification, but every row value matters. */
export async function archiveDatasetDigest(document: BRC38WalletData): Promise<string> {
  const hash = await createSHA256();
  const rowHash = await createSHA256();
  hash.init();
  hash.update(canonicalArchiveJson(document.user));
  for (const table of ARCHIVE_TABLES) {
    hash.update(table);
    const rows = document.tables[table]
      .map((row) => rowHash.init().update(canonicalArchiveJson(row)).digest())
      .sort();
    for (const row of rows) {
      hash.update(String(row.length));
      hash.update(':');
      hash.update(row);
    }
  }
  return hash.digest();
}

async function restoreExact(
  document: BRC38WalletData,
  databaseName: string,
  storageIdentityKey: string
): Promise<void> {
  const chain = document.sourceStorage.chain as 'main' | 'test' | 'ttn';
  const target = new StorageIdb({
    chain,
    commissionSatoshis: 0,
    feeModel: { model: 'sat/kb', value: 1 },
  });
  target.dbName = databaseName;
  try {
    await target.migrate('Peacock restored wallet data', storageIdentityKey);
    await target.makeAvailable();
    await restoreIdbArchive(target, document);
    const restored = await captureIdbArchive(target, String(document.user.identityKey), () => {});
    if ((await archiveDatasetDigest(restored)) !== (await archiveDatasetDigest(document)))
      throw new PortabilityError('storage');
  } finally {
    await target.destroy();
  }
}

export async function prepareArchiveImport(
  file: Blob,
  fileName: string,
  password: string,
  report: (phase: string) => void
): Promise<ArchiveJob> {
  checkArchiveSize(file.size);
  report('Reading and validating the file…');
  const document = await decodeArchive(new Uint8Array(await file.arrayBuffer()), password);
  password = '';
  const summary = summarizeArchive(document);
  const id = crypto.randomUUID(),
    storageIdentityKey = PrivateKey.fromRandom().toHex();
  const row: StoredArchiveJob = {
    id,
    state: 'preparing',
    createdAt: new Date().toISOString(),
    fileName,
    fileBytes: file.size,
    summary,
    storageIdentityKey,
    databaseName: localWalletDatabaseName(summary.chain, summary.identityKey, storageIdentityKey),
    original: file,
  };
  const db = await journal();
  try {
    await db.put('jobs', row);
  } finally {
    db.close();
  }
  report('Restoring an isolated copy and verifying every record…');
  await restoreExact(document, row.databaseName, storageIdentityKey);
  return await updateArchiveJob(id, {
    state: 'ready',
    digest: await archiveDatasetDigest(document),
  });
}

/** Only an unverified staging database can be discarded during preparation recovery. */
export async function resumeArchiveImport(
  id: string,
  password: string,
  report: (phase: string) => void
): Promise<ArchiveJob> {
  const job = await loadArchiveJob(id);
  if (job.state !== 'preparing') throw new PortabilityError('busy');
  const file = await originalArchiveFile(id);
  report('Unlocking the retained original file…');
  const document = await decodeArchive(new Uint8Array(await file.arrayBuffer()), password);
  password = '';
  if (
    !job.summary ||
    !matchesArchiveWallet(summarizeArchive(document), job.summary.identityKey, job.summary.chain)
  )
    throw new PortabilityError('identity');
  await deleteDB(job.databaseName);
  report('Rebuilding and verifying the isolated copy…');
  await restoreExact(document, job.databaseName, job.storageIdentityKey);
  return await updateArchiveJob(id, {
    state: 'ready',
    digest: await archiveDatasetDigest(document),
  });
}

/** Keep the imported archive immutable. Activation gets its own working copy. */
export async function prepareArchiveActivation(
  id: string,
  report: (phase: string) => void
): Promise<ArchiveJob> {
  const job = await loadArchiveJob(id);
  if (!job.summary || !['ready', 'restored', 'merged', 'activating'].includes(job.state))
    throw new PortabilityError('busy');
  report('Verifying the restored data before preparing a working copy…');
  const document = await verifiedArchiveDocument(job);
  // Do not reuse an interrupted working copy; the immutable source remains intact.
  const key = PrivateKey.fromRandom().toHex();
  const name = localWalletDatabaseName(job.summary.chain, job.summary.identityKey, key);
  await updateArchiveJob(id, {
    state: 'activating',
    activationDatabaseName: name,
    activationStorageIdentityKey: key,
  });
  await restoreExact(document, name, key);
  const working = await openArchiveStorage(name, job.summary.chain);
  try {
    const user = await working.findUserByIdentityKey(job.summary.identityKey);
    await working.setActive({ identityKey: job.summary.identityKey, userId: user.userId }, key);
  } finally {
    await working.destroy();
  }
  return await loadArchiveJob(id);
}

export async function verifiedArchiveDocument(job: ArchiveJob): Promise<BRC38WalletData> {
  if (!job.summary || !job.digest || job.state === 'preparing')
    throw new PortabilityError('storage');
  const document = await captureArchive({
    databaseName: job.databaseName,
    identityKey: job.summary.identityKey,
    chain: job.summary.chain,
    copiedFrom: job.summary.sourceName,
  });
  if ((await archiveDatasetDigest(document)) !== job.digest) throw new PortabilityError('storage');
  return document;
}

export async function prepareArchiveMerge(
  id: string,
  source: ArchiveSource,
  target: string,
  report: (phase: string) => void
): Promise<ArchiveJob> {
  const job = await loadArchiveJob(id);
  if (!job.summary || !matchesArchiveWallet(job.summary, source.identityKey, source.chain))
    throw new PortabilityError('identity');
  if (job.state === 'merging') {
    if (job.target !== target || !job.mergeDatabaseName) throw new PortabilityError('stale');
    return job;
  }
  if (!['ready', 'restored', 'merged'].includes(job.state)) throw new PortabilityError('busy');
  report('Saving a recovery point of the current device copy…');
  const before = await captureArchive(source);
  const beforeKey = PrivateKey.fromRandom().toHex(),
    mergeKey = PrivateKey.fromRandom().toHex();
  const beforeName = localWalletDatabaseName(source.chain, source.identityKey, beforeKey);
  const mergeName = localWalletDatabaseName(source.chain, source.identityKey, mergeKey);
  // Persist names before work starts so an interrupted preparation is discoverable.
  await updateArchiveJob(id, {
    beforeDatabaseName: beforeName,
    mergeDatabaseName: mergeName,
    mergeStorageIdentityKey: mergeKey,
    target,
  });
  await restoreExact(before, beforeName, beforeKey);
  await restoreExact(before, mergeName, mergeKey);
  report('Reconciling the import in a separate copy…');
  const incoming = await verifiedArchiveDocument(job);
  const stage = await openArchiveStorage(mergeName, source.chain);
  try {
    const result = await mergeArchivePages(stage, incoming, report);
    // Validate the entire merged closure before any live provider is touched.
    await captureIdbArchive(stage, source.identityKey, report);
    return await updateArchiveJob(id, {
      state: 'merging',
      inserts: result.inserts,
      updates: result.updates,
    });
  } finally {
    await stage.destroy();
  }
}

export async function originalArchiveFile(id: string): Promise<Blob> {
  const db = await journal();
  try {
    const job = await db.get('jobs', id);
    if (!job) throw new PortabilityError('storage');
    return job.original;
  } finally {
    db.close();
  }
}
