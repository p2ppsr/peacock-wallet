export const WALLET_BRC100_VERSION = 'wallet-brc100-1.0.0'
export const WALLET_NOT_AUTHENTICATED = 'WALLET_NOT_AUTHENTICATED'
export const ORIGIN_REQUIRED = 'ORIGIN_REQUIRED'
export const INVALID_ORIGIN = 'INVALID_ORIGIN'
export const INVALID_REQUEST = 'INVALID_REQUEST'
export const UNKNOWN_WALLET_PATH = 'UNKNOWN_WALLET_PATH'

type NormalizedHeaders = Record<string, string>

export type PreLoginWalletRequest = {
  path?: unknown
  headers?: unknown
  request_id?: unknown
}

export type PreLoginWalletResponse = {
  request_id: number
  status: number
  body: string
}

const WALLET_PATHS = new Set([
  '/createAction',
  '/signAction',
  '/abortAction',
  '/listActions',
  '/internalizeAction',
  '/listOutputs',
  '/relinquishOutput',
  '/getPublicKey',
  '/revealCounterpartyKeyLinkage',
  '/revealSpecificKeyLinkage',
  '/encrypt',
  '/decrypt',
  '/createHmac',
  '/verifyHmac',
  '/createSignature',
  '/verifySignature',
  '/acquireCertificate',
  '/listCertificates',
  '/proveCertificate',
  '/relinquishCertificate',
  '/discoverByIdentityKey',
  '/discoverByAttributes',
  '/isAuthenticated',
  '/waitForAuthentication',
  '/getHeight',
  '/getHeaderForHeight',
  '/getNetwork',
  '/getVersion'
])

export function normalizeBridgePath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Invalid wallet path')
  }
  return path.split('?')[0] || '/'
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

export function parseBridgeOrigin(headers: NormalizedHeaders): string {
  const rawOrigin = headers.origin
  if (rawOrigin) {
    return new URL(rawOrigin).host.toLowerCase()
  }

  const rawOriginator = headers.originator
  if (rawOriginator) {
    const candidate = rawOriginator.includes('://') ? rawOriginator : `http://${rawOriginator}`
    return new URL(candidate).host.toLowerCase()
  }

  throw new Error(ORIGIN_REQUIRED)
}

function parseRequestId(value: unknown): number {
  const requestId = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(requestId)) {
    throw new Error('Invalid request_id')
  }
  return requestId
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value)
}

function errorBody(code: string, message: string, retryable: boolean) {
  return {
    code,
    message,
    retryable,
    walletReady: false
  }
}

export function buildPreLoginWalletResponse(req: PreLoginWalletRequest): PreLoginWalletResponse {
  const requestId = parseRequestId(req.request_id)

  let path: string
  try {
    path = normalizeBridgePath(req.path)
  } catch {
    return {
      request_id: requestId,
      status: 400,
      body: jsonBody(errorBody(INVALID_REQUEST, 'Invalid wallet path', false))
    }
  }

  try {
    parseBridgeOrigin(normalizeBridgeHeaders(req.headers))
  } catch (error) {
    const code = error instanceof Error && error.message === ORIGIN_REQUIRED
      ? ORIGIN_REQUIRED
      : INVALID_ORIGIN
    return {
      request_id: requestId,
      status: 400,
      body: jsonBody(errorBody(code, code === ORIGIN_REQUIRED ? 'Origin header is required' : 'Invalid Origin header', false))
    }
  }

  if (path === '/getVersion') {
    return {
      request_id: requestId,
      status: 200,
      body: jsonBody({ version: WALLET_BRC100_VERSION })
    }
  }

  if (path === '/isAuthenticated') {
    return {
      request_id: requestId,
      status: 200,
      body: jsonBody({ authenticated: false })
    }
  }

  if (WALLET_PATHS.has(path)) {
    return {
      request_id: requestId,
      status: 503,
      body: jsonBody(errorBody(
        WALLET_NOT_AUTHENTICATED,
        'UserWallet is running, but no wallet session is authenticated yet.',
        true
      ))
    }
  }

  return {
    request_id: requestId,
    status: 404,
    body: jsonBody(errorBody(UNKNOWN_WALLET_PATH, `Unknown wallet path: ${path}`, false))
  }
}
