import {
  StorageIdb,
  WalletStorageManager,
  sdk
} from '@bsv/wallet-toolbox-client'

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

export type WalletStorageBenchmarkEntity = typeof syncChunkArrayProperties[number]

export interface WalletStorageBenchmarkPage {
  page: number
  records: number
  logicalBytes: number
  readMs: number
  measurementMs: number
  writeMs: number
  inserts: number
  updates: number
  maxRoughSize: number
  maxItems: number
  entities: Partial<Record<WalletStorageBenchmarkEntity, number>>
}

export interface WalletStorageBenchmarkResult {
  complete: boolean
  startedAt: string
  completedAt: string
  durationMs: number
  databaseName: string
  sourceName: string
  destinationName: string
  pages: WalletStorageBenchmarkPage[]
  totals: {
    pages: number
    records: number
    logicalBytes: number
    readMs: number
    measurementMs: number
    writeMs: number
    inserts: number
    updates: number
    recordsPerSecond: number
    readRecordsPerSecond: number
    writeRecordsPerSecond: number
  }
  entities: Partial<Record<WalletStorageBenchmarkEntity, number>>
  eventLoop: {
    sampleIntervalMs: number
    samples: number
    maximumDelayMs: number
    p95DelayMs: number
    foreground?: { samples: number; maximumDelayMs: number; p95DelayMs: number }
  }
  cleanupSucceeded: boolean
}

export interface RunWalletStorageBenchmarkOptions {
  manager: WalletStorageManager
  writer: StorageIdb
  databaseName: string
  report?: (message: string) => void
  throwIfCancelled?: () => void
  now?: () => number
  isForeground?: () => boolean
  source?: sdk.WalletStorageProvider
  maxPages?: number
}

class BenchmarkSampleComplete extends Error {}

const logicalChunkSize = (chunk: sdk.SyncChunk): number => {
  const encoded = JSON.stringify(chunk)
  return new TextEncoder().encode(encoded).byteLength
}

const entityCounts = (
  chunk: sdk.SyncChunk
): Partial<Record<WalletStorageBenchmarkEntity, number>> => {
  const values = chunk as unknown as Record<string, unknown>
  const counts: Partial<Record<WalletStorageBenchmarkEntity, number>> = {}
  for (const property of syncChunkArrayProperties) {
    const value = values[property]
    if (Array.isArray(value) && value.length > 0) counts[property] = value.length
  }
  return counts
}

const sumCounts = (counts: Partial<Record<WalletStorageBenchmarkEntity, number>>): number =>
  Object.values(counts).reduce<number>((sum, count) => sum + (count ?? 0), 0)

const addCounts = (
  target: Partial<Record<WalletStorageBenchmarkEntity, number>>,
  source: Partial<Record<WalletStorageBenchmarkEntity, number>>
): void => {
  for (const [property, count] of Object.entries(source)) {
    const entity = property as WalletStorageBenchmarkEntity
    target[entity] = (target[entity] ?? 0) + (count ?? 0)
  }
}

const percentile = (values: number[], fraction: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

const formatSeconds = (milliseconds: number): string => `${(milliseconds / 1000).toFixed(1)}s`

/**
 * Copies the active wallet into an unattached StorageIdb instance for profiling.
 * The writer is never added to the manager, selected as active, or persisted in
 * application storage configuration. The caller owns destruction of the writer.
 */
export async function runWalletStorageBenchmark (
  options: RunWalletStorageBenchmarkOptions
): Promise<Omit<WalletStorageBenchmarkResult, 'cleanupSucceeded'>> {
  const {
    manager,
    writer,
    databaseName,
    report = () => undefined,
    throwIfCancelled = () => undefined,
    now = () => performance.now()
  } = options
  if (options.maxPages != null && (!Number.isSafeInteger(options.maxPages) || options.maxPages < 1)) {
    throw new Error('Benchmark page limit must be a positive safe integer')
  }
  const active = options.source ?? manager.getActive()
  const sourceName = options.source
    ? (await options.source.makeAvailable()).storageName
    : manager.getActiveStoreName()
  const destinationName = (await writer.makeAvailable()).storageName
  const originalGetSyncChunk = active.getSyncChunk
  const originalProcessSyncChunk = writer.processSyncChunk
  const pages: WalletStorageBenchmarkPage[] = []
  const pendingPages: WalletStorageBenchmarkPage[] = []
  const totalsByEntity: Partial<Record<WalletStorageBenchmarkEntity, number>> = {}
  const eventLoopDelays: number[] = []
  const foregroundDelays: number[] = []
  const isForeground = options.isForeground ?? (() =>
    typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus())
  let wasForeground = isForeground()
  const resetForeground = () => { wasForeground = false }
  globalThis.addEventListener?.('blur', resetForeground)
  globalThis.document?.addEventListener('visibilitychange', resetForeground)
  const sampleIntervalMs = 100
  let lastSampleAt = now()
  const eventLoopTimer = globalThis.setInterval(() => {
    const sampledAt = now()
    const delay = Math.max(0, sampledAt - lastSampleAt - sampleIntervalMs)
    eventLoopDelays.push(delay)
    const foreground = isForeground()
    if (foreground && wasForeground) foregroundDelays.push(delay)
    wasForeground = foreground
    lastSampleAt = sampledAt
  }, sampleIntervalMs)
  const startedAtIso = new Date().toISOString()
  const startedAt = now()
  let complete = true

  active.getSyncChunk = async (args: sdk.RequestSyncChunkArgs): Promise<sdk.SyncChunk> => {
    throwIfCancelled()
    const readStartedAt = now()
    const chunk = await originalGetSyncChunk.call(active, args)
    const readFinishedAt = now()
    throwIfCancelled()
    const measurementStartedAt = now()
    const entities = entityCounts(chunk)
    const page: WalletStorageBenchmarkPage = {
      page: pages.length + pendingPages.length + 1,
      records: sumCounts(entities),
      logicalBytes: logicalChunkSize(chunk),
      readMs: readFinishedAt - readStartedAt,
      measurementMs: now() - measurementStartedAt,
      writeMs: 0,
      inserts: 0,
      updates: 0,
      maxRoughSize: args.maxRoughSize,
      maxItems: args.maxItems,
      entities
    }
    pendingPages.push(page)
    return chunk
  }

  writer.processSyncChunk = async (args: sdk.RequestSyncChunkArgs, chunk: sdk.SyncChunk) => {
    const page = pendingPages.shift()
    if (!page) throw new Error('Wallet storage benchmark lost page timing state')
    throwIfCancelled()
    const writeStartedAt = now()
    const result = await originalProcessSyncChunk.call(writer, args, chunk)
    page.writeMs = now() - writeStartedAt
    page.inserts = result.inserts
    page.updates = result.updates
    pages.push(page)
    addCounts(totalsByEntity, page.entities)
    const rate = page.writeMs > 0 ? page.records / (page.writeMs / 1000) : 0
    report(
      `Benchmark page ${page.page.toLocaleString()}: ${page.records.toLocaleString()} records, ` +
      `remote read ${formatSeconds(page.readMs)}, local write ${formatSeconds(page.writeMs)} ` +
      `(${rate.toFixed(1)} records/s).`
    )
    throwIfCancelled()
    if (!result.done && options.maxPages != null && pages.length >= options.maxPages) {
      throw new BenchmarkSampleComplete()
    }
    return result
  }

  try {
    const auth = await manager.getAuth(true)
    const progress = (message: string) => {
      report(message)
      return message
    }
    if (options.source) {
      // Keep the application's sync lock while reading a backup. Passing an
      // explicit reader selects the copy source, never the writable primary.
      await manager.runAsSync(async () => manager.syncToWriter(auth, writer, options.source, '', progress))
    } else {
      await manager.syncToWriter(auth, writer, undefined, '', progress)
    }
  } catch (error) {
    if (!(error instanceof BenchmarkSampleComplete)) throw error
    complete = false
  } finally {
    globalThis.clearInterval(eventLoopTimer)
    globalThis.removeEventListener?.('blur', resetForeground)
    globalThis.document?.removeEventListener('visibilitychange', resetForeground)
    active.getSyncChunk = originalGetSyncChunk
    writer.processSyncChunk = originalProcessSyncChunk
  }

  const completedAt = now()
  const durationMs = completedAt - startedAt
  const records = pages.reduce((sum, page) => sum + page.records, 0)
  const readMs = pages.reduce((sum, page) => sum + page.readMs, 0)
  const measurementMs = pages.reduce((sum, page) => sum + page.measurementMs, 0)
  const writeMs = pages.reduce((sum, page) => sum + page.writeMs, 0)
  const perSecond = (count: number, milliseconds: number): number =>
    milliseconds > 0 ? count / (milliseconds / 1000) : 0

  return {
    complete,
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    durationMs,
    databaseName,
    sourceName,
    destinationName,
    pages,
    totals: {
      pages: pages.length,
      records,
      logicalBytes: pages.reduce((sum, page) => sum + page.logicalBytes, 0),
      readMs,
      measurementMs,
      writeMs,
      inserts: pages.reduce((sum, page) => sum + page.inserts, 0),
      updates: pages.reduce((sum, page) => sum + page.updates, 0),
      recordsPerSecond: perSecond(records, durationMs),
      readRecordsPerSecond: perSecond(records, readMs),
      writeRecordsPerSecond: perSecond(records, writeMs)
    },
    entities: totalsByEntity,
    eventLoop: {
      sampleIntervalMs,
      samples: eventLoopDelays.length,
      maximumDelayMs: eventLoopDelays.reduce((maximum, delay) => Math.max(maximum, delay), 0),
      p95DelayMs: percentile(eventLoopDelays, 0.95),
      foreground: {
        samples: foregroundDelays.length,
        maximumDelayMs: foregroundDelays.reduce((maximum, delay) => Math.max(maximum, delay), 0),
        p95DelayMs: percentile(foregroundDelays, 0.95)
      }
    }
  }
}
