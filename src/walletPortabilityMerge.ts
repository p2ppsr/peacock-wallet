import {
  createSyncMap,
  type BRC38WalletData,
  type StorageIdb,
  type SyncMap,
  type TableSyncState,
  type TableUser,
} from '@bsv/wallet-toolbox-client';
import { storedArchiveRow } from './walletPortabilityIdb';
import { canonicalArchiveJson, PortabilityError } from './walletPortability';

type RequestSyncChunkArgs = Parameters<StorageIdb['processSyncChunk']>[0];
type SyncChunk = Parameters<StorageIdb['processSyncChunk']>[1];
const order = [
  ['provenTxs', 'provenTx'],
  ['outputBaskets', 'outputBasket'],
  ['outputTags', 'outputTag'],
  ['txLabels', 'txLabel'],
  ['transactions', 'transaction'],
  ['outputs', 'output'],
  ['txLabelMaps', 'txLabelMap'],
  ['outputTagMaps', 'outputTagMap'],
  ['certificates', 'certificate'],
  ['certificateFields', 'certificateField'],
  ['commissions', 'commission'],
  ['provenTxReqs', 'provenTxReq'],
] as const;

/** Use Toolbox's entity merge rules, but decode only one bounded page of bytes.
 * This operates on a disposable staging copy, never the active wallet. */
export async function mergeArchivePages(
  storage: StorageIdb,
  document: BRC38WalletData,
  report: (message: string) => void
) {
  const settings = await storage.makeAvailable();
  const identityKey = String(document.user.identityKey);
  const { user } = await storage.findOrInsertUser(identityKey);
  const sourceIdentity = String(document.sourceStorage.storageIdentityKey);
  const sourceName = String(document.sourceStorage.storageName);
  const state = await storage.findOrInsertSyncStateAuth(
    { identityKey, userId: user.userId },
    sourceIdentity,
    sourceName
  );
  const args: RequestSyncChunkArgs = {
    identityKey,
    fromStorageIdentityKey: sourceIdentity,
    toStorageIdentityKey: settings.storageIdentityKey,
    syncStateId: state.syncState.syncStateId,
    maxItems: 250,
    maxRoughSize: 4 * 1024 * 1024,
    offsets: order.map(([, name]) => ({ name, offset: 0 })),
  };
  const base = {
    fromStorageIdentityKey: sourceIdentity,
    toStorageIdentityKey: settings.storageIdentityKey,
    userIdentityKey: identityKey,
  };
  let inserts = 0,
    updates = 0;
  const apply = async (chunk: SyncChunk) => {
    const result = await storage.processSyncChunk(args, chunk);
    if (
      !result || result.error ||
      !Number.isSafeInteger(result.inserts) ||
      !Number.isSafeInteger(result.updates)
    )
      throw new PortabilityError('storage');
    inserts += result.inserts;
    updates += result.updates;
  };
  await apply({
    ...base,
    user: {
      ...storedArchiveRow('user', document.user),
      activeStorage: user.activeStorage,
    } as TableUser,
  });
  for (const [table, entity] of order) {
    const rows = document.tables[table];
    for (let offset = 0; offset < rows.length;) {
      const page = [];
      let bytes = 0;
      while (offset < rows.length && page.length < args.maxItems && bytes < args.maxRoughSize) {
        const portable = rows[offset++];
        bytes += canonicalArchiveJson(portable).length;
        const row = storedArchiveRow(table, portable);
        // Older Toolbox entity methods expect number[], bounded to this page.
        for (const key of Object.keys(row))
          if (row[key] instanceof Uint8Array) row[key] = Array.from(row[key]);
        page.push(row);
      }
      await apply({ ...base, [table]: page });
      args.offsets.find((item) => item.name === entity)!.offset = offset;
      report(
        `Reconciling ${table}: ${offset.toLocaleString()} of ${rows.length.toLocaleString()} records…`
      );
    }
  }
  await apply({
    ...base,
    ...Object.fromEntries(order.map(([table]): [string, never[]] => [table, []])),
  });
  const current = (
    await storage.findSyncStates({ partial: { syncStateId: state.syncState.syncStateId } })
  )[0];
  if (!current) throw new PortabilityError('storage');
  const mapping = JSON.parse(current.syncMap) as SyncMap;
  for (const portable of document.tables.syncStates) {
    const row = storedArchiveRow('syncStates', portable) as TableSyncState;
    row.userId = user.userId;
    const normalized = createSyncMap();
    const original = JSON.parse(row.syncMap) as SyncMap;
    for (const name of Object.keys(normalized) as (keyof SyncMap)[]) {
      const entry = original[name];
      if (!entry) continue;
      normalized[name] = { ...normalized[name], ...entry, idMap: { ...entry.idMap } };
      for (const remote of Object.keys(normalized[name].idMap)) {
        const previous = normalized[name].idMap[Number(remote)];
        normalized[name].idMap[Number(remote)] = mapping[name]?.idMap[previous] ?? previous;
      }
    }
    row.syncMap = JSON.stringify(normalized);
    const existing = await storage.findSyncStates({
      partial: {
        userId: user.userId,
        storageIdentityKey: row.storageIdentityKey,
        storageName: row.storageName,
      },
    });
    if (existing.length > 1) throw new PortabilityError('storage');
    if (existing[0]) {
      row.syncStateId = existing[0].syncStateId;
      if (row.storageIdentityKey === sourceIdentity && row.storageName === sourceName)
        row.syncMap = existing[0].syncMap;
      await storage.updateSyncState(row.syncStateId, row);
      updates++;
    } else {
      row.syncStateId = 0;
      await storage.insertSyncState(row);
      inserts++;
    }
  }
  return { inserts, updates };
}
