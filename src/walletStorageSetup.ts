import {
  addBackupTarget, beginWalletStorageOperation, isMatchingPendingWalletStorageOperation,
  type NetworkWalletStorageConfig, type WalletStorageTarget, type WalletStorageNetwork
} from './walletStorageConfig'

export function validateWalletStorageCapabilities (settings: {
  chain?: string; storageIdentityKey?: string; syncCheckpointVersion?: number
  syncTransfer?: { version?: number; maxBytes?: number; partBytes?: number; inlineBytes?: number }
}, network: WalletStorageNetwork): void {
  if (settings.chain !== network) throw new Error(`This provider uses a different wallet network (${settings.chain ?? 'unspecified'}); this wallet requires ${network}. Choose a compatible provider.`)
  if (!settings.storageIdentityKey) throw new Error('This provider did not return a storage identity.')
  const transfer = settings.syncTransfer
  if (transfer !== undefined && (transfer.version !== 1 || !Number.isSafeInteger(transfer.maxBytes) ||
    transfer.maxBytes! < 1 || transfer.maxBytes! > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(transfer.partBytes) || transfer.partBytes! < 1024 || transfer.partBytes! > 256 * 1024 ||
    (transfer.inlineBytes !== undefined && (!Number.isSafeInteger(transfer.inlineBytes) || transfer.inlineBytes < 1024 || transfer.inlineBytes > 64 * 1024 * 1024)))) {
    throw new Error('This provider advertises an unsupported large-record backup protocol. Update the provider before using it.')
  }
  if (settings.syncCheckpointVersion !== undefined && settings.syncCheckpointVersion !== 1) {
    throw new Error('This provider uses an unsupported backup protocol. Update the app or choose another provider.')
  }
}

/** Read/authenticate capabilities before creating a durable journal; journal before copying any data. */
export async function prepareWalletBackupSetup<T> (
  config: NetworkWalletStorageConfig, target: WalletStorageTarget,
  discover: () => Promise<T>, save: (config: NetworkWalletStorageConfig) => NetworkWalletStorageConfig,
  operationId: () => string
): Promise<{ attached: T; pendingConfig: NetworkWalletStorageConfig }> {
  addBackupTarget(config, target)
  const resume = isMatchingPendingWalletStorageOperation(config, 'add-backup', target)
  if (config.pendingOperation && !resume) throw new Error('Finish or cancel the interrupted setup before starting another backup.')
  const attached = await discover()
  const pendingConfig = resume ? config : save(beginWalletStorageOperation(config, 'add-backup', target, operationId()))
  return { attached, pendingConfig }
}
