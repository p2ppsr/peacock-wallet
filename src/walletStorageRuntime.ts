import type {
  NetworkWalletStorageConfig,
  WalletStorageTarget
} from './walletStorageConfig'
import {
  normalizeRemoteStorageUrl,
  walletStorageTargetId,
  walletStorageTargetsEqual
} from './walletStorageConfig'

export interface WalletStorageInfoLike {
  isActive: boolean
  isEnabled: boolean
  isBackup: boolean
  isConflicting: boolean
  storageIdentityKey: string
  storageName: string
  storageClass: string
  endpointURL?: string
}

export interface WalletStorageManagerLike {
  isActiveEnabled: boolean
  getStores(): WalletStorageInfoLike[]
  setActive(storageIdentityKey: string, progress?: (message: string) => string): Promise<string>
}

export interface WalletStorageSyncManagerLike extends WalletStorageManagerLike {
  updateBackups(activeSync?: undefined, progress?: (message: string) => string): Promise<string>
}

export const WALLET_STORAGE_SYNC_MAX_ROUGH_SIZE = 2 * 1024 * 1024
export const WALLET_STORAGE_SYNC_MAX_ITEMS = 250
export const WALLET_STORAGE_SYNC_MAX_ENCODED_BYTES = 6 * 1024 * 1024
export const WALLET_STORAGE_SYNC_DOWNLOAD_MAX_ROUGH_SIZE = 2 * 1024 * 1024
export const WALLET_STORAGE_SYNC_DOWNLOAD_MAX_ITEMS = 250
export const WALLET_STORAGE_SYNC_DOWNLOAD_MIN_ROUGH_SIZE = 64 * 1024
export const WALLET_STORAGE_SYNC_DOWNLOAD_MAX_TIMEOUT_RETRIES = 2
export const WALLET_STORAGE_SYNC_PROGRESS_PREFIX = 'wallet-storage-sync-progress:'

export function applyWalletStorageUploadChunkLimits<T extends { maxRoughSize: number; maxItems: number }> (
  args: T
): T {
  args.maxRoughSize = Math.min(args.maxRoughSize, WALLET_STORAGE_SYNC_MAX_ROUGH_SIZE)
  args.maxItems = Math.min(args.maxItems, WALLET_STORAGE_SYNC_MAX_ITEMS)
  return args
}

type WalletStorageUploadChunkArgs = {
  maxRoughSize: number
  maxItems: number
  offsets?: Array<{ name: string; offset: number }>
}

const syncChunkArrayProperties = [
  'provenTxs',
  'outputBaskets',
  'outputTags',
  'txLabels',
  'transactions',
  'outputs',
  'txLabelMaps',
  'outputTagMaps',
  'certificates',
  'certificateFields',
  'commissions',
  'provenTxReqs'
] as const

function walletStorageUploadBodyBytes (
  args: WalletStorageUploadChunkArgs,
  chunk: object
): number {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'processSyncChunk',
    params: [args, chunk],
    id: Number.MAX_SAFE_INTEGER
  })
  return new TextEncoder().encode(body).byteLength
}

function walletStorageSyncChunkRecordCount (chunk: object): number {
  const values = chunk as Record<string, unknown>
  return syncChunkArrayProperties.reduce((count, property) => {
    const records = values[property]
    return count + (Array.isArray(records) ? records.length : 0)
  }, 0)
}

/**
 * Wallet Toolbox's maxRoughSize is based on the sum of individual row JSON,
 * while the actual JSON-RPC envelope can be materially larger. Re-read the
 * same immutable page with tighter limits until the request that will be sent
 * to a remote writer fits below common 8 MiB provider limits.
 */
export async function getBoundedWalletStorageUploadChunk<
  TArgs extends WalletStorageUploadChunkArgs,
  TChunk extends object
> (
  args: TArgs,
  getChunk: (args: TArgs) => Promise<TChunk>,
  allowOversizedRecord = false
): Promise<TChunk> {
  applyWalletStorageUploadChunkLimits(args)

  for (;;) {
    const chunk = await getChunk(args)
    const encodedBytes = walletStorageUploadBodyBytes(args, chunk)
    if (encodedBytes <= WALLET_STORAGE_SYNC_MAX_ENCODED_BYTES) return chunk

    const recordCount = walletStorageSyncChunkRecordCount(chunk)
    if (recordCount <= 1) {
      // The destination transport owns its negotiated wire limit and can stage a single large record.
      if (allowOversizedRecord) return chunk
      const values = chunk as Record<string, unknown>
      const entity = args.offsets?.find(offset => {
        const property = syncChunkPropertyByEntity[offset.name]
        return property != null && Array.isArray(values[property]) && values[property].length > 0
      })?.name ?? 'wallet data'
      throw new Error(
        `A single ${syncStageLabel(entity)} record is ${Math.ceil(encodedBytes / 1024 / 1024)} MiB when encoded, ` +
        'which exceeds the remote provider\'s safe sync request size. Update Peacock and the provider to support large-record transfers, then resume setup. Your saved copies have not been removed.'
      )
    }

    const scale = Math.min(0.8, WALLET_STORAGE_SYNC_MAX_ENCODED_BYTES / encodedBytes * 0.8)
    const nextRoughSize = Math.max(1, Math.floor(args.maxRoughSize * scale))
    const nextMaxItems = Math.max(1, Math.floor(args.maxItems * scale))
    args.maxRoughSize = nextRoughSize < args.maxRoughSize
      ? nextRoughSize
      : Math.max(1, Math.floor(args.maxRoughSize / 2))
    args.maxItems = nextMaxItems < args.maxItems
      ? nextMaxItems
      : Math.max(1, Math.floor(args.maxItems / 2))
  }
}

const isWalletStorageBodyTooLargeError = (error: unknown): boolean =>
  error instanceof Error && /network error 413(?:\s|$)/i.test(error.message)

const isWalletStorageAuthenticatedResponseTimeout = (error: unknown): boolean =>
  error instanceof Error && /timed out waiting for authenticated response/i.test(error.message)

/**
 * Remote readers can enforce a response-size ceiling before the client gets a
 * chunk to measure. Start near (but safely below) the deployed 8 MiB ceiling,
 * and retry the same read-only page with a smaller requested response after a
 * 413. The writer offsets are unchanged until a chunk is processed, so retries
 * are idempotent.
 */
export async function getBoundedWalletStorageDownloadChunk<
  TArgs extends WalletStorageUploadChunkArgs,
  TChunk extends object
> (
  args: TArgs,
  getChunk: (args: TArgs) => Promise<TChunk>,
  onRetry?: (maxRoughSize: number, reason: 'response-too-large' | 'response-timeout') => void
): Promise<TChunk> {
  args.maxRoughSize = Math.min(args.maxRoughSize, WALLET_STORAGE_SYNC_DOWNLOAD_MAX_ROUGH_SIZE)
  args.maxItems = Math.min(args.maxItems, WALLET_STORAGE_SYNC_DOWNLOAD_MAX_ITEMS)
  let timeoutRetries = 0

  for (;;) {
    try {
      return await getChunk(args)
    } catch (error: unknown) {
      const responseTooLarge = isWalletStorageBodyTooLargeError(error)
      const responseTimedOut = isWalletStorageAuthenticatedResponseTimeout(error)
      if (!responseTooLarge && !responseTimedOut) throw error
      if (responseTimedOut && timeoutRetries >= WALLET_STORAGE_SYNC_DOWNLOAD_MAX_TIMEOUT_RETRIES) throw error
      if (args.maxRoughSize <= WALLET_STORAGE_SYNC_DOWNLOAD_MIN_ROUGH_SIZE) {
        if (responseTimedOut) throw error
        if (args.maxItems !== 1) {
          args.maxItems = 1
          continue
        }
        throw new Error(
          'The remote provider cannot return a single wallet sync record within its response-size limit. ' +
          'Ask the provider to enable large-record transfers, ensure Peacock is updated, then resume setup. Your saved copies have not been removed.'
        )
      }
      if (responseTimedOut) timeoutRetries += 1
      args.maxRoughSize = Math.max(
        WALLET_STORAGE_SYNC_DOWNLOAD_MIN_ROUGH_SIZE,
        Math.floor(args.maxRoughSize / 2)
      )
      args.maxItems = Math.max(1, Math.floor(args.maxItems / 2))
      if (responseTimedOut) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (timeoutRetries - 1)))
      onRetry?.(
        args.maxRoughSize,
        responseTimedOut ? 'response-timeout' : 'response-too-large'
      )
    }
  }
}

interface SyncChunkProgressArgsLike {
  fromStorageIdentityKey: string
  toStorageIdentityKey: string
  since?: Date | string
  offsets: Array<{ name: string; offset: number }>
}

type SyncChunkProgressEntity = { updated_at?: Date | string }
type SyncChunkProgressLike = object

export interface WalletStorageSyncChunkProgress {
  phase: string
  records: number
  completedRecords?: number
  totalRecords?: number
  stageIndex: number
  stageCount: number
  stageName: string
  stageOffset: number
  since?: string
  earliestUpdatedAt?: string
  latestUpdatedAt?: string
}

const syncChunkPropertyByEntity: Record<string, string> = {
  provenTx: 'provenTxs',
  outputBasket: 'outputBaskets',
  outputTag: 'outputTags',
  txLabel: 'txLabels',
  transaction: 'transactions',
  output: 'outputs',
  txLabelMap: 'txLabelMaps',
  outputTagMap: 'outputTagMaps',
  certificate: 'certificates',
  certificateField: 'certificateFields',
  commission: 'commissions',
  provenTxReq: 'provenTxReqs'
}

const syncStageLabel = (name: string): string => ({
  provenTx: 'transaction proofs',
  outputBasket: 'output baskets',
  outputTag: 'output tags',
  txLabel: 'transaction labels',
  transaction: 'transactions',
  output: 'outputs',
  txLabelMap: 'transaction label links',
  outputTagMap: 'output tag links',
  certificate: 'certificates',
  certificateField: 'certificate fields',
  commission: 'commissions',
  provenTxReq: 'proof requests'
}[name] ?? name)

const validIso = (value: unknown): string | undefined => {
  if (!(value instanceof Date) && typeof value !== 'string') return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

export function summarizeWalletStorageSyncChunk (
  args: SyncChunkProgressArgsLike,
  chunk: SyncChunkProgressLike,
  knownTotalRecords?: number
): WalletStorageSyncChunkProgress {
  const values = chunk as Record<string, unknown>
  let records = 0
  let stageIndex = 0
  let stageItems: SyncChunkProgressEntity[] = []

  args.offsets.forEach((offset, index) => {
    const property = syncChunkPropertyByEntity[offset.name]
    const items = property && Array.isArray(values[property])
      ? values[property] as SyncChunkProgressEntity[]
      : []
    records += items.length
    if (items.length > 0) {
      stageIndex = index
      stageItems = items
    }
  })

  const timestamps = stageItems
    .map(item => validIso(item.updated_at))
    .filter((value): value is string => Boolean(value))
    .sort()
  const stage = args.offsets[stageIndex] ?? { name: 'wallet data', offset: 0 }
  const chunkTotals = values.totals as { totalRecords?: unknown } | undefined
  const reportedTotalRecords = chunkTotals?.totalRecords
  const totalRecords = typeof reportedTotalRecords === 'number' &&
    Number.isSafeInteger(reportedTotalRecords) && reportedTotalRecords >= 0
    ? reportedTotalRecords
    : typeof knownTotalRecords === 'number' &&
      Number.isSafeInteger(knownTotalRecords) && knownTotalRecords >= 0
      ? knownTotalRecords
      : undefined
  const completedRecords = totalRecords == null
    ? undefined
    : Math.min(
        totalRecords,
        args.offsets.reduce((total, offset) => (
          total + (Number.isSafeInteger(offset.offset) && offset.offset > 0 ? offset.offset : 0)
        ), 0) + records
      )
  return {
    phase: `${args.fromStorageIdentityKey}:${args.toStorageIdentityKey}`,
    records,
    completedRecords,
    totalRecords,
    stageIndex,
    stageCount: Math.max(args.offsets.length, 1),
    stageName: syncStageLabel(stage.name),
    stageOffset: stage.offset + stageItems.length,
    since: validIso(args.since),
    earliestUpdatedAt: timestamps[0],
    latestUpdatedAt: timestamps[timestamps.length - 1]
  }
}

export function encodeWalletStorageSyncProgress (progress: WalletStorageSyncChunkProgress): string {
  return `${WALLET_STORAGE_SYNC_PROGRESS_PREFIX}${JSON.stringify(progress)}`
}

export function parseWalletStorageSyncProgress (message: string): WalletStorageSyncChunkProgress | undefined {
  if (!message.startsWith(WALLET_STORAGE_SYNC_PROGRESS_PREFIX)) return undefined
  try {
    return JSON.parse(message.slice(WALLET_STORAGE_SYNC_PROGRESS_PREFIX.length)) as WalletStorageSyncChunkProgress
  } catch {
    return undefined
  }
}

export type WalletStorageProviderState =
  | 'active'
  | 'backup'
  | 'conflicting'
  | 'unavailable'

export interface WalletStorageProviderStatus {
  target: WalletStorageTarget
  role: 'primary' | 'backup'
  state: WalletStorageProviderState
  storageIdentityKey?: string
  storageName?: string
  storageClass?: string
  error?: string
  lastSuccessfulSyncAt?: string
}

export function walletStorageTargetForStore (
  store: WalletStorageInfoLike
): WalletStorageTarget {
  if (store.endpointURL) {
    return { kind: 'remote', url: normalizeRemoteStorageUrl(store.endpointURL) }
  }
  return { kind: 'local' }
}

export function findStoreForTarget (
  stores: WalletStorageInfoLike[],
  target: WalletStorageTarget
): WalletStorageInfoLike | undefined {
  return stores.find(store => walletStorageTargetsEqual(walletStorageTargetForStore(store), target))
}

export function buildWalletStorageProviderStatuses (
  config: NetworkWalletStorageConfig,
  stores: WalletStorageInfoLike[],
  errors: ReadonlyMap<string, string> = new Map()
): WalletStorageProviderStatus[] {
  const targets: Array<{ target: WalletStorageTarget; role: 'primary' | 'backup' }> = [
    { target: config.primary, role: 'primary' },
    ...config.backups.map(target => ({ target, role: 'backup' as const }))
  ]

  return targets.map(({ target, role }) => {
    const id = walletStorageTargetId(target)
    const store = findStoreForTarget(stores, target)
    if (!store) {
      return {
        target,
        role,
        state: 'unavailable',
        error: errors.get(id),
        lastSuccessfulSyncAt: config.lastSuccessfulSyncAt[id]
      }
    }
    const state: WalletStorageProviderState = store.isConflicting || (store.isActive && !store.isEnabled)
      ? 'conflicting'
      : store.isActive
        ? 'active'
        : 'backup'
    return {
      target,
      role,
      state,
      storageIdentityKey: store.storageIdentityKey,
      storageName: store.storageName,
      storageClass: store.storageClass,
      error: errors.get(id),
      lastSuccessfulSyncAt: config.lastSuccessfulSyncAt[id]
    }
  })
}

export async function enforceConfiguredPrimary (
  manager: WalletStorageManagerLike,
  config: NetworkWalletStorageConfig,
  progress?: (message: string) => void
): Promise<void> {
  const before = manager.getStores()
  const configuredPrimary = findStoreForTarget(before, config.primary)
  if (!configuredPrimary) {
    throw new Error('Configured primary storage is unavailable')
  }

  if (!configuredPrimary.isActive || !configuredPrimary.isEnabled || !manager.isActiveEnabled) {
    await manager.setActive(configuredPrimary.storageIdentityKey, message => {
      progress?.(message)
      return message
    })
  }

  const after = manager.getStores()
  const activeEnabled = after.filter(store => store.isActive && store.isEnabled && !store.isConflicting)
  const active = activeEnabled[0]
  if (activeEnabled.length !== 1 || !active || !walletStorageTargetsEqual(walletStorageTargetForStore(active), config.primary)) {
    throw new Error('Wallet storage primary could not be reconciled safely')
  }
}

export async function synchronizeConfiguredBackups (
  manager: WalletStorageSyncManagerLike,
  config: NetworkWalletStorageConfig,
  progress?: (message: string) => void
): Promise<void> {
  await enforceConfiguredPrimary(manager, config, progress)
  await manager.updateBackups(undefined, message => {
    progress?.(message)
    return message
  })
}
