export const WALLET_BRC100_VERSION = 'wallet-brc100-1.0.0'
export const WALLET_NOT_AUTHENTICATED = 'WALLET_NOT_AUTHENTICATED'
export { INVALID_ORIGIN, ORIGIN_REQUIRED, RESERVED_ORIGIN } from './walletBridgeOrigin'
export const INVALID_REQUEST = 'INVALID_REQUEST'
export const UNKNOWN_WALLET_PATH = 'UNKNOWN_WALLET_PATH'
export {
  normalizeBridgeHeaders,
  parseBridgeOrigin
} from './walletBridgeOrigin'
import {
  RESERVED_ORIGIN,
  WalletBridgeOriginError,
  normalizeBridgeHeaders,
  parseBridgeOrigin
} from './walletBridgeOrigin'

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
    const code = error instanceof WalletBridgeOriginError
      ? error.code
      : 'INVALID_ORIGIN'
    return {
      request_id: requestId,
      status: code === RESERVED_ORIGIN ? 403 : 400,
      body: jsonBody(errorBody(
        code,
        error instanceof Error ? error.message : 'Invalid Origin header',
        false
      ))
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
        'Peacock is running, but no wallet session is authenticated yet.',
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
