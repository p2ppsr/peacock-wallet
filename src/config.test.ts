import { describe, expect, it } from 'vitest'
import { resolveWalletEnvironment } from './config'

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
      arcadeUrl: 'https://arcade-v2-ttn-us-1.bsvblockchain.tech'
    })
  })

  it('rejects unknown profiles instead of silently using mainnet', () => {
    expect(() => resolveWalletEnvironment('staging')).toThrow(/Unsupported VITE_WALLET_ENVIRONMENT/)
    expect(() => resolveWalletEnvironment('constructor')).toThrow(/Unsupported VITE_WALLET_ENVIRONMENT/)
  })
})
