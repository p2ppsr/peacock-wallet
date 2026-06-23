import { describe, expect, it } from 'vitest'
import {
  buildPreLoginWalletResponse,
  INVALID_ORIGIN,
  ORIGIN_REQUIRED,
  UNKNOWN_WALLET_PATH,
  WALLET_BRC100_VERSION,
  WALLET_NOT_AUTHENTICATED
} from './walletBridgePreLogin'

const baseRequest = {
  request_id: 42,
  headers: {
    Origin: 'http://127.0.0.1:7171'
  }
}

const parsedBody = (response: { body: string }) => JSON.parse(response.body)

describe('buildPreLoginWalletResponse', () => {
  it('returns a BRC-100 version before an authenticated wallet is ready', () => {
    const response = buildPreLoginWalletResponse({
      ...baseRequest,
      path: '/getVersion?cacheBust=1'
    })

    expect(response).toEqual({
      request_id: 42,
      status: 200,
      body: JSON.stringify({ version: WALLET_BRC100_VERSION })
    })
  })

  it('reports unauthenticated state without waiting for login', () => {
    const response = buildPreLoginWalletResponse({
      ...baseRequest,
      path: '/isAuthenticated'
    })

    expect(response.status).toBe(200)
    expect(parsedBody(response)).toEqual({ authenticated: false })
  })

  it('rejects wallet operations clearly before authentication', () => {
    const response = buildPreLoginWalletResponse({
      ...baseRequest,
      path: '/getPublicKey'
    })

    expect(response.status).toBe(503)
    expect(parsedBody(response)).toMatchObject({
      code: WALLET_NOT_AUTHENTICATED,
      retryable: true,
      walletReady: false
    })
  })

  it('requires an origin or originator header', () => {
    const response = buildPreLoginWalletResponse({
      request_id: 42,
      headers: {},
      path: '/getVersion'
    })

    expect(response.status).toBe(400)
    expect(parsedBody(response)).toMatchObject({
      code: ORIGIN_REQUIRED,
      retryable: false
    })
  })

  it('rejects malformed origins', () => {
    const response = buildPreLoginWalletResponse({
      request_id: 42,
      headers: {
        Origin: 'not a url'
      },
      path: '/getVersion'
    })

    expect(response.status).toBe(400)
    expect(parsedBody(response)).toMatchObject({
      code: INVALID_ORIGIN,
      retryable: false
    })
  })

  it('returns a deterministic 404 for unknown wallet paths', () => {
    const response = buildPreLoginWalletResponse({
      ...baseRequest,
      path: '/definitelyNotWallet'
    })

    expect(response.status).toBe(404)
    expect(parsedBody(response)).toMatchObject({
      code: UNKNOWN_WALLET_PATH,
      retryable: false
    })
  })
})
