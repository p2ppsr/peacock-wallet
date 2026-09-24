import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletInterface } from '@bsv/sdk'
import { WalletBackupStorageClient, WalletStorageProviderError, walletStorageFailureDetails, walletStorageTransferMessage } from './walletStorageRpc'
import { getBoundedWalletStorageDownloadChunk, WALLET_STORAGE_SYNC_DOWNLOAD_MIN_ROUGH_SIZE } from './walletStorageRuntime'

class TestClient extends WalletBackupStorageClient {
  request (method: string) { return this.rpcCall(method, []) }
  transport () { return vi.spyOn(this.authClient, 'fetch') }
}
const timeout = () => new Error('Timed out waiting for authenticated response.')
const client = () => new TestClient({} as WalletInterface, 'https://backup.example.com')
// AuthFetch adds this header only after authenticating the peer. Mock that
// verified transport boundary; production must continue rejecting bare HTTP.
const authenticatedHeaders = { 'x-bsv-auth-identity-key': '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('backup activity diagnostics', () => {
  it.each([
    ['getSyncChunk', 'single wallet sync record within its response-size limit', 'sourceUpgradeRequired'],
    ['commitSyncTransfer', 'current proof could not be verified', 'proofReconciliationRequired']
  ])('preserves %s recovery guidance without the RPC cause', (method, message, flag) => {
    const error = new WalletStorageProviderError({ kind: 'remote', url: 'https://backup.example.com' }, method, new Error(message))
    const details = walletStorageFailureDetails(error)
    expect(details).toMatchObject({ method, [flag]: true })
    expect(details).not.toHaveProperty('cause')
    expect(details).not.toHaveProperty('stack')
  })

  it.each([['read', 'Downloading from'], ['write', 'Uploading to']] as const)(
    'identifies the provider and %s direction for an individual large record', (direction, verb) => {
      const message = walletStorageTransferMessage({ kind: 'remote', url: 'https://backup.example.com' }, {
        direction, bytes: 1024 * 1024, totalBytes: 2 * 1024 * 1024
      })
      expect(message).toBe(`${verb} backup.example.com: 1.0 of 2.0 MiB for this record. The counter restarts for each record.`)
    }
  )
})

describe('backup RPC recovery at the authenticated transport boundary', () => {
  it.each(['makeAvailable', 'getSyncCheckpoint'])('bounds %s metadata retries with backoff and names the failed provider', async method => {
    vi.useFakeTimers()
    const provider = client()
    const fetch = provider.transport().mockRejectedValue(timeout())
    const retry = vi.fn(); provider.onRetry = retry
    const result = provider.request(method).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    const error = await result
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(retry).toHaveBeenCalledTimes(2)
    expect(error).toBeInstanceOf(WalletStorageProviderError)
    expect(error).toMatchObject({ target: { kind: 'remote', url: 'https://backup.example.com' }, method, timedOut: true })
  })

  it.each(['processSyncChunk', 'commitSyncTransfer', 'setActive', 'findOrInsertUser', 'findOrInsertSyncStateAuth'])(
    'never automatically replays %s after an uncertain write outcome', async method => {
      const provider = client()
      const fetch = provider.transport().mockRejectedValue(timeout())
      await expect(provider.request(method)).rejects.toMatchObject({ method, timedOut: true })
      expect(fetch).toHaveBeenCalledTimes(1)
    })

  it('stops a scheduled retry when the user requests cancellation', async () => {
    vi.useFakeTimers()
    const provider = client()
    const fetch = provider.transport().mockRejectedValue(timeout())
    let cancelled = false
    provider.checkCancelled = () => { if (cancelled) throw new Error('Cancelled safely') }
    const result = provider.request('makeAvailable').catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    cancelled = true
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ message: 'Cancelled safely' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('preserves ordinary wallet errors and does not cancel unrelated profile or payment requests', async () => {
    const provider = client()
    const original = new Error('ordinary wallet error')
    const fetch = provider.transport().mockRejectedValue(original)
    provider.checkCancelled = () => { throw new Error('Cancelled safely') }
    await expect(provider.request('createAction')).rejects.toBe(original)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not disguise authentication or compatibility failures as retryable timeouts', async () => {
    const provider = client()
    const fetch = provider.transport().mockResolvedValue(new Response('', { status: 401 }))
    await expect(provider.request('makeAvailable')).rejects.toMatchObject({ timedOut: false })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retains timeout diagnostics at the smallest page instead of claiming oversized data', async () => {
    const read = vi.fn().mockRejectedValue(timeout())
    await expect(getBoundedWalletStorageDownloadChunk({
      maxRoughSize: WALLET_STORAGE_SYNC_DOWNLOAD_MIN_ROUGH_SIZE, maxItems: 1
    }, read)).rejects.toThrow('Timed out waiting for authenticated response.')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('bounds timed-out page retries without advancing the durable read offset', async () => {
    vi.useFakeTimers()
    const args = { maxRoughSize: 2_000_000, maxItems: 250, offsets: [{ name: 'output', offset: 41 }] }
    const seen: number[] = []
    const read = vi.fn(async () => { seen.push(args.offsets[0].offset); throw timeout() })
    const result = getBoundedWalletStorageDownloadChunk(args, read).catch(error => error)
    await vi.runAllTimersAsync()
    expect((await result).message).toContain('Timed out')
    expect(read).toHaveBeenCalledTimes(3)
    expect(seen).toEqual([41, 41, 41])
  })
})


it.each(['beginReadSyncTransfer', 'readSyncTransferPart', 'beginWriteSyncTransfer', 'writeSyncTransferPart', 'commitSyncTransfer'])(
  'cancels %s before another transfer request reaches the provider', async method => {
    const provider = client()
    const fetch = provider.transport()
    provider.checkCancelled = () => { throw new Error('Cancelled safely') }
    await expect(provider.request(method)).rejects.toThrow('Cancelled safely')
    expect(fetch).not.toHaveBeenCalled()
  })

it('permits staging cleanup after cancellation without changing wallet records', async () => {
  const provider = client()
  const fetch = provider.transport().mockResolvedValue(new Response(JSON.stringify({ jsonrpc: '2.0', result: true, id: 1 }), { headers: authenticatedHeaders }))
  provider.checkCancelled = () => { throw new Error('Cancelled safely') }
  await expect(provider.request('releaseSyncTransfer')).resolves.toBe(true)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('gives a legacy upload limit actionable recovery guidance without retrying the write', async () => {
  const provider = client()
  const fetch = provider.transport().mockResolvedValue(new Response('', { status: 413, headers: authenticatedHeaders }))
  await expect(provider.request('processSyncChunk')).rejects.toThrow(/Update Peacock and the provider.*resume setup/)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('attributes an irreducibly oversized device-backup read to its remote source', async () => {
  const provider = client()
  const fetch = provider.transport().mockResolvedValue(new Response('', { status: 413, headers: authenticatedHeaders }))
  await expect(provider.getBoundedSyncChunk({
    identityKey: 'synthetic-wallet', fromStorageIdentityKey: 'source', toStorageIdentityKey: 'device',
    offsets: [], maxRoughSize: WALLET_STORAGE_SYNC_DOWNLOAD_MIN_ROUGH_SIZE, maxItems: 1
  })).rejects.toMatchObject({
    target: { kind: 'remote', url: provider.endpointUrl }, method: 'getSyncChunk', timedOut: false, sourceUpgradeRequired: true,
    message: expect.stringMatching(/getSyncChunk.*single wallet sync record.*enable large-record transfers/)
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})


it.each(['processSyncChunk', 'commitSyncTransfer'])('identifies unresolved proof verification from %s without blaming connectivity', method => {
  const error = new WalletStorageProviderError({ kind: 'remote', url: 'https://backup.example.com' }, method,
    new Error('a current proof could not be verified. Ask the source provider to reconcile this transaction'))
  expect(error.proofReconciliationRequired).toBe(true)
  expect(error.timedOut).toBe(false)
  expect(error.sourceUpgradeRequired).toBe(false)
})


it.each([200, 413])('rejects an unauthenticated HTTP %s without trusting its payload or retry guidance', async status => {
  const provider = client()
  const fetch = provider.transport().mockResolvedValue(new Response('{}', { status }))
  await expect(provider.request('getSyncChunk')).rejects.toMatchObject({
    method: 'getSyncChunk', sourceUpgradeRequired: false, timedOut: false,
    message: expect.stringContaining('not mutually authenticated')
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})
