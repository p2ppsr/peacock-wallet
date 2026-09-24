import type { BRC38WalletData, StorageIdb } from '@bsv/wallet-toolbox-client';
import {
  ARCHIVE_TABLES,
  MAX_ARCHIVE_BYTES,
  PortabilityError,
  validateArchive,
} from './walletPortability';

type Row = Record<string, any>;
export const archiveStores = {
  provenTxs: 'proven_txs',
  provenTxReqs: 'proven_tx_reqs',
  outputBaskets: 'output_baskets',
  transactions: 'transactions',
  commissions: 'commissions',
  outputs: 'outputs',
  outputTags: 'output_tags',
  outputTagMaps: 'output_tags_map',
  txLabels: 'tx_labels',
  txLabelMaps: 'tx_labels_map',
  certificates: 'certificates',
  certificateFields: 'certificate_fields',
  syncStates: 'sync_states',
} as const;
const binaries: Record<string, string[]> = {
  provenTxs: ['rawTx', 'merklePath'],
  provenTxReqs: ['rawTx', 'inputBEEF'],
  transactions: ['rawTx', 'inputBEEF'],
  commissions: ['lockingScript'],
  outputs: ['lockingScript'],
};
const jsonFields: Record<string, string[]> = {
  provenTxReqs: ['history', 'notify'],
  syncStates: ['syncMap', 'errorLocal', 'errorOther'],
};

function base64(bytes: Uint8Array | number[]): string {
  // Keep byte data packed. Toolbox's aggregate exporter expands Uint8Array to
  // number[] and retains every expansion until the whole wallet is collected.
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x6000)
    parts.push(btoa(String.fromCharCode(...bytes.slice(offset, offset + 0x6000))));
  return parts.join(''); // Every non-final block is a multiple of three bytes.
}
/** Legacy RPC histories can encode absent optional properties as JSON null.
 * BRC-38 represents absence by omission, including inside structured JSON.
 * Null array entries have no omission-preserving representation, so refuse them. */
function portableJson(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((item) => {
      if (item == null)
        throw new PortabilityError('invalid', 'structured history contains an absent array entry');
      return portableJson(item);
    });
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child != null)
        .map(([key, child]) => [key, portableJson(child)])
    );
  return value;
}
function portable(table: string, row: Row): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null || key === 'logger' || (table === 'certificates' && key === 'fields'))
      continue;
    if (binaries[table]?.includes(key)) result[key] = base64(value);
    else if (jsonFields[table]?.includes(key))
      result[key] = portableJson(typeof value === 'string' ? JSON.parse(value) : value);
    else if (value instanceof Date) result[key] = value.toISOString();
    else result[key] = value instanceof Uint8Array ? Array.from(value) : value;
  }
  return result;
}
export function storedArchiveRow(table: string, row: Row): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (binaries[table]?.includes(key)) {
      const binary = atob(value);
      result[key] = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    } else if (jsonFields[table]?.includes(key)) result[key] = JSON.stringify(value);
    else if (
      key === 'created_at' ||
      key === 'updated_at' ||
      (table === 'syncStates' && key === 'when')
    )
      result[key] = new Date(value);
    else result[key] = value;
  }
  return result;
}

/** The schema-6 adapter captures the BRC-38 closure in one IDB transaction,
 * converts one row at a time, and never accumulates expanded binary arrays. */
export async function captureIdbArchive(
  storage: StorageIdb,
  identityKey: string,
  report: (message: string) => void
): Promise<BRC38WalletData> {
  const db = await storage.verifyDB();
  const tx = db.transaction(['settings', 'users', ...Object.values(archiveStores)], 'readonly');
  void tx.done.catch(() => {});
  try {
    const settings = (await tx.objectStore('settings').getAll())[0];
    const user = await tx.objectStore('users').index('identityKey').get(identityKey);
    if (!user) throw new PortabilityError('identity');
    const tables = Object.fromEntries(
      ARCHIVE_TABLES.map((name): [string, Row[]] => [name, []])
    ) as unknown as BRC38WalletData['tables'];
    let roughBytes = 0;
    const append = (table: (typeof ARCHIVE_TABLES)[number], row: Row) => {
      const encoded = portable(table, row);
      roughBytes += new TextEncoder().encode(JSON.stringify(encoded)).byteLength;
      if (roughBytes > MAX_ARCHIVE_BYTES) throw new PortabilityError('size');
      tables[table].push(encoded);
      if (tables[table].length % 250 === 0)
        report(`Reading ${table}: ${tables[table].length.toLocaleString()} records…`);
    };
    // Raw/script hydration follows StorageIdb's public query semantics. Use
    // native typed blobs, with a small cache for outputs of the same transaction.
    const rawCache = new Map<string, Uint8Array | number[] | undefined>();
    let cachedBytes = 0;
    const raw = async (txid: string, slice = false): Promise<Uint8Array | number[] | undefined> => {
      const key = `${slice}:${txid}`;
      if (rawCache.has(key)) return rawCache.get(key);
      const proven = await tx.objectStore('proven_txs').index('txid').get(txid);
      const request = proven
        ? undefined
        : await tx.objectStore('proven_tx_reqs').index('txid').get(txid);
      const statuses = slice
        ? ['unsent', 'nosend', 'sending', 'unmined', 'completed', 'unfail']
        : ['unsent', 'unmined', 'unconfirmed', 'sending', 'nosend', 'completed'];
      const bytes =
        proven?.rawTx ?? (request && statuses.includes(request.status) ? request.rawTx : undefined);
      rawCache.set(key, bytes);
      cachedBytes += bytes?.length ?? 0;
      while (rawCache.size > 8 || cachedBytes > 16 * 1024 * 1024) {
        const oldest = rawCache.keys().next().value!;
        cachedBytes -= rawCache.get(oldest)?.length ?? 0;
        rawCache.delete(oldest);
      }
      return bytes;
    };
    const ids = new Set<number>(),
      txids = new Set<string>(),
      provenIds = new Set<number>(),
      outputIds = new Set<number>(),
      tagIds = new Set<number>(),
      labelIds = new Set<number>();
    for (const table of [
      'transactions',
      'outputBaskets',
      'commissions',
      'outputs',
      'outputTags',
      'txLabels',
      'certificates',
      'certificateFields',
      'syncStates',
    ] as const) {
      report(`Reading ${table} from the device snapshot…`);
      const store = tx.objectStore(archiveStores[table]);
      let cursor = await store.openCursor();
      while (cursor) {
        const row: Row = cursor.value;
        if (row.userId === user.userId) {
          if (table === 'transactions') {
            ids.add(row.transactionId);
            if (row.txid) txids.add(row.txid);
            if (row.provenTxId != null) provenIds.add(row.provenTxId);
            if (!row.rawTx && row.txid) row.rawTx = await raw(row.txid);
          } else if (table === 'outputs') {
            outputIds.add(row.outputId);
            if (
              row.scriptLength &&
              row.scriptOffset &&
              row.txid &&
              row.lockingScript?.length !== row.scriptLength
            ) {
              const bytes = await raw(row.txid, true);
              if (bytes)
                row.lockingScript = bytes.slice(
                  row.scriptOffset,
                  row.scriptOffset + row.scriptLength
                );
            }
          } else if (table === 'outputTags') tagIds.add(row.outputTagId);
          else if (table === 'txLabels') labelIds.add(row.txLabelId);
          append(table, row);
        }
        cursor = await cursor.continue();
      }
    }
    for (const table of ['provenTxReqs', 'outputTagMaps', 'txLabelMaps'] as const) {
      report(`Reading ${table} from the device snapshot…`);
      let cursor = await tx.objectStore(archiveStores[table]).openCursor();
      while (cursor) {
        const row: Row = cursor.value;
        const included =
          table === 'provenTxReqs'
            ? txids.has(row.txid)
            : table === 'outputTagMaps'
              ? outputIds.has(row.outputId) && tagIds.has(row.outputTagId)
              : ids.has(row.transactionId) && labelIds.has(row.txLabelId);
        if (included) {
          if (table === 'provenTxReqs' && row.provenTxId != null) provenIds.add(row.provenTxId);
          append(table, row);
        }
        cursor = await cursor.continue();
      }
    }
    report('Reading the referenced transaction proofs…');
    for (const id of [...provenIds].sort((a, b) => a - b)) {
      const row = await tx.objectStore('proven_txs').get(id);
      if (!row) throw new PortabilityError('incomplete');
      append('provenTxs', row);
    }
    await tx.done;
    // Composite stores have different native key ordering from the standard.
    tables.outputTagMaps.sort(
      (a, b) =>
        Number(a.outputId) - Number(b.outputId) || Number(a.outputTagId) - Number(b.outputTagId)
    );
    tables.txLabelMaps.sort(
      (a, b) =>
        Number(a.transactionId) - Number(b.transactionId) ||
        Number(a.txLabelId) - Number(b.txLabelId)
    );
    tables.certificateFields.sort(
      (a, b) =>
        Number(a.certificateId) - Number(b.certificateId) ||
        (String(a.fieldName) < String(b.fieldName)
          ? -1
          : String(a.fieldName) > String(b.fieldName)
            ? 1
            : 0)
    );
    report('Validating the complete snapshot…');
    return validateArchive({
      brc: 38,
      title: 'User Wallet Data Format',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceStorage: portable('settings', settings),
      user: portable('user', user),
      tables,
    });
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Completed transaction. */
    }
    throw error;
  }
}

/** Empty destinations only. A single transaction preserves IDs, policies and
 * timestamps without Toolbox's runtime-policy normalization. */
export async function restoreIdbArchive(
  storage: StorageIdb,
  document: BRC38WalletData
): Promise<void> {
  const db = await storage.verifyDB();
  const stores = ['users', ...Object.values(archiveStores)];
  const tx = db.transaction(stores, 'readwrite');
  void tx.done.catch(() => {});
  try {
    for (const name of stores)
      if ((await tx.objectStore(name).count()) !== 0) throw new PortabilityError('storage');
    await tx.objectStore('users').add(storedArchiveRow('user', document.user));
    for (const table of ARCHIVE_TABLES)
      for (const row of document.tables[table])
        await tx.objectStore(archiveStores[table]).add(storedArchiveRow(table, row));
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Completed transaction. */
    }
    throw error;
  }
}
