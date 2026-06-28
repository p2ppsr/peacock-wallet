export const INTERNAL_ADMIN_ORIGINATOR = 'metanet-client.wallet.internal'
export const LEGACY_ADMIN_ORIGINATOR = 'admin.com'
export const ORIGIN_REQUIRED = 'ORIGIN_REQUIRED'
export const INVALID_ORIGIN = 'INVALID_ORIGIN'
export const RESERVED_ORIGIN = 'RESERVED_ORIGIN'

export type NormalizedHeaders = Record<string, string>

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443'
}

const RESERVED_ORIGINATORS = new Set([
  INTERNAL_ADMIN_ORIGINATOR,
  LEGACY_ADMIN_ORIGINATOR
])

export class WalletBridgeOriginError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'WalletBridgeOriginError'
  }
}

export function normalizeBridgeHeaders(headers: unknown): NormalizedHeaders {
  const normalized: NormalizedHeaders = {}

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (Array.isArray(entry) && entry.length >= 2) {
        normalized[String(entry[0]).toLowerCase()] = String(entry[1])
      }
    }
    return normalized
  }

  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      normalized[key.toLowerCase()] = String(value)
    }
  }

  return normalized
}

export function isReservedOriginator(originator: string): boolean {
  return RESERVED_ORIGINATORS.has(originator.trim().toLowerCase())
}

function canonicalizeHost(url: URL): string {
  const hostname = url.hostname?.trim()
  if (!hostname) {
    throw new WalletBridgeOriginError(INVALID_ORIGIN, 'Invalid origin host')
  }

  const normalizedHost = hostname.toLowerCase()
  const needsBrackets = normalizedHost.includes(':')
  const baseHost = needsBrackets ? `[${normalizedHost}]` : normalizedHost
  const port = url.port?.trim()
  const defaultPort = DEFAULT_PORTS[url.protocol]

  if (port && (!defaultPort || port !== defaultPort)) {
    return `${baseHost}:${port}`
  }

  return baseHost
}

function normalizeOriginValue(raw: string, errorMessage: string): string {
  try {
    const originator = canonicalizeHost(new URL(raw))
    assertExternalOriginator(originator)
    return originator
  } catch (error) {
    if (error instanceof WalletBridgeOriginError) throw error
    throw new WalletBridgeOriginError(INVALID_ORIGIN, errorMessage)
  }
}

export function assertExternalOriginator(originator: string): void {
  if (!originator.trim()) {
    throw new WalletBridgeOriginError(ORIGIN_REQUIRED, 'Origin header is required')
  }

  if (originator.length > 250) {
    throw new WalletBridgeOriginError(INVALID_ORIGIN, 'Origin is too long')
  }

  if (isReservedOriginator(originator)) {
    throw new WalletBridgeOriginError(RESERVED_ORIGIN, 'Reserved wallet originator cannot be used by external applications')
  }
}

export function normalizeBridgeOriginatorValue(raw: string, errorMessage = 'Invalid Originator header'): string {
  const candidate = raw.includes('://') ? raw : `http://${raw}`
  return normalizeOriginValue(candidate, errorMessage)
}

export function parseBridgeOrigin(headers: NormalizedHeaders): string {
  const rawOrigin = headers.origin
  if (rawOrigin) {
    return normalizeOriginValue(rawOrigin, 'Invalid Origin header')
  }

  const rawOriginator = headers.originator
  if (rawOriginator) {
    return normalizeBridgeOriginatorValue(rawOriginator)
  }

  throw new WalletBridgeOriginError(ORIGIN_REQUIRED, 'Origin header is required')
}

export function manifestUrlForOriginator(originator: string): string {
  const protocol = originator.startsWith('localhost:') ? 'http' : 'https'
  return `${protocol}://${originator}/manifest.json`
}
