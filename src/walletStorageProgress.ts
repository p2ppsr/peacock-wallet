import type { WalletStorageSyncChunkProgress } from './walletStorageRuntime'

export interface StorageSyncDisplayProgress {
  phase: string
  startedAt: number
  updatedAt: number
  records: number
  chunks: number
  stageIndex: number
  stageCount: number
  stageName: string
  completedRecords?: number
  totalRecords?: number
  fraction?: number
  etaSeconds?: number
  elapsedSeconds: number
  recordsPerSecond: number
}

type ProgressCounts = Omit<StorageSyncDisplayProgress, 'etaSeconds' | 'elapsedSeconds' | 'recordsPerSecond'>

export function liveSyncDisplayProgress (progress: ProgressCounts, now: number): StorageSyncDisplayProgress {
  const elapsedSeconds = Math.max((Math.max(now, progress.updatedAt) - progress.startedAt) / 1000, 0.001)
  const recordsPerSecond = progress.records / elapsedSeconds
  const remaining = progress.totalRecords != null && progress.completedRecords != null
    ? Math.max(0, progress.totalRecords - progress.completedRecords)
    : undefined
  const etaSeconds = remaining === 0 ? 0 : (
    remaining != null && progress.chunks >= 2 && recordsPerSecond > 0
      ? remaining / recordsPerSecond
      : undefined
  )
  return { ...progress, elapsedSeconds, recordsPerSecond, etaSeconds }
}

/** Accumulate independently of the bounded log, including while settings is closed. */
export function updateSyncDisplayProgress (
  previous: StorageSyncDisplayProgress | undefined,
  next: WalletStorageSyncChunkProgress,
  now = Date.now(),
  operationStartedAt = now
): StorageSyncDisplayProgress {
  const samePhase = previous?.phase === next.phase
  const startedAt = samePhase ? previous.startedAt : previous ? now : Math.min(operationStartedAt, now)
  const records = (samePhase ? previous.records : 0) + next.records
  const chunks = (samePhase ? previous.chunks : 0) + (next.records > 0 ? 1 : 0)
  const totalRecords = next.totalRecords ?? (samePhase ? previous.totalRecords : undefined)
  const completedRecords = next.completedRecords ?? (
    samePhase && previous.completedRecords != null
      ? Math.min(totalRecords ?? Number.MAX_SAFE_INTEGER, previous.completedRecords + next.records)
      : undefined
  )
  const fraction = totalRecords != null && completedRecords != null
    ? totalRecords === 0 ? 1 : Math.max(0, Math.min(1, completedRecords / totalRecords))
    : undefined
  return liveSyncDisplayProgress({
    phase: next.phase, startedAt, updatedAt: now, records, chunks,
    stageIndex: next.stageIndex, stageCount: next.stageCount, stageName: next.stageName,
    completedRecords, totalRecords, fraction
  }, now)
}
