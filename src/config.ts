import type { LookupNetworkPreset } from '@bsv/sdk'

export type WalletChain = 'main' | 'test' | 'ttn'
export type WalletEnvironmentName = 'mainnet' | 'testnet' | 'teratestnet'

export interface WalletEnvironment {
  name: WalletEnvironmentName
  chain: WalletChain
  networkPreset: LookupNetworkPreset
  storageUrl: string
  messageBoxHost: string
  arcadeUrl?: string
}

const MAINNET_ENVIRONMENT: WalletEnvironment = Object.freeze({
  name: 'mainnet',
  chain: 'main',
  networkPreset: 'mainnet',
  storageUrl: 'https://storage.babbage.systems',
  messageBoxHost: 'https://messagebox.babbage.systems'
})

const TESTNET_ENVIRONMENT: WalletEnvironment = Object.freeze({
  name: 'testnet',
  chain: 'test',
  networkPreset: 'testnet',
  storageUrl: 'https://staging-storage.babbage.systems',
  messageBoxHost: 'https://staging-messagebox.babbage.systems'
})

const TERATESTNET_ENVIRONMENT: WalletEnvironment = Object.freeze({
  name: 'teratestnet',
  chain: 'ttn',
  networkPreset: 'teratestnet',
  storageUrl: 'https://staging-storage.babbage.systems',
  messageBoxHost: 'https://staging-messagebox.babbage.systems',
  arcadeUrl: 'https://arcade-v2-ttn-us-1.bsvblockchain.tech'
})

const ENVIRONMENTS: Record<WalletEnvironmentName, WalletEnvironment> = {
  mainnet: MAINNET_ENVIRONMENT,
  testnet: TESTNET_ENVIRONMENT,
  teratestnet: TERATESTNET_ENVIRONMENT
}

/**
 * Resolve the build-time wallet environment. Mainnet remains the safe default;
 * aliases are accepted for operator convenience, but unknown values fail fast.
 */
export function resolveWalletEnvironment(value?: string): WalletEnvironment {
  const normalized = value?.trim().toLowerCase()
  if (normalized == null || normalized === '' || normalized === 'main') {
    return MAINNET_ENVIRONMENT
  }
  if (normalized === 'test') return TESTNET_ENVIRONMENT
  if (normalized === 'ttn' || normalized === 'terratestnet') {
    return TERATESTNET_ENVIRONMENT
  }
  if (Object.prototype.hasOwnProperty.call(ENVIRONMENTS, normalized)) {
    return ENVIRONMENTS[normalized as WalletEnvironmentName]
  }
  throw new Error(
    `Unsupported VITE_WALLET_ENVIRONMENT "${value}". Use mainnet, testnet, or teratestnet.`
  )
}

export const ACTIVE_WALLET_ENVIRONMENT = resolveWalletEnvironment(
  import.meta.env.VITE_WALLET_ENVIRONMENT
)

// Compatibility exports for callers that do not need the complete profile.
export const DEFAULT_STORAGE_URL = ACTIVE_WALLET_ENVIRONMENT.storageUrl
export const DEFAULT_CHAIN = ACTIVE_WALLET_ENVIRONMENT.chain
export const MESSAGEBOX_HOST = ACTIVE_WALLET_ENVIRONMENT.messageBoxHost
export { INTERNAL_ADMIN_ORIGINATOR as ADMIN_ORIGINATOR } from './walletBridgeOrigin'
