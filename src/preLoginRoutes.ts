import { listen, emit, UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { buildPreLoginWalletResponse, normalizeBridgeHeaders, normalizeBridgePath } from './walletBridgePreLogin'

async function setBridgeAcceptsRequests(accepts: boolean): Promise<void> {
  try {
    await invoke('set_wallet_bridge_accepts_requests', { accepts })
  } catch (error) {
    console.debug('Failed to update wallet bridge readiness:', error)
  }
}

async function cacheManifestFromHeaders(headers: unknown): Promise<void> {
  const headersObj = normalizeBridgeHeaders(headers)
  const rawOrigin = headersObj.origin
  const rawOriginator = headersObj.originator
  let manifestUrl: string | null = null

  try {
    if (rawOrigin) {
      const u = new URL(rawOrigin)
      manifestUrl = `https://${u.host}/manifest.json`
    } else if (rawOriginator) {
      const candidate = rawOriginator.includes('://') ? rawOriginator : `http://${rawOriginator}`
      const u = new URL(candidate)
      manifestUrl = `https://${u.host}/manifest.json`
    }
  } catch (e) {
    console.warn('Failed to parse origin header for manifest URL:', e)
  }

  if (!manifestUrl) {
    console.warn('No Origin/Originator header; cannot derive manifest URL')
    return
  }

  try {
    const resp = await invoke<{ status: number; headers: Array<[string, string]>; body: string }>(
      'proxy_fetch_manifest',
      { url: manifestUrl }
    )
    if (!resp || resp.status < 200 || resp.status >= 300 || !resp.body) {
      console.warn('proxy_fetch_manifest returned non-2xx or empty body', resp && resp.status)
      return
    }

    try {
      const manifest = JSON.parse(resp.body)
      if (manifest && typeof manifest === 'object') {
        try {
          sessionStorage.setItem('appinfo', JSON.stringify(manifest))
        } catch (e) {
          console.warn('Failed to write to sessionStorage:', e)
        }
      }
    } catch (e) {
      console.warn('Failed to parse manifest.json body:', e)
    }
  } catch (e) {
    console.warn('proxy_fetch_manifest failed:', e)
  }
}

export async function registerPreLoginRoutesOnce(): Promise<UnlistenFn | (() => void)> {
  await setBridgeAcceptsRequests(true)

  const unlisten = await listen('http-request', async (event) => {
    try {
      const payloadText = typeof event.payload === 'string'
        ? event.payload
        : JSON.stringify(event.payload)
      const req = JSON.parse(payloadText)
      const response = buildPreLoginWalletResponse(req)

      await emit('ts-response', {
        request_id: response.request_id,
        status: response.status,
        body: response.body
      })

      try {
        if (normalizeBridgePath(req.path) === '/getVersion') {
          void cacheManifestFromHeaders(req.headers)
        }
      } catch {
        // buildPreLoginWalletResponse already emitted the deterministic error.
      }
    } catch (e) {
      console.error('Error in pre-login wallet bridge handler:', e)
    }
  })

  return () => {
    try {
      unlisten()
    } finally {
      void setBridgeAcceptsRequests(false)
    }
  }
}

export async function registerPreLoginRoutes(): Promise<UnlistenFn | (() => void)> {
  return registerPreLoginRoutesOnce()
}
