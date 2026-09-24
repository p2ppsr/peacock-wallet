import { expect, it } from 'vitest'
import { loadProfileWalletStorageConfig, walletProfileStorage } from './walletStorageProfiles'
import { beginWalletStorageOperation, loadWalletStorageConfig, persistWalletStorageConfig } from './walletStorageConfig'

const identityA = '02' + 'a'.repeat(64)
const identityB = '03' + 'b'.repeat(64)
const url = 'https://primary.example.com'
const key = () => '1'.repeat(64)

it('migrates existing locations once and keeps profile journals and completion times isolated across switches', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) } }
  const old = loadWalletStorageConfig(storage, 'main', url, key)
  persistWalletStorageConfig(storage, 'main', { ...old, backups: [{ kind: 'local' }], lastSuccessfulSyncAt: { local: new Date().toISOString() } })
  const a = loadProfileWalletStorageConfig(storage, 'main', identityA, url, key)
  expect(a.backups).toEqual([{ kind: 'local' }])
  expect(a.lastSuccessfulSyncAt).toEqual({})
  const pending = beginWalletStorageOperation(a, 'add-backup', { kind: 'remote', url: 'https://backup.example.com' }, 'pending-a')
  persistWalletStorageConfig(walletProfileStorage(storage, identityA), 'main', pending)
  const b = loadProfileWalletStorageConfig(storage, 'main', identityB, url, key)
  expect(b.backups).toEqual([])
  expect(b.pendingOperation).toBeUndefined()
  persistWalletStorageConfig(walletProfileStorage(storage, identityB), 'main', { ...b, lastSuccessfulSyncAt: { local: 'profile-b' } })
  const restored = loadProfileWalletStorageConfig(storage, 'main', identityA, url, key)
  expect(restored.pendingOperation?.id).toBe('pending-a')
  expect(restored.lastSuccessfulSyncAt).toEqual({})
  expect(loadProfileWalletStorageConfig(storage, 'test', identityA, url, key).backups).toEqual([])
})
