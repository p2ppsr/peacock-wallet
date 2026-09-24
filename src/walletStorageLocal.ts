import type { WalletStorageNetwork } from './walletStorageConfig'

interface LocalDatabaseInfo { storageIdentityKey?: string; chain?: string; hasUser: boolean }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** Inspect metadata only. Aborting an upgrade avoids creating a missing legacy database. */
export async function inspectLocalWalletDatabase (name: string, identityKey: string): Promise<LocalDatabaseInfo | undefined> {
  return await new Promise((resolve, reject) => {
    let finished = false
    let opened: IDBDatabase | undefined
    const finish = (value: LocalDatabaseInfo | undefined, error?: unknown) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      opened?.close()
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => finish(undefined, new Error('The device database is still busy. Close other wallet windows and try again.')), 15_000)
    let request: IDBOpenDBRequest
    try { request = indexedDB.open(name) } catch (error) { finish(undefined, error); return }
    let missing = false
    request.onupgradeneeded = () => { missing = true; request.transaction!.abort() }
    request.onerror = () => finish(undefined, missing ? undefined : request.error ?? new Error('Could not inspect the device backup'))
    request.onblocked = () => finish(undefined, new Error('Close other wallet windows before checking the device backup'))
    request.onsuccess = () => {
      const db = request.result
      opened = db
      if (finished) { db.close(); return }
      db.onversionchange = () => db.close()
      try {
        if (!db.objectStoreNames.contains('settings') || !db.objectStoreNames.contains('users')) {
          db.close(); finish({ hasUser: false }); return
        }
        const transaction = db.transaction(['settings', 'users'], 'readonly')
        const settings = transaction.objectStore('settings').getAll()
        const users = transaction.objectStore('users').index('identityKey').get(identityKey)
        transaction.oncomplete = () => {
          db.close()
          finish({ storageIdentityKey: settings.result[0]?.storageIdentityKey, chain: settings.result[0]?.chain, hasUser: Boolean(users.result) })
        }
        transaction.onerror = () => { db.close(); finish(undefined, transaction.error) }
        transaction.onabort = () => { db.close(); finish(undefined, transaction.error ?? new Error('Device backup inspection was interrupted')) }
      } catch (error) { db.close(); finish(undefined, error) }
    }
  })
}

export function localWalletDatabaseName (network: WalletStorageNetwork, identityKey: string, storageIdentityKey: string): string {
  if (!/^[a-f0-9]{66}$/i.test(identityKey) || !/^[a-f0-9]{64}$/i.test(storageIdentityKey)) {
    throw new Error('Valid wallet and storage identities are required for a device backup')
  }
  return `peacock-wallet-${network}-${identityKey}-${storageIdentityKey}`
}

/** Preserve legacy data in place. New stores get deterministic app/wallet-scoped names. */
export async function resolveLocalWalletDatabase (
  storage: Storage, network: WalletStorageNetwork, identityKey: string, storageIdentityKey: string,
  requireExisting: boolean,
  inspect = inspectLocalWalletDatabase
): Promise<{ name: string; storageIdentityKey: string }> {
  const key = `peacock.wallet-storage-db.v1.${network}.${identityKey}`
  const deterministic = localWalletDatabaseName(network, identityKey, storageIdentityKey)
  const legacy = `wallet-toolbox-${network}net`
  const saved = storage.getItem(key)
  if (saved) {
    const binding = JSON.parse(saved) as { name: string; storageIdentityKey: string }
    if (binding.name !== legacy && binding.name !== localWalletDatabaseName(network, identityKey, binding.storageIdentityKey)) {
      throw new Error('The saved device backup location needs recovery')
    }
    const info = await inspect(binding.name, identityKey)
    if ((!info?.hasUser && requireExisting) || (info && (info.chain !== network || info.storageIdentityKey !== binding.storageIdentityKey))) {
      throw new Error('The saved device backup is missing or belongs to a different storage identity. Its saved data has not been changed.')
    }
    return binding
  }
  const old = await inspect(legacy, identityKey)
  const binding = old?.hasUser && old.chain === network && old.storageIdentityKey
    ? { name: legacy, storageIdentityKey: old.storageIdentityKey }
    : { name: deterministic, storageIdentityKey }
  if (requireExisting && binding.name !== legacy) {
    const info = await inspect(deterministic, identityKey)
    if (!info?.hasUser || info.storageIdentityKey !== storageIdentityKey || info.chain !== network) {
      throw new Error('The existing device backup could not be found. Reconnect or restore it before using this location.')
    }
  }
  storage.setItem(key, JSON.stringify(binding))
  if (storage.getItem(key) !== JSON.stringify(binding)) throw new Error('Could not verify the device backup location')
  return binding
}
