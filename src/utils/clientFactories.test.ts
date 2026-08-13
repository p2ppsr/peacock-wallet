import { describe, expect, it } from 'vitest'
import {
  getIdentityClient,
  getLookupResolver,
  getMessageBoxClient,
  getRegistryClient,
} from './clientFactories'

describe('network-aware client factories', () => {
  it('isolates registry clients by overlay network', () => {
    const wallet = {} as never
    const mainnet = getRegistryClient(wallet, { networkPreset: 'mainnet' })
    const ttn = getRegistryClient(wallet, { networkPreset: 'teratestnet' })

    expect(ttn).not.toBe(mainnet)
    expect((ttn as any).networkPreset).toBe('teratestnet')
  })

  it('passes teratestnet to identity and lookup clients', async () => {
    const manager = {} as never
    const identity = getIdentityClient(manager, { networkPreset: 'teratestnet' })
    const lookup = await getLookupResolver({ networkPreset: 'teratestnet' })

    expect((identity as any).options.networkPreset).toBe('teratestnet')
    expect((lookup as any).networkPreset).toBe('teratestnet')
  })

  it('passes teratestnet and the explicit staging host to Message Box', () => {
    const client = getMessageBoxClient({
      walletClient: {} as never,
      host: 'https://staging-messagebox.babbage.systems',
      networkPreset: 'teratestnet'
    })

    expect((client as any).networkPreset).toBe('teratestnet')
    expect((client as any).host).toBe('https://staging-messagebox.babbage.systems')
  })
})
