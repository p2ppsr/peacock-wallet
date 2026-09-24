import { describe, expect, it } from 'vitest'
import {
  LEGACY_WALLET_STORAGE_CONFIG_KEY,
  WALLET_STORAGE_CONFIG_KEY,
  addBackupTarget,
  beginWalletStorageOperation,
  clearPendingWalletStorageOperation,
  isMatchingPendingWalletStorageOperation,
  loadWalletStorageConfig,
  makePrimaryTarget,
  normalizeRemoteStorageUrl,
  persistWalletStorageConfig,
  recoverPendingWalletStorageOperation,
  walletStorageTargetId
} from './walletStorageConfig'

class MemoryStorage {
  values = new Map<string, string>()
  getItem (key: string): string | null { return this.values.get(key) ?? null }
  setItem (key: string, value: string): void { this.values.set(key, value) }
  removeItem (key: string): void { this.values.delete(key) }
}

const keyFactory = () => '11'.repeat(32)

describe('wallet storage configuration', () => {
  it('recovers an interrupted backup target after restart without promoting or marking it synced', () => {
    const storage = new MemoryStorage()
    const initial = loadWalletStorageConfig(storage, 'main', 'https://storage.example.com', keyFactory)
    const pending = beginWalletStorageOperation(initial, 'add-backup', { kind: 'local' }, 'add-1')
    persistWalletStorageConfig(storage, 'main', pending)
    const restarted = loadWalletStorageConfig(storage, 'main', 'https://storage.example.com', keyFactory)
    const recovered = recoverPendingWalletStorageOperation(restarted)
    expect(recovered.backups).toEqual([{ kind: 'local' }])
    expect(recovered.primary).toEqual(initial.primary)
    expect(recovered.localStorageIdentityKey).toBe(initial.localStorageIdentityKey)
    expect(recovered.lastSuccessfulSyncAt).toEqual(initial.lastSuccessfulSyncAt)
    expect(recovered.pendingOperation).toBeUndefined()
    expect(recoverPendingWalletStorageOperation(recovered)).toBe(recovered)
    const persisted = persistWalletStorageConfig(storage, 'main', recovered)
    expect(loadWalletStorageConfig(storage, 'main', 'https://storage.example.com', keyFactory)).toEqual(persisted)
  })

  it('recovers a pending primary change to the configured primary without a second promotion', () => {
    const initial = loadWalletStorageConfig(new MemoryStorage(), 'main', 'https://storage.example.com', keyFactory)
    const withBackup = addBackupTarget(initial, { kind: 'local' })
    const pending = beginWalletStorageOperation(withBackup, 'set-primary', { kind: 'local' }, 'swap-1')
    const recovered = recoverPendingWalletStorageOperation(pending)
    expect(recovered).toEqual(withBackup)
    expect(recovered.primary).toEqual(initial.primary)
  })

  it('normalizes secure URLs and permits HTTP only for loopback development', () => {
    expect(normalizeRemoteStorageUrl('https://storage.example.com/')).toBe('https://storage.example.com')
    expect(normalizeRemoteStorageUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080')
    expect(() => normalizeRemoteStorageUrl('http://storage.example.com')).toThrow(/HTTPS/)
    expect(() => normalizeRemoteStorageUrl('http://127.evil.example.com')).toThrow(/HTTPS/)
    expect(() => normalizeRemoteStorageUrl('https://user:pass@storage.example.com')).toThrow(/credentials/)
  })

  it('fails when durable configuration writes cannot be verified', () => {
    const storage = new MemoryStorage()
    storage.setItem = (key, value) => storage.values.set(key, `${value}corrupt`)

    expect(() => loadWalletStorageConfig(
      storage,
      'main',
      'https://storage.example.com',
      keyFactory
    )).toThrow(/could not be verified/)
  })

  it('migrates the PR 42 legacy shape without duplicating the primary', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_WALLET_STORAGE_CONFIG_KEY, JSON.stringify({
      useRemoteStorage: false,
      selectedStorageUrl: 'https://storage.example.com',
      backupStorageUrls: ['https://storage.example.com/', 'LOCAL_STORAGE']
    }))

    const config = loadWalletStorageConfig(storage, 'main', 'https://fallback.example.com', keyFactory)
    expect(config.primary).toEqual({ kind: 'local' })
    expect(config.backups).toEqual([{ kind: 'remote', url: 'https://storage.example.com' }])
    expect(storage.getItem(WALLET_STORAGE_CONFIG_KEY)).toBeTruthy()
  })

  it('persists one verified record and keeps interrupted operations recoverable', () => {
    const storage = new MemoryStorage()
    let config = loadWalletStorageConfig(storage, 'main', 'https://storage.example.com', keyFactory)
    config = addBackupTarget(config, { kind: 'local' })
    config = persistWalletStorageConfig(storage, 'main', config)
    config = beginWalletStorageOperation(config, 'set-primary', { kind: 'local' }, 'operation-1')
    config = persistWalletStorageConfig(storage, 'main', config)

    const recovered = loadWalletStorageConfig(storage, 'main', 'https://storage.example.com', keyFactory)
    expect(recovered.pendingOperation?.id).toBe('operation-1')
    expect(recovered.primary).toEqual({ kind: 'remote', url: 'https://storage.example.com' })
    expect(isMatchingPendingWalletStorageOperation(recovered, 'set-primary', { kind: 'local' })).toBe(true)
    expect(isMatchingPendingWalletStorageOperation(
      recovered,
      'add-backup',
      { kind: 'local' }
    )).toBe(false)

    const swapped = makePrimaryTarget(clearPendingWalletStorageOperation(recovered), { kind: 'local' })
    expect(swapped.primary).toEqual({ kind: 'local' })
    expect(swapped.backups.map(walletStorageTargetId)).toEqual(['remote:https://storage.example.com'])
  })
})
