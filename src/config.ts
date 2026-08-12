import type { LookupNetworkPreset } from '@bsv/sdk'

export type WalletChain = 'main' | 'ttn'
export type WalletEnvironmentName = 'mainnet' | 'teratestnet'

export interface WalletEnvironment {
  name: WalletEnvironmentName
  chain: WalletChain
  networkPreset: LookupNetworkPreset
  storageUrl: string
  messageBoxHost: string
  chaintracksUrl?: string
  arcadeUrl?: string
}

export const WALLET_ENVIRONMENT_STORAGE_KEY = 'peacock:wallet-environment:v1'

const MAINNET_ENVIRONMENT: WalletEnvironment = Object.freeze({
  name: 'mainnet',
  chain: 'main',
  networkPreset: 'mainnet',
  storageUrl: 'https://storage.babbage.systems',
  messageBoxHost: 'https://messagebox.babbage.systems'
})

const TERATESTNET_ENVIRONMENT: WalletEnvironment = Object.freeze({
  name: 'teratestnet',
  chain: 'ttn',
  networkPreset: 'teratestnet',
  storageUrl: 'https://staging-storage.babbage.systems',
  messageBoxHost: 'https://staging-messagebox.babbage.systems',
  chaintracksUrl: 'https://staging-chaintracks.babbage.systems',
  arcadeUrl: 'https://arcade-v2-ttn-us-1.bsvblockchain.tech'
})

const ENVIRONMENTS: Record<WalletEnvironmentName, WalletEnvironment> = {
  mainnet: MAINNET_ENVIRONMENT,
  teratestnet: TERATESTNET_ENVIRONMENT
}

type WalletEnvironmentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): WalletEnvironmentStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/**
 * Resolve a wallet environment name. Mainnet remains the safe default; aliases
 * are accepted for operator convenience, but unknown values fail fast.
 */
export function resolveWalletEnvironment(value?: string): WalletEnvironment {
  const normalized = value?.trim().toLowerCase()
  if (normalized == null || normalized === '' || normalized === 'main') {
    return MAINNET_ENVIRONMENT
  }
  if (normalized === 'ttn' || normalized === 'terratestnet') {
    return TERATESTNET_ENVIRONMENT
  }
  if (Object.prototype.hasOwnProperty.call(ENVIRONMENTS, normalized)) {
    return ENVIRONMENTS[normalized as WalletEnvironmentName]
  }
  throw new Error(
    `Unsupported wallet environment "${value}". Use mainnet or teratestnet.`
  )
}

/** Resolve the persisted user choice, falling back to the build-time default. */
export function resolveActiveWalletEnvironment(
  buildDefault?: string,
  storage: WalletEnvironmentStorage | undefined = browserStorage()
): WalletEnvironment {
  const persisted = storage?.getItem(WALLET_ENVIRONMENT_STORAGE_KEY)
  if (persisted) {
    try {
      return resolveWalletEnvironment(persisted)
    } catch {
      storage?.removeItem(WALLET_ENVIRONMENT_STORAGE_KEY)
    }
  }
  return resolveWalletEnvironment(buildDefault)
}

export function persistWalletEnvironment(
  name: WalletEnvironmentName,
  storage: WalletEnvironmentStorage | undefined = browserStorage()
): WalletEnvironment {
  const environment = resolveWalletEnvironment(name)
  if (!storage) throw new Error('Wallet environment storage is unavailable.')
  storage.setItem(WALLET_ENVIRONMENT_STORAGE_KEY, environment.name)
  return environment
}

export const ACTIVE_WALLET_ENVIRONMENT = resolveActiveWalletEnvironment(
  import.meta.env.VITE_WALLET_ENVIRONMENT
)

export function walletEnvironmentStoragePrefix(
  environmentName: WalletEnvironmentName = ACTIVE_WALLET_ENVIRONMENT.name
): string {
  return `peacock:${environmentName}:wallet:v1:`
}

export function walletEnvironmentStorageKey(
  key: string,
  environmentName: WalletEnvironmentName = ACTIVE_WALLET_ENVIRONMENT.name
): string {
  return `${walletEnvironmentStoragePrefix(environmentName)}${key}`
}

/**
 * Wallet unlock material is isolated by network. Existing mainnet installs are
 * migrated lazily from the legacy unscoped keys; TTN never reads those keys.
 */
export function getWalletEnvironmentStorageItem(
  key: string,
  storage: WalletEnvironmentStorage | undefined = browserStorage(),
  environmentName: WalletEnvironmentName = ACTIVE_WALLET_ENVIRONMENT.name
): string | null {
  if (!storage) return null
  const scopedKey = walletEnvironmentStorageKey(key, environmentName)
  const scopedValue = storage.getItem(scopedKey)
  if (scopedValue != null) return scopedValue

  if (environmentName === 'mainnet') {
    const legacyValue = storage.getItem(key)
    if (legacyValue != null) storage.setItem(scopedKey, legacyValue)
    return legacyValue
  }
  return null
}

export function setWalletEnvironmentStorageItem(
  key: string,
  value: string,
  storage: WalletEnvironmentStorage | undefined = browserStorage(),
  environmentName: WalletEnvironmentName = ACTIVE_WALLET_ENVIRONMENT.name
): void {
  if (!storage) throw new Error('Wallet environment storage is unavailable.')
  storage.setItem(walletEnvironmentStorageKey(key, environmentName), value)
  // Keep current mainnet installations backward-compatible with a rollback.
  if (environmentName === 'mainnet') storage.setItem(key, value)
}

export function removeWalletEnvironmentStorageItem(
  key: string,
  storage: WalletEnvironmentStorage | undefined = browserStorage(),
  environmentName: WalletEnvironmentName = ACTIVE_WALLET_ENVIRONMENT.name
): void {
  if (!storage) return
  storage.removeItem(walletEnvironmentStorageKey(key, environmentName))
  if (environmentName === 'mainnet') storage.removeItem(key)
}

// Compatibility exports for callers that do not need the complete profile.
export const DEFAULT_STORAGE_URL = ACTIVE_WALLET_ENVIRONMENT.storageUrl
export const DEFAULT_CHAIN = ACTIVE_WALLET_ENVIRONMENT.chain
export const MESSAGEBOX_HOST = ACTIVE_WALLET_ENVIRONMENT.messageBoxHost
export { INTERNAL_ADMIN_ORIGINATOR as ADMIN_ORIGINATOR } from './walletBridgeOrigin'
