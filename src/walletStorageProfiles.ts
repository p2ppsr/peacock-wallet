import {
  LEGACY_WALLET_STORAGE_CONFIG_KEY, WALLET_STORAGE_CONFIG_KEY,
  loadWalletStorageConfig, persistWalletStorageConfig,
  type NetworkWalletStorageConfig, type WalletStorageNetwork
} from './walletStorageConfig'

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** Scope journals, locations and completion times to the actual wallet, not its display name. */
export function walletProfileStorage (storage: Storage, identityKey: string): Storage {
  if (!/^[a-f0-9]{66}$/i.test(identityKey)) throw new Error('A wallet identity is required for backup configuration')
  const key = `${WALLET_STORAGE_CONFIG_KEY}.${identityKey}`
  return {
    getItem: name => name === LEGACY_WALLET_STORAGE_CONFIG_KEY ? null : storage.getItem(name === WALLET_STORAGE_CONFIG_KEY ? key : name),
    setItem: (name, value) => storage.setItem(name === WALLET_STORAGE_CONFIG_KEY ? key : name, value)
  }
}

export function loadProfileWalletStorageConfig (
  storage: Storage, network: WalletStorageNetwork, identityKey: string,
  fallbackUrl: string, createIdentity: () => string
): NetworkWalletStorageConfig {
  const scoped = walletProfileStorage(storage, identityKey)
  const saved = scoped.getItem(WALLET_STORAGE_CONFIG_KEY)
  const hasNetwork = saved ? Boolean(JSON.parse(saved).networks?.[network]) : false
  if (!hasNetwork) {
    const legacy = loadWalletStorageConfig(storage, network, fallbackUrl, createIdentity)
    const ownerKey = `${WALLET_STORAGE_CONFIG_KEY}.legacy-owner.${network}`
    const owner = storage.getItem(ownerKey)
    // The first wallet opened adopts the old settings. Other profiles start with
    // their own configuration; no saved timestamps or unfinished work crosses over.
    if (!owner || owner === identityKey) {
      persistWalletStorageConfig(scoped, network, { ...legacy, lastSuccessfulSyncAt: {} })
      storage.setItem(ownerKey, identityKey)
      if (storage.getItem(ownerKey) !== identityKey) throw new Error('Could not verify backup configuration migration')
    }
  }
  return loadWalletStorageConfig(scoped, network, fallbackUrl, createIdentity)
}
