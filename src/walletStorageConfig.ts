export const WALLET_STORAGE_CONFIG_KEY = 'peacock.wallet-storage-config.v1'
export const LEGACY_WALLET_STORAGE_CONFIG_KEY = 'backupConfig'

export type WalletStorageNetwork = 'main' | 'test' | 'ttn'

export type WalletStorageTarget =
  | { kind: 'local' }
  | { kind: 'remote'; url: string }

export type WalletStorageOperationKind = 'add-backup' | 'set-primary'

export interface PendingWalletStorageOperation {
  id: string
  kind: WalletStorageOperationKind
  target: WalletStorageTarget
  startedAt: string
}

export interface NetworkWalletStorageConfig {
  revision: number
  backupMode?: 'device' | 'profile'
  automaticBackups?: boolean
  primary: WalletStorageTarget
  backups: WalletStorageTarget[]
  localStorageIdentityKey: string
  lastSuccessfulSyncAt: Record<string, string>
  pendingOperation?: PendingWalletStorageOperation
  updatedAt: string
}

interface WalletStorageConfigEnvelope {
  version: 1
  networks: Partial<Record<WalletStorageNetwork, NetworkWalletStorageConfig>>
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const LOCAL_TARGET: WalletStorageTarget = { kind: 'local' }

function isLoopbackHostname (hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1') return true
  if (!/^127(?:\.\d{1,3}){3}$/.test(normalized)) return false
  return normalized.split('.').every(part => Number(part) <= 255)
}

export function normalizeRemoteStorageUrl (value: string): string {
  const input = value.trim()
  if (!input) throw new Error('Storage URL is required')

  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error('Storage URL must be a valid URL')
  }

  if (parsed.username || parsed.password) {
    throw new Error('Storage URLs cannot contain embedded credentials')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Storage URLs cannot contain a query string or fragment')
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
    throw new Error('Storage URLs must use HTTPS (HTTP is allowed only for loopback development)')
  }

  const pathname = parsed.pathname === '/'
    ? ''
    : parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${pathname}`
}

export function normalizeWalletStorageTarget (target: WalletStorageTarget): WalletStorageTarget {
  if (target.kind === 'local') return LOCAL_TARGET
  return { kind: 'remote', url: normalizeRemoteStorageUrl(target.url) }
}

export function walletStorageTargetId (target: WalletStorageTarget): string {
  return target.kind === 'local' ? 'local' : `remote:${normalizeRemoteStorageUrl(target.url)}`
}

export function walletStorageTargetsEqual (a: WalletStorageTarget, b: WalletStorageTarget): boolean {
  return walletStorageTargetId(a) === walletStorageTargetId(b)
}

function normalizeTargets (
  primary: WalletStorageTarget,
  backups: WalletStorageTarget[]
): { primary: WalletStorageTarget; backups: WalletStorageTarget[] } {
  const normalizedPrimary = normalizeWalletStorageTarget(primary)
  const primaryId = walletStorageTargetId(normalizedPrimary)
  const seen = new Set<string>([primaryId])
  const normalizedBackups: WalletStorageTarget[] = []

  for (const backup of backups) {
    try {
      const normalized = normalizeWalletStorageTarget(backup)
      const id = walletStorageTargetId(normalized)
      if (seen.has(id)) continue
      seen.add(id)
      normalizedBackups.push(normalized)
    } catch {
      // Ignore malformed persisted entries. New user input is validated before save.
    }
  }

  return { primary: normalizedPrimary, backups: normalizedBackups }
}

function nowIso (): string {
  return new Date().toISOString()
}

export function createDefaultWalletStorageConfig (
  fallbackRemoteUrl: string,
  createLocalStorageIdentityKey: () => string
): NetworkWalletStorageConfig {
  return {
    revision: 0,
    backupMode: 'device',
    automaticBackups: true,
    primary: { kind: 'remote', url: normalizeRemoteStorageUrl(fallbackRemoteUrl) },
    backups: [],
    localStorageIdentityKey: createLocalStorageIdentityKey(),
    lastSuccessfulSyncAt: {},
    updatedAt: nowIso()
  }
}

function parseTarget (value: unknown): WalletStorageTarget | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { kind?: unknown; url?: unknown }
  if (candidate.kind === 'local') return LOCAL_TARGET
  if (candidate.kind === 'remote' && typeof candidate.url === 'string') {
    try {
      return { kind: 'remote', url: normalizeRemoteStorageUrl(candidate.url) }
    } catch {
      return undefined
    }
  }
  return undefined
}

function parseNetworkConfig (
  value: unknown,
  fallbackRemoteUrl: string,
  createLocalStorageIdentityKey: () => string
): NetworkWalletStorageConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<NetworkWalletStorageConfig>
  const primary = parseTarget(candidate.primary)
  if (!primary) return undefined

  const backups = Array.isArray(candidate.backups)
    ? candidate.backups.map(parseTarget).filter((target): target is WalletStorageTarget => Boolean(target))
    : []
  const normalized = normalizeTargets(primary, backups)
  const localStorageIdentityKey = typeof candidate.localStorageIdentityKey === 'string' && candidate.localStorageIdentityKey.trim()
    ? candidate.localStorageIdentityKey.trim()
    : createLocalStorageIdentityKey()
  const lastSuccessfulSyncAt = candidate.lastSuccessfulSyncAt && typeof candidate.lastSuccessfulSyncAt === 'object'
    ? Object.fromEntries(
      Object.entries(candidate.lastSuccessfulSyncAt)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
    : {}
  const pendingOperation = candidate.pendingOperation &&
    typeof candidate.pendingOperation.id === 'string' &&
    (candidate.pendingOperation.kind === 'add-backup' || candidate.pendingOperation.kind === 'set-primary') &&
    typeof candidate.pendingOperation.startedAt === 'string'
    ? {
        ...candidate.pendingOperation,
        target: parseTarget(candidate.pendingOperation.target) ?? normalized.primary
      }
    : undefined

  // Validate the fallback too, so a caller cannot accidentally mask bad configuration.
  normalizeRemoteStorageUrl(fallbackRemoteUrl)

  return {
    revision: Number.isSafeInteger(candidate.revision) && Number(candidate.revision) >= 0
      ? Number(candidate.revision)
      : 0,
    backupMode: candidate.backupMode === 'device' ? 'device' : 'profile',
    automaticBackups: candidate.automaticBackups !== false,
    primary: normalized.primary,
    backups: normalized.backups,
    localStorageIdentityKey,
    lastSuccessfulSyncAt,
    pendingOperation,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : nowIso()
  }
}

function parseEnvelope (raw: string | null): WalletStorageConfigEnvelope {
  if (!raw) return { version: 1, networks: {} }
  try {
    const parsed = JSON.parse(raw) as Partial<WalletStorageConfigEnvelope>
    if (parsed.version !== 1 || !parsed.networks || typeof parsed.networks !== 'object') {
      return { version: 1, networks: {} }
    }
    return { version: 1, networks: parsed.networks }
  } catch {
    return { version: 1, networks: {} }
  }
}

function migrateLegacyConfig (
  storage: StorageLike,
  fallbackRemoteUrl: string,
  createLocalStorageIdentityKey: () => string
): NetworkWalletStorageConfig | undefined {
  const raw = storage.getItem(LEGACY_WALLET_STORAGE_CONFIG_KEY)
  if (!raw) return undefined

  try {
    const legacy = JSON.parse(raw) as {
      useRemoteStorage?: unknown
      selectedStorageUrl?: unknown
      backupStorageUrls?: unknown
    }
    const primary: WalletStorageTarget = legacy.useRemoteStorage === false
      ? LOCAL_TARGET
      : {
          kind: 'remote',
          url: typeof legacy.selectedStorageUrl === 'string'
            ? legacy.selectedStorageUrl
            : fallbackRemoteUrl
        }
    const backups = Array.isArray(legacy.backupStorageUrls)
      ? legacy.backupStorageUrls.flatMap(value => {
        if (value === 'LOCAL_STORAGE') return [LOCAL_TARGET]
        return typeof value === 'string' ? [{ kind: 'remote', url: value } as WalletStorageTarget] : []
      })
      : []
    const normalized = normalizeTargets(primary, backups)
    return {
      revision: 0,
      backupMode: 'profile',
      automaticBackups: true,
      primary: normalized.primary,
      backups: normalized.backups,
      localStorageIdentityKey: createLocalStorageIdentityKey(),
      lastSuccessfulSyncAt: {},
      updatedAt: nowIso()
    }
  } catch {
    return undefined
  }
}

export function loadWalletStorageConfig (
  storage: StorageLike,
  network: WalletStorageNetwork,
  fallbackRemoteUrl: string,
  createLocalStorageIdentityKey: () => string
): NetworkWalletStorageConfig {
  const envelope = parseEnvelope(storage.getItem(WALLET_STORAGE_CONFIG_KEY))
  const parsed = parseNetworkConfig(envelope.networks[network], fallbackRemoteUrl, createLocalStorageIdentityKey)
  if (parsed) return parsed

  const migrated = migrateLegacyConfig(storage, fallbackRemoteUrl, createLocalStorageIdentityKey)
  const next = migrated ?? createDefaultWalletStorageConfig(fallbackRemoteUrl, createLocalStorageIdentityKey)
  return persistWalletStorageConfig(storage, network, next)
}

export function persistWalletStorageConfig (
  storage: StorageLike,
  network: WalletStorageNetwork,
  config: NetworkWalletStorageConfig
): NetworkWalletStorageConfig {
  const normalized = normalizeTargets(config.primary, config.backups)
  const next: NetworkWalletStorageConfig = {
    ...config,
    revision: config.revision + 1,
    primary: normalized.primary,
    backups: normalized.backups,
    updatedAt: nowIso()
  }
  const envelope = parseEnvelope(storage.getItem(WALLET_STORAGE_CONFIG_KEY))
  envelope.networks[network] = next
  const serialized = JSON.stringify(envelope)
  storage.setItem(WALLET_STORAGE_CONFIG_KEY, serialized)

  // localStorage can be denied or shimmed by a webview. Treat an unverifiable write
  // as a hard failure so the runtime topology never claims to be durably changed.
  if (storage.getItem(WALLET_STORAGE_CONFIG_KEY) !== serialized) {
    throw new Error('Wallet storage configuration could not be verified after saving')
  }
  return next
}

export function addBackupTarget (
  config: NetworkWalletStorageConfig,
  target: WalletStorageTarget
): NetworkWalletStorageConfig {
  const normalizedTarget = normalizeWalletStorageTarget(target)
  if (walletStorageTargetsEqual(config.primary, normalizedTarget)) {
    throw new Error('This storage provider is already the primary')
  }
  if (config.backups.some(backup => walletStorageTargetsEqual(backup, normalizedTarget))) {
    throw new Error('This backup storage is already configured')
  }
  return { ...config, backups: [...config.backups, normalizedTarget] }
}

export function removeBackupTarget (
  config: NetworkWalletStorageConfig,
  target: WalletStorageTarget
): NetworkWalletStorageConfig {
  return {
    ...config,
    backups: config.backups.filter(backup => !walletStorageTargetsEqual(backup, target))
  }
}

export function makePrimaryTarget (
  config: NetworkWalletStorageConfig,
  target: WalletStorageTarget
): NetworkWalletStorageConfig {
  const normalizedTarget = normalizeWalletStorageTarget(target)
  if (walletStorageTargetsEqual(config.primary, normalizedTarget)) return config
  if (!config.backups.some(backup => walletStorageTargetsEqual(backup, normalizedTarget))) {
    throw new Error('Add this storage provider as a backup before making it primary')
  }
  return {
    ...config,
    primary: normalizedTarget,
    backups: [
      config.primary,
      ...config.backups.filter(backup => !walletStorageTargetsEqual(backup, normalizedTarget))
    ]
  }
}

export function beginWalletStorageOperation (
  config: NetworkWalletStorageConfig,
  kind: WalletStorageOperationKind,
  target: WalletStorageTarget,
  id: string
): NetworkWalletStorageConfig {
  if (config.pendingOperation) {
    throw new Error('A wallet storage recovery operation is already pending')
  }
  return {
    ...config,
    pendingOperation: {
      id,
      kind,
      target: normalizeWalletStorageTarget(target),
      startedAt: nowIso()
    }
  }
}

export function isMatchingPendingWalletStorageOperation (
  config: NetworkWalletStorageConfig,
  kind: WalletStorageOperationKind,
  target: WalletStorageTarget
): boolean {
  return config.pendingOperation?.kind === kind &&
    walletStorageTargetsEqual(config.pendingOperation.target, target)
}

export function clearPendingWalletStorageOperation (
  config: NetworkWalletStorageConfig
): NetworkWalletStorageConfig {
  const { pendingOperation: _pendingOperation, ...rest } = config
  return rest
}

/** Recover the intended backup target without claiming its copy is complete. */
export function recoverPendingWalletStorageOperation (
  config: NetworkWalletStorageConfig
): NetworkWalletStorageConfig {
  const pending = config.pendingOperation
  if (!pending) return config
  const recovered = pending.kind === 'add-backup'
    ? addBackupTarget(config, pending.target)
    : config
  return clearPendingWalletStorageOperation(recovered)
}

export function markWalletStorageSynced (
  config: NetworkWalletStorageConfig,
  targets: WalletStorageTarget[],
  syncedAt = nowIso()
): NetworkWalletStorageConfig {
  const next = { ...config.lastSuccessfulSyncAt }
  for (const target of targets) next[walletStorageTargetId(target)] = syncedAt
  return { ...config, lastSuccessfulSyncAt: next }
}
