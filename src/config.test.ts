import { describe, expect, it } from 'vitest'
import {
  WALLET_ENVIRONMENT_STORAGE_KEY,
  getWalletEnvironmentStorageItem,
  persistWalletEnvironment,
  resolveActiveWalletEnvironment,
  resolveWalletEnvironment,
  setWalletEnvironmentStorageItem,
  walletEnvironmentStorageKey,
} from './config'

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    values,
  }
}

describe('resolveWalletEnvironment', () => {
  it('preserves mainnet as the default', () => {
    expect(resolveWalletEnvironment()).toMatchObject({
      chain: 'main',
      networkPreset: 'mainnet',
      storageUrl: 'https://storage.babbage.systems',
      messageBoxHost: 'https://messagebox.babbage.systems'
    })
  })

  it.each(['ttn', 'teratestnet', 'terratestnet'])('maps %s to the isolated TTN profile', value => {
    expect(resolveWalletEnvironment(value)).toEqual({
      name: 'teratestnet',
      chain: 'ttn',
      networkPreset: 'teratestnet',
      storageUrl: 'https://staging-storage.babbage.systems',
      messageBoxHost: 'https://staging-messagebox.babbage.systems',
      chaintracksUrl: 'https://staging-chaintracks.babbage.systems',
      arcadeUrl: 'https://arcade-v2-ttn-us-1.bsvblockchain.tech'
    })
  })

  it('rejects unknown profiles instead of silently using mainnet', () => {
    expect(() => resolveWalletEnvironment('staging')).toThrow(/Unsupported wallet environment/)
    expect(() => resolveWalletEnvironment('constructor')).toThrow(/Unsupported wallet environment/)
    expect(() => resolveWalletEnvironment('testnet')).toThrow(/Unsupported wallet environment/)
  })

  it('lets the persisted user choice override the build default', () => {
    const storage = memoryStorage()
    persistWalletEnvironment('teratestnet', storage)

    expect(storage.getItem(WALLET_ENVIRONMENT_STORAGE_KEY)).toBe('teratestnet')
    expect(resolveActiveWalletEnvironment('mainnet', storage).name).toBe('teratestnet')
  })

  it('removes an invalid persisted choice and uses the build default', () => {
    const storage = memoryStorage()
    storage.setItem(WALLET_ENVIRONMENT_STORAGE_KEY, 'testnet')

    expect(resolveActiveWalletEnvironment('ttn', storage).name).toBe('teratestnet')
    expect(storage.getItem(WALLET_ENVIRONMENT_STORAGE_KEY)).toBeNull()
  })

  it('isolates TTN unlock state while lazily migrating legacy mainnet state', () => {
    const storage = memoryStorage()
    storage.setItem('snap', 'mainnet-snapshot')

    expect(getWalletEnvironmentStorageItem('snap', storage, 'mainnet')).toBe('mainnet-snapshot')
    expect(storage.getItem(walletEnvironmentStorageKey('snap', 'mainnet'))).toBe('mainnet-snapshot')
    expect(getWalletEnvironmentStorageItem('snap', storage, 'teratestnet')).toBeNull()

    setWalletEnvironmentStorageItem('snap', 'ttn-snapshot', storage, 'teratestnet')
    expect(getWalletEnvironmentStorageItem('snap', storage, 'teratestnet')).toBe('ttn-snapshot')
    expect(storage.getItem('snap')).toBe('mainnet-snapshot')
  })
})
