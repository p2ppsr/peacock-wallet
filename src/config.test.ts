import { describe, expect, it } from 'vitest'
import {
  WALLET_ENVIRONMENT_STORAGE_KEY,
  getWalletEnvironmentStorageItem,
  persistWalletEnvironment,
  prepareWalletEnvironmentSwitch,
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
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
    clear: () => { values.clear() },
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

  it('purges network-derived caches while preserving both wallets and user preferences', () => {
    const storage = memoryStorage()
    const session = memoryStorage()

    storage.setItem(walletEnvironmentStorageKey('snap', 'mainnet'), 'mainnet-snapshot')
    storage.setItem(walletEnvironmentStorageKey('snap', 'teratestnet'), 'ttn-snapshot')
    storage.setItem('snap', 'legacy-mainnet-snapshot')
    storage.setItem('primaryKeyHex', 'legacy-mainnet-key')
    storage.setItem('mnemonic12', 'legacy-mainnet-mnemonic')
    storage.setItem('userTheme', 'dark')
    storage.setItem('user-wallet:diagnostics-enabled:v1', 'false')
    storage.setItem('user-wallet:diagnostics-anonymous-id:v1', 'install-id')
    storage.setItem('uw_first_login_done_v1:profile', '1')
    storage.setItem('uw_region_currency_prompted_v1:profile', '1')

    storage.setItem('transactions_example.com', 'ttn-actions')
    storage.setItem('provenCertificates_profile', 'ttn-certificates')
    storage.setItem('identity_02abc', 'ttn-identity')
    storage.setItem('basket_access_cache_example.com', 'ttn-baskets')
    storage.setItem('app_catalog_cache_v1', 'ttn-apps')
    storage.setItem('bgo_satoshi_shop_purchase_history_v1', 'ttn-purchases')
    storage.setItem('user-wallet:diagnostics-queue:v1', 'ttn-diagnostics')
    session.setItem('appinfo', 'ttn-app-request')
    session.setItem('lastAppDomain', 'example.com')

    prepareWalletEnvironmentSwitch('mainnet', storage, session)

    expect(storage.getItem(WALLET_ENVIRONMENT_STORAGE_KEY)).toBe('mainnet')
    expect(storage.getItem(walletEnvironmentStorageKey('snap', 'mainnet'))).toBe('mainnet-snapshot')
    expect(storage.getItem(walletEnvironmentStorageKey('snap', 'teratestnet'))).toBe('ttn-snapshot')
    expect(storage.getItem('snap')).toBe('legacy-mainnet-snapshot')
    expect(storage.getItem('primaryKeyHex')).toBe('legacy-mainnet-key')
    expect(storage.getItem('mnemonic12')).toBe('legacy-mainnet-mnemonic')
    expect(storage.getItem('userTheme')).toBe('dark')
    expect(storage.getItem('user-wallet:diagnostics-enabled:v1')).toBe('false')
    expect(storage.getItem('user-wallet:diagnostics-anonymous-id:v1')).toBe('install-id')
    expect(storage.getItem('uw_first_login_done_v1:profile')).toBeNull()
    expect(storage.getItem('uw_region_currency_prompted_v1:profile')).toBeNull()

    expect(storage.getItem('transactions_example.com')).toBeNull()
    expect(storage.getItem('provenCertificates_profile')).toBeNull()
    expect(storage.getItem('identity_02abc')).toBeNull()
    expect(storage.getItem('basket_access_cache_example.com')).toBeNull()
    expect(storage.getItem('app_catalog_cache_v1')).toBeNull()
    expect(storage.getItem('bgo_satoshi_shop_purchase_history_v1')).toBeNull()
    expect(storage.getItem('user-wallet:diagnostics-queue:v1')).toBeNull()
    expect(session.length).toBe(0)
  })
})
