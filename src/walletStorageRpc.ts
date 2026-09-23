import { StorageClient } from '@bsv/wallet-toolbox-client'
import { backupLocationLabel } from './walletBackupPresentation'
import type { WalletStorageTarget } from './walletStorageConfig'
import { getBoundedWalletStorageDownloadChunk } from './walletStorageRuntime'

export interface WalletStorageFailure {
  target: WalletStorageTarget
  method: string
  timedOut: boolean
  sourceUpgradeRequired?: boolean
  proofReconciliationRequired?: boolean
}

/** Copy only display-safe failure fields; never retain RPC payloads or the cause. */
export function walletStorageFailureDetails (error: WalletStorageProviderError): WalletStorageFailure {
  return {
    target: error.target,
    method: error.method,
    timedOut: error.timedOut,
    sourceUpgradeRequired: error.sourceUpgradeRequired,
    proofReconciliationRequired: error.proofReconciliationRequired
  }
}

export function walletStorageTransferMessage (
  target: WalletStorageTarget,
  progress: { direction: 'read' | 'write'; bytes: number; totalBytes: number }
): string {
  const action = progress.direction === 'read' ? 'Downloading from' : 'Uploading to'
  return `${action} ${backupLocationLabel(target)}: ${(progress.bytes / 1024 / 1024).toFixed(1)} of ` +
    `${(progress.totalBytes / 1024 / 1024).toFixed(1)} MiB for this record. The counter restarts for each record.`
}

export class WalletStorageProviderError extends Error implements WalletStorageFailure {
  readonly timedOut: boolean
  readonly sourceUpgradeRequired: boolean
  readonly proofReconciliationRequired: boolean
  constructor (readonly target: WalletStorageTarget, readonly method: string, readonly cause: unknown) {
    const original = cause instanceof Error ? cause.message : String(cause)
    const detail = method === 'processSyncChunk' && /network error 413/.test(original)
      ? `This provider could not accept the backup page within its size limit. Update Peacock and the provider to support large-record transfers, then resume setup. ${original}`
      : original
    super(`${backupLocationLabel(target)} (${method}): ${detail}`)
    this.name = 'WalletStorageProviderError'
    this.timedOut = /timed out waiting for authenticated response/i.test(detail)
    this.proofReconciliationRequired = (method === 'processSyncChunk' || method === 'commitSyncTransfer') && /current proof could not be verified/.test(original)
    this.sourceUpgradeRequired = method === 'getSyncChunk' && /single wallet sync record within its response-size limit/.test(original)
  }
}

/** Keep protocol handling in Toolbox; annotate failures and retry only explicitly read-only metadata. */
export class WalletBackupStorageClient extends StorageClient {
  onRetry?: (message: string) => void
  checkCancelled?: () => void

  /** Keep failures from page-size recovery attributed to the source, including device backups. */
  async getBoundedSyncChunk (
    args: Parameters<StorageClient['getSyncChunk']>[0],
    onRetry?: Parameters<typeof getBoundedWalletStorageDownloadChunk>[2]
  ): ReturnType<StorageClient['getSyncChunk']> {
    try {
      return await getBoundedWalletStorageDownloadChunk(args, request => super.getSyncChunk(request), onRetry)
    } catch (cause) {
      if (cause instanceof WalletStorageProviderError) throw cause
      throw new WalletStorageProviderError({ kind: 'remote', url: this.endpointUrl }, 'getSyncChunk', cause)
    }
  }

  protected override async rpcCall<T> (method: string, params: unknown[]): Promise<T> {
    const safeRead = method === 'makeAvailable' || method === 'getSyncCheckpoint'
    const transferRequest = method.endsWith('SyncTransfer') || method.endsWith('SyncTransferPart')
    const backupRequest = transferRequest || safeRead || ['getSyncChunk', 'processSyncChunk', 'setActive',
      'findOrInsertUser', 'findOrInsertSyncStateAuth'].includes(method)
    for (let attempt = 0; ; attempt++) {
      if ((transferRequest && method !== 'releaseSyncTransfer') || safeRead || method === 'getSyncChunk' || method === 'processSyncChunk') this.checkCancelled?.()
      try {
        return await super.rpcCall<T>(method, params)
      } catch (cause) {
        if (!backupRequest) throw cause
        const error = new WalletStorageProviderError({ kind: 'remote', url: this.endpointUrl }, method, cause)
        if (!safeRead || !error.timedOut || attempt >= 2) throw error
        this.onRetry?.(`${backupLocationLabel(error.target)} did not respond while checking saved backup state. Retrying (${attempt + 1}/2)…`)
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
      }
    }
  }
}
