import { PublicKey } from '@bsv/sdk';
import type { BRC38WalletData } from '@bsv/wallet-toolbox-client';
import { JSONParser } from '@streamparser/json';
import { argon2id } from 'hash-wasm';

export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024 - 1;
export const ARCHIVE_TABLES = [
  'provenTxs',
  'provenTxReqs',
  'outputBaskets',
  'transactions',
  'commissions',
  'outputs',
  'outputTags',
  'outputTagMaps',
  'txLabels',
  'txLabelMaps',
  'certificates',
  'certificateFields',
  'syncStates',
] as const;
export type ArchiveFormat = 'brc39' | 'brc38';
export type ArchiveChain = 'main' | 'test' | 'ttn';
export interface ArchiveSummary {
  identityKey: string;
  chain: ArchiveChain;
  exportedAt: string;
  sourceName: string;
  sourceIdentity: string;
  counts: Record<(typeof ARCHIVE_TABLES)[number], number>;
  totalRecords: number;
  pendingTransactions: number;
}
export interface ArchiveSource {
  databaseName: string;
  identityKey: string;
  chain: ArchiveChain;
  lastSyncedAt?: string;
  copiedFrom: string;
}

export const PORTABILITY_MESSAGES = {
  incomplete:
    'The device copy is missing records required for a complete archive. Synchronize it again before exporting; no incomplete file was written.',
  memory:
    'This device could not allocate enough memory for the archive. Close other apps and retry. Existing data is unchanged.',
  quota:
    'There is not enough device storage for this recovery copy. Free space and retry; your original file and existing wallet are unchanged.',
  transaction:
    'The consistent snapshot was interrupted by the device database. Close other wallet windows and retry.',
  size: 'This file exceeds the supported 2 GiB archive size. Your existing data has not been changed.',
  invalid: 'This is not a valid, complete BRC-38/39 wallet data file. No data was imported.',
  password: 'The file could not be unlocked. Check the passphrase and that the file is intact.',
  resources:
    'This file requests more encryption resources than this device import supports. Use an export with supported Argon2id parameters.',
  identity:
    'This file belongs to a different wallet or network. Restore it as a separate copy, then recover the matching wallet keys.',
  cancelled: 'Stopped safely. Existing wallet data and completed recovery copies have been kept.',
  storage:
    'The device could not save or verify the complete copy. Check free disk space and try again. Existing wallet data has been kept.',
  busy: 'Another wallet data operation is running. Wait for it to finish or stop it safely.',
  stale: 'The selected wallet changed. Reopen Backups for the current profile before continuing.',
  unsupported: 'This wallet file uses an unsupported format version or encryption method.',
} as const;
export type PortabilityErrorCode = keyof typeof PORTABILITY_MESSAGES;
export class PortabilityError extends Error {
  constructor(
    public readonly code: PortabilityErrorCode,
    public readonly detail?: string
  ) {
    super(PORTABILITY_MESSAGES[code] + (detail ? ` Check: ${detail}.` : ''));
    this.name = 'PortabilityError';
  }
}
export function archiveErrorCode(error: unknown): PortabilityErrorCode {
  if (error instanceof PortabilityError) return error.code;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'QuotaExceededError') return 'quota';
  if (/memory|allocation|invalid array length|invalid string length/i.test(message))
    return 'memory';
  if (/BRC-38|does not reference|verifyOne/.test(message)) return 'incomplete';
  if (['TransactionInactiveError', 'AbortError', 'InvalidStateError'].includes(name))
    return 'transaction';
  return 'storage';
}

/** RFC 8785 ordering and JSON's ECMAScript number/string serialization. */
export function canonicalArchiveJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || (typeof value === 'number' && !Number.isFinite(value)))
      throw new PortabilityError('invalid');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalArchiveJson).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalArchiveJson(row[key])}`)
    .join(',')}}`;
}

function validateArchiveStructure(document: BRC38WalletData): void {
  // Only fixed schema labels are included in diagnostics; never record values.
  let section = 'JSON values';
  const fail = () => {
    throw new PortabilityError('invalid', section);
  };
  const date = (value: unknown) => {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      new Date(value).toISOString() !== value
    )
      fail();
  };
  const walk = (value: unknown): void => {
    if (value == null) throw new PortabilityError('invalid', `${section}: null or absent value`);
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new PortabilityError('invalid', `${section}: non-finite number`);
    if (typeof value === 'string' && /[\uD800-\uDFFF]/.test(value)) {
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          const next = value.charCodeAt(++i);
          if (!(next >= 0xdc00 && next <= 0xdfff))
            throw new PortabilityError('invalid', `${section}: invalid Unicode`);
        } else if (c >= 0xdc00 && c <= 0xdfff)
          throw new PortabilityError('invalid', `${section}: invalid Unicode`);
      }
    }
    if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        walk(key);
        walk(child);
      }
  };
  section = 'archive header';
  if (
    document.brc !== 38 ||
    document.title !== 'User Wallet Data Format' ||
    document.formatVersion !== 1 ||
    !document.user ||
    !document.sourceStorage ||
    !document.tables
  )
    fail();
  date(document.exportedAt);
  if (
    Object.keys(document).some(
      (key) =>
        ![
          'brc',
          'title',
          'formatVersion',
          'exportedAt',
          'sourceStorage',
          'user',
          'tables',
        ].includes(key)
    ) ||
    Object.keys(document.tables).some((key) => !(ARCHIVE_TABLES as readonly string[]).includes(key))
  )
    fail();
  const binary: Record<string, string[]> = {
    provenTxs: ['rawTx', 'merklePath'],
    provenTxReqs: ['rawTx', 'inputBEEF'],
    transactions: ['rawTx', 'inputBEEF'],
    commissions: ['lockingScript'],
    outputs: ['lockingScript'],
  };
  const objects: Record<string, string[]> = {
    provenTxReqs: ['history', 'notify'],
    syncStates: ['syncMap', 'errorLocal', 'errorOther'],
  };
  for (const table of ['user', 'sourceStorage', ...ARCHIVE_TABLES]) {
    const rows =
      table === 'user'
        ? [document.user]
        : table === 'sourceStorage'
          ? [document.sourceStorage]
          : document.tables[table as (typeof ARCHIVE_TABLES)[number]];
    if (!Array.isArray(rows)) fail();
    for (const row of rows) {
      for (const field of objects[table] ?? []) {
        section = `${table}.${field}`;
        if (row[field] !== undefined) walk(row[field]);
      }
      section = `${table} values`;
      walk(row);
      section = `${table} timestamps`;
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail();
      date(row.created_at);
      date(row.updated_at);
      if (table === 'syncStates' && row.when !== undefined) date(row.when);
      for (const field of binary[table] ?? [])
        if (row[field] !== undefined) {
          section = `${table}.${field} encoding`;
          const bytes = row[field];
          if (
            typeof bytes !== 'string' ||
            bytes.length % 4 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(bytes)
          )
            fail();
        }
      for (const field of objects[table] ?? []) {
        section = `${table}.${field} object`;
        if (
          row[field] !== undefined &&
          (typeof row[field] !== 'object' || Array.isArray(row[field]))
        )
          fail();
      }
      section = `${table} profile ownership`;
      if (row.userId !== undefined && row.userId !== document.user.userId) fail();
    }
  }
  const ids = (table: (typeof ARCHIVE_TABLES)[number], field: string) =>
    new Set(document.tables[table].map((row) => row[field]));
  const transactions = ids('transactions', 'transactionId'),
    proofs = ids('provenTxs', 'provenTxId'),
    baskets = ids('outputBaskets', 'basketId'),
    outputs = ids('outputs', 'outputId'),
    tags = ids('outputTags', 'outputTagId'),
    labels = ids('txLabels', 'txLabelId'),
    certificates = ids('certificates', 'certificateId'),
    txids = ids('transactions', 'txid');
  const ref = (set: Set<unknown>, value: unknown, optional = false) => {
    if (!(optional && value === undefined) && !set.has(value)) fail();
  };
  section = 'transaction proof references';
  for (const row of document.tables.transactions) ref(proofs, row.provenTxId, true);
  section = 'output references';
  for (const row of document.tables.outputs) {
    ref(transactions, row.transactionId);
    ref(transactions, row.spentBy, true);
    ref(baskets, row.basketId, true);
  }
  for (const row of document.tables.commissions) ref(transactions, row.transactionId);
  section = 'tag references';
  for (const row of document.tables.outputTagMaps) {
    ref(outputs, row.outputId);
    ref(tags, row.outputTagId);
  }
  for (const row of document.tables.txLabelMaps) {
    ref(transactions, row.transactionId);
    ref(labels, row.txLabelId);
  }
  section = 'certificate field references';
  for (const row of document.tables.certificateFields) ref(certificates, row.certificateId);
  section = 'proof request references';
  for (const row of document.tables.provenTxReqs) {
    ref(proofs, row.provenTxId, true);
    ref(txids, row.txid);
  }
}

/** Encode in bounded strings: V8 cannot hold an entire large archive as one string. */
function canonicalArchiveBytes(document: BRC38WalletData): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const append = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    size += bytes.length;
    checkArchiveSize(size);
    chunks.push(bytes);
  };
  append('{');
  Object.keys(document)
    .sort()
    .forEach((key, index) => {
      if (index) append(',');
      append(JSON.stringify(key) + ':');
      if (key !== 'tables') append(canonicalArchiveJson(document[key as keyof BRC38WalletData]));
      else {
        append('{');
        Object.keys(document.tables)
          .sort()
          .forEach((table, tableIndex) => {
            if (tableIndex) append(',');
            append(JSON.stringify(table) + ':[');
            document.tables[table as (typeof ARCHIVE_TABLES)[number]].forEach((row, rowIndex) => {
              if (rowIndex) append(',');
              append(canonicalArchiveJson(row));
            });
            append(']');
          });
        append('}');
      }
    });
  append('}');
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function parseArchiveBytes(bytes: Uint8Array): BRC38WalletData {
  const parser = new JSONParser({ paths: ['$'], stringBufferSize: 65536, numberBufferSize: 64 });
  let document: BRC38WalletData | undefined;
  parser.onValue = ({ value }) => {
    document = value as unknown as BRC38WalletData;
  };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    const chunk = bytes.subarray(offset, offset + 65536);
    decoder.decode(chunk, { stream: true }); // Validate UTF-8 strictly, without a whole-file string.
    parser.write(chunk);
  }
  decoder.decode();
  if (!parser.isEnded) parser.end();
  if (!document) throw new PortabilityError('invalid');
  return validateArchive(document);
}

export function validateArchive(value: string | BRC38WalletData): BRC38WalletData {
  try {
    const document = (typeof value === 'string' ? JSON.parse(value) : value) as BRC38WalletData;
    validateArchiveStructure(document);
    if (document.sourceStorage.chain !== 'main' && document.sourceStorage.chain !== 'test' && document.sourceStorage.chain !== 'ttn')
      throw new Error('chain');
    const identity = document.user.identityKey;
    if (typeof identity !== 'string' || !/^(02|03)[a-f0-9]{64}$/i.test(identity))
      throw new Error('identity');
    if (PublicKey.fromString(identity).toString() !== identity.toLowerCase())
      throw new Error('identity');
    const required: Record<(typeof ARCHIVE_TABLES)[number], string[]> = {
      provenTxs: [
        'provenTxId',
        'txid',
        'rawTx',
        'merklePath',
        'height',
        'index',
        'blockHash',
        'merkleRoot',
      ],
      provenTxReqs: [
        'provenTxReqId',
        'txid',
        'status',
        'attempts',
        'notified',
        'history',
        'notify',
        'rawTx',
      ],
      outputBaskets: [
        'basketId',
        'userId',
        'name',
        'numberOfDesiredUTXOs',
        'minimumDesiredUTXOValue',
        'isDeleted',
      ],
      transactions: [
        'transactionId',
        'userId',
        'status',
        'reference',
        'isOutgoing',
        'satoshis',
        'description',
      ],
      commissions: [
        'commissionId',
        'userId',
        'transactionId',
        'satoshis',
        'keyOffset',
        'isRedeemed',
        'lockingScript',
      ],
      outputs: [
        'outputId',
        'userId',
        'transactionId',
        'vout',
        'satoshis',
        'spendable',
        'change',
        'providedBy',
        'purpose',
        'type',
      ],
      outputTags: ['outputTagId', 'userId', 'tag', 'isDeleted'],
      outputTagMaps: ['outputId', 'outputTagId', 'isDeleted'],
      txLabels: ['txLabelId', 'userId', 'label', 'isDeleted'],
      txLabelMaps: ['transactionId', 'txLabelId', 'isDeleted'],
      certificates: [
        'certificateId',
        'userId',
        'type',
        'serialNumber',
        'certifier',
        'subject',
        'revocationOutpoint',
        'signature',
        'isDeleted',
      ],
      certificateFields: ['certificateId', 'userId', 'fieldName', 'fieldValue', 'masterKey'],
      syncStates: [
        'syncStateId',
        'userId',
        'storageIdentityKey',
        'storageName',
        'status',
        'init',
        'refNum',
        'syncMap',
      ],
    };
    const checkRow = (row: Record<string, unknown>, fields: string[], table: string) => {
      for (const field of [...fields, 'created_at', 'updated_at'])
        if (row[field] === undefined)
          throw new PortabilityError('invalid', `${table}.${field} required`);
      for (const [field, value] of Object.entries(row)) {
        if (
          [
            'userId',
            'transactionId',
            'provenTxId',
            'provenTxReqId',
            'basketId',
            'outputId',
            'outputTagId',
            'txLabelId',
            'certificateId',
            'commissionId',
            'syncStateId',
          ].includes(field) &&
          (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
        )
          throw new PortabilityError('invalid', `${table}.${field} identifier`);
        if (
          [
            'isDeleted',
            'isOutgoing',
            'isRedeemed',
            'spendable',
            'change',
            'notified',
            'init',
          ].includes(field) &&
          typeof value !== 'boolean'
        )
          throw new PortabilityError('invalid', `${table}.${field} boolean`);
      }
      for (const field of fields) {
        if (
          [
            'height',
            'index',
            'attempts',
            'numberOfDesiredUTXOs',
            'minimumDesiredUTXOValue',
            'satoshis',
            'vout',
            'maxOutputScript',
          ].includes(field)
        ) {
          if (!Number.isSafeInteger(row[field]))
            throw new PortabilityError('invalid', `${table}.${field} integer`);
        } else if (
          !field.endsWith('Id') &&
          ![
            'isDeleted',
            'isOutgoing',
            'isRedeemed',
            'spendable',
            'change',
            'notified',
            'init',
            'history',
            'notify',
            'syncMap',
          ].includes(field)
        ) {
          if (typeof row[field] !== 'string')
            throw new PortabilityError('invalid', `${table}.${field} text`);
        }
      }
    };
    checkRow(
      document.sourceStorage,
      ['storageIdentityKey', 'storageName', 'chain', 'dbtype', 'maxOutputScript'],
      'sourceStorage'
    );
    checkRow(document.user, ['userId', 'identityKey', 'activeStorage'], 'user');
    for (const table of ARCHIVE_TABLES) {
      const seen = new Set<string>();
      for (const row of document.tables[table]) {
        checkRow(row, required[table], table);
        const fields =
          table === 'outputTagMaps'
            ? ['outputId', 'outputTagId']
            : table === 'txLabelMaps'
              ? ['transactionId', 'txLabelId']
              : table === 'certificateFields'
                ? ['certificateId', 'fieldName']
                : [required[table][0]];
        const key = JSON.stringify(fields.map((field) => row[field]));
        if (seen.has(key)) throw new Error('duplicate row');
        seen.add(key);
      }
    }
    return document;
  } catch (error) {
    if (error instanceof PortabilityError) throw error;
    throw new PortabilityError('invalid');
  }
}

export function summarizeArchive(document: BRC38WalletData): ArchiveSummary {
  const counts = Object.fromEntries(
    ARCHIVE_TABLES.map((name) => [name, document.tables[name].length])
  ) as ArchiveSummary['counts'];
  return {
    identityKey: String(document.user.identityKey),
    chain: document.sourceStorage.chain as ArchiveChain,
    exportedAt: document.exportedAt,
    sourceName: String(document.sourceStorage.storageName),
    sourceIdentity: String(document.sourceStorage.storageIdentityKey),
    counts,
    totalRecords: Object.values(counts).reduce((a, b) => a + b, 0),
    pendingTransactions: document.tables.transactions.filter((row) =>
      ['unprocessed', 'unsigned', 'nosend', 'unproven', 'sending'].includes(String(row.status))
    ).length,
  };
}

export function matchesArchiveWallet(
  summary: ArchiveSummary,
  identityKey: string,
  chain: ArchiveChain
): boolean {
  return summary.identityKey === identityKey && summary.chain === chain;
}

export function checkArchiveSize(size: number): void {
  if (!Number.isSafeInteger(size) || size <= 0) throw new PortabilityError('invalid');
  if (size > MAX_ARCHIVE_BYTES) throw new PortabilityError('size');
}

const HEADER_SIZE = 33;
const SALT_SIZE = 32;
const NONCE_SIZE = 32;
const encoder = new TextEncoder();
const copyBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

interface BRC39Header {
  iterations: number;
  memoryKiB: number;
  parallelism: number;
  salt: Uint8Array;
  nonce: Uint8Array;
  offset: number;
}
export function readArchiveHeader(bytes: Uint8Array): BRC39Header {
  checkArchiveSize(bytes.byteLength);
  if (bytes.length < 51 || bytes[0] !== 87 || bytes[1] !== 68 || bytes[2] !== 65 || bytes[3] !== 84)
    throw new PortabilityError('invalid');
  if (bytes[4] !== 1 || bytes[5] !== 1 || bytes[6] !== 38 || bytes[7] !== 1)
    throw new PortabilityError('unsupported');
  if (
    bytes[8] !== 0 ||
    bytes.slice(21, 33).some((x) => x !== 0) ||
    bytes[9] === 0 ||
    bytes[10] === 0 ||
    bytes[20] !== 32
  )
    throw new PortabilityError('invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iterations = view.getUint32(11),
    memoryKiB = view.getUint32(15),
    parallelism = bytes[19];
  if (iterations === 0 || parallelism === 0 || memoryKiB < 8 * parallelism)
    throw new PortabilityError('invalid');
  if (iterations > 14 || memoryKiB > 262144 || parallelism > 4)
    throw new PortabilityError('resources');
  const offset = HEADER_SIZE + bytes[9] + bytes[10];
  if (offset + 16 >= bytes.length) throw new PortabilityError('invalid');
  return {
    iterations,
    memoryKiB,
    parallelism,
    offset,
    salt: bytes.slice(HEADER_SIZE, HEADER_SIZE + bytes[9]),
    nonce: bytes.slice(HEADER_SIZE + bytes[9], offset),
  };
}

async function deriveKey(
  password: string,
  header: Omit<BRC39Header, 'offset' | 'nonce'>
): Promise<CryptoKey> {
  const key = await argon2id({
    password: encoder.encode(password.normalize('NFC')),
    salt: header.salt,
    iterations: header.iterations,
    memorySize: header.memoryKiB,
    parallelism: header.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
  try {
    return await crypto.subtle.importKey('raw', copyBuffer(key), 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
  } finally {
    key.fill(0);
  }
}

/** Native WebCrypto avoids the SDK's per-byte number-array copies for large files.
 * The envelope and cryptographic parameters are unchanged BRC-39, tested against Toolbox. */
export async function encodeArchive(
  document: BRC38WalletData,
  format: ArchiveFormat,
  password: string
): Promise<Uint8Array> {
  const plaintext = canonicalArchiveBytes(document);
  checkArchiveSize(plaintext.length + (format === 'brc39' ? 113 : 0));
  if (format === 'brc38') return plaintext;
  if (password.length < 12) throw new PortabilityError('password');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE)),
    nonce = crypto.getRandomValues(new Uint8Array(NONCE_SIZE));
  const header = new Uint8Array(HEADER_SIZE + SALT_SIZE + NONCE_SIZE);
  header.set([87, 68, 65, 84, 1, 1, 38, 1, 0, SALT_SIZE, NONCE_SIZE]);
  const view = new DataView(header.buffer);
  view.setUint32(11, 7);
  view.setUint32(15, 131072);
  header[19] = 1;
  header[20] = 32;
  header.set(salt, HEADER_SIZE);
  header.set(nonce, HEADER_SIZE + SALT_SIZE);
  const key = await deriveKey(password, { salt, iterations: 7, memoryKiB: 131072, parallelism: 1 });
  try {
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, plaintext)
    );
    const file = new Uint8Array(header.length + encrypted.length);
    file.set(header);
    file.set(encrypted, header.length);
    return file;
  } finally {
    plaintext.fill(0);
  }
}

export async function decodeArchive(bytes: Uint8Array, password: string): Promise<BRC38WalletData> {
  checkArchiveSize(bytes.length);
  let plaintext = bytes;
  const encrypted = bytes[0] === 87 && bytes[1] === 68 && bytes[2] === 65 && bytes[3] === 84;
  if (encrypted) {
    const header = readArchiveHeader(bytes);
    const key = await deriveKey(password, header);
    try {
      plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: copyBuffer(header.nonce), tagLength: 128 },
          key,
          copyBuffer(bytes.subarray(header.offset))
        )
      );
    } catch {
      throw new PortabilityError('password');
    }
  }
  try {
    return parseArchiveBytes(plaintext);
  } catch (error) {
    if (error instanceof PortabilityError) throw error;
    throw new PortabilityError('invalid');
  } finally {
    if (encrypted) plaintext.fill(0);
  }
}
