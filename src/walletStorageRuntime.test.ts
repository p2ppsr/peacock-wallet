import { describe, expect, it, vi } from 'vitest'
import {
  WALLET_STORAGE_SYNC_MAX_ITEMS,
  WALLET_STORAGE_SYNC_MAX_ENCODED_BYTES,
  WALLET_STORAGE_SYNC_MAX_ROUGH_SIZE,
  WALLET_STORAGE_SYNC_DOWNLOAD_MAX_ROUGH_SIZE,
  applyWalletStorageUploadChunkLimits,
  buildWalletStorageProviderStatuses,
  encodeWalletStorageSyncProgress,
  enforceConfiguredPrimary,
  getBoundedWalletStorageDownloadChunk,
  getBoundedWalletStorageUploadChunk,
  parseWalletStorageSyncProgress,
  summarizeWalletStorageSyncChunk,
  synchronizeConfiguredBackups,
  type WalletStorageInfoLike
} from './walletStorageRuntime'
import type { NetworkWalletStorageConfig } from './walletStorageConfig'

const config: NetworkWalletStorageConfig = {
  revision: 1,
  primary: { kind: 'remote', url: 'https://storage.example.com' },
  backups: [{ kind: 'local' }],
  localStorageIdentityKey: '11'.repeat(32),
  lastSuccessfulSyncAt: {},
  updatedAt: new Date(0).toISOString()
}

const remoteStore = (overrides: Partial<WalletStorageInfoLike> = {}): WalletStorageInfoLike => ({
  isActive: false,
  isEnabled: false,
  isBackup: true,
  isConflicting: false,
  storageIdentityKey: 'remote-id',
  storageName: 'remote',
  storageClass: 'StorageClient',
  endpointURL: 'https://storage.example.com',
  ...overrides
})

const localStore = (overrides: Partial<WalletStorageInfoLike> = {}): WalletStorageInfoLike => ({
  isActive: true,
  isEnabled: true,
  isBackup: false,
  isConflicting: false,
  storageIdentityKey: 'local-id',
  storageName: 'local',
  storageClass: 'StorageIdb',
  ...overrides
})

describe('wallet storage runtime', () => {
  it('bounds sync chunks below common proxy request limits', () => {
    const args = { maxRoughSize: 10_000_000, maxItems: 1_000, marker: 'preserved' }
    const result = applyWalletStorageUploadChunkLimits(args)

    expect(result).toBe(args)
    expect(result).toEqual({
      maxRoughSize: WALLET_STORAGE_SYNC_MAX_ROUGH_SIZE,
      maxItems: WALLET_STORAGE_SYNC_MAX_ITEMS,
      marker: 'preserved'
    })
  })

  it('does not enlarge an already smaller sync request', () => {
    expect(applyWalletStorageUploadChunkLimits({ maxRoughSize: 100_000, maxItems: 50 })).toEqual({
      maxRoughSize: 100_000,
      maxItems: 50
    })
  })

  it('re-reads a sync page with tighter limits when its encoded RPC body is too large', async () => {
    const args = {
      maxRoughSize: 10_000_000,
      maxItems: 1_000,
      offsets: [{ name: 'provenTx', offset: 0 }]
    }
    const getChunk = vi.fn(async (request: typeof args) => ({
      provenTxs: Array.from(
        { length: request.maxItems },
        () => ({ rawTx: 'a'.repeat(30_000) })
      )
    }))

    const chunk = await getBoundedWalletStorageUploadChunk(args, getChunk)

    expect(getChunk.mock.calls.length).toBeGreaterThan(1)
    expect(args.maxItems).toBeLessThan(WALLET_STORAGE_SYNC_MAX_ITEMS)
    expect(new TextEncoder().encode(JSON.stringify(chunk)).byteLength)
      .toBeLessThan(WALLET_STORAGE_SYNC_MAX_ENCODED_BYTES)
  })

  it('reports an actionable error when one wallet row cannot fit in a request', async () => {
    const args = {
      maxRoughSize: 10_000_000,
      maxItems: 1_000,
      offsets: [{ name: 'provenTx', offset: 0 }]
    }

    await expect(getBoundedWalletStorageUploadChunk(args, async () => ({
      provenTxs: [{ rawTx: 'a'.repeat(WALLET_STORAGE_SYNC_MAX_ENCODED_BYTES + 1) }]
    }))).rejects.toThrow(/single transaction proofs record.*large-record transfers/i)
  })

  it('lets the destination transport handle a single large local record', async () => {
    const args = { maxRoughSize: 1000, maxItems: 1 }
    const record = { transactions: [{ inputBEEF: 'a'.repeat(WALLET_STORAGE_SYNC_MAX_ENCODED_BYTES + 1) }] }
    await expect(getBoundedWalletStorageUploadChunk(args, async () => record, true)).resolves.toBe(record)
  })

  it('requests exactly one record before reporting an irreducible response-size failure', async () => {
    const requests: number[] = []
    const args = { maxRoughSize: 64 * 1024, maxItems: 7 }
    const record = { transactions: [{ reference: 'synthetic' }] }
    await expect(getBoundedWalletStorageDownloadChunk(args, async args => {
      requests.push(args.maxItems)
      if (args.maxItems > 1) throw new Error('network error 413')
      return record
    })).resolves.toBe(record)
    expect(requests).toEqual([7, 1])
  })

  it('retries a remote sync page at a smaller response size after a 413', async () => {
    const args = {
      maxRoughSize: 10_000_000,
      maxItems: 1_000,
      offsets: [{ name: 'provenTx', offset: 0 }]
    }
    const getChunk = vi.fn(async (request: typeof args) => {
      if (request.maxRoughSize > WALLET_STORAGE_SYNC_DOWNLOAD_MAX_ROUGH_SIZE / 2) {
        throw new Error('WalletStorageClient rpcCall: network error 413 413')
      }
      return { provenTxs: [] }
    })
    const onRetry = vi.fn()

    await expect(getBoundedWalletStorageDownloadChunk(args, getChunk, onRetry))
      .resolves.toEqual({ provenTxs: [] })
    expect(getChunk).toHaveBeenCalledTimes(2)
    expect(args.maxRoughSize).toBe(WALLET_STORAGE_SYNC_DOWNLOAD_MAX_ROUGH_SIZE / 2)
    expect(onRetry).toHaveBeenCalledWith(
      WALLET_STORAGE_SYNC_DOWNLOAD_MAX_ROUGH_SIZE / 2,
      'response-too-large'
    )
  })

  it('retries an authenticated response timeout with a smaller read-only page', async () => {
    const args = {
      maxRoughSize: 10_000_000,
      maxItems: 1_000,
      offsets: [{ name: 'transaction', offset: 0 }]
    }
    const getChunk = vi.fn(async (request: typeof args) => {
      if (request.maxItems > 125) throw new Error('Timed out waiting for authenticated response.')
      return { transactions: [] }
    })
    const onRetry = vi.fn()

    await expect(getBoundedWalletStorageDownloadChunk(args, getChunk, onRetry))
      .resolves.toEqual({ transactions: [] })
    expect(getChunk).toHaveBeenCalledTimes(2)
    expect(args.maxItems).toBe(125)
    expect(onRetry).toHaveBeenCalledWith(
      WALLET_STORAGE_SYNC_DOWNLOAD_MAX_ROUGH_SIZE / 2,
      'response-timeout'
    )
  })

  it('does not retry unrelated remote storage failures', async () => {
    const args = { maxRoughSize: 10_000_000, maxItems: 1_000 }
    const getChunk = vi.fn(async () => {
      throw new Error('WalletStorageClient rpcCall: network error 503 503')
    })

    await expect(getBoundedWalletStorageDownloadChunk(args, getChunk)).rejects.toThrow(/503/)
    expect(getChunk).toHaveBeenCalledOnce()
  })

  it('summarizes sync chunks for UI progress without exposing wallet data', () => {
    const progress = summarizeWalletStorageSyncChunk({
      fromStorageIdentityKey: 'remote',
      toStorageIdentityKey: 'local',
      since: '2025-01-01T00:00:00.000Z',
      offsets: [
        { name: 'provenTx', offset: 250 },
        { name: 'transaction', offset: 10 }
      ]
    }, {
      provenTxs: [],
      transactions: [
        { updated_at: '2025-06-01T00:00:00.000Z', secret: 'not serialized' },
        { updated_at: '2025-07-01T00:00:00.000Z' }
      ],
      totals: { totalRecords: 500 }
    })

    expect(progress).toMatchObject({
      phase: 'remote:local',
      records: 2,
      completedRecords: 262,
      totalRecords: 500,
      stageIndex: 1,
      stageCount: 2,
      stageName: 'transactions',
      stageOffset: 12,
      earliestUpdatedAt: '2025-06-01T00:00:00.000Z',
      latestUpdatedAt: '2025-07-01T00:00:00.000Z'
    })
    expect(encodeWalletStorageSyncProgress(progress)).not.toContain('secret')
    expect(parseWalletStorageSyncProgress(encodeWalletStorageSyncProgress(progress))).toEqual(progress)
  })

  it('falls back to a cached total without requiring it on every page', () => {
    const progress = summarizeWalletStorageSyncChunk({
      fromStorageIdentityKey: 'remote',
      toStorageIdentityKey: 'local',
      offsets: [{ name: 'transaction', offset: 250 }]
    }, {
      transactions: Array.from({ length: 25 }, () => ({ updated_at: '2026-08-17T00:00:00.000Z' }))
    }, 1_000)

    expect(progress).toMatchObject({
      records: 25,
      completedRecords: 275,
      totalRecords: 1_000
    })
  })

  it('keeps progress indeterminate when an older provider omits totals', () => {
    const progress = summarizeWalletStorageSyncChunk({
      fromStorageIdentityKey: 'remote',
      toStorageIdentityKey: 'local',
      offsets: [{ name: 'transaction', offset: 10 }]
    }, { transactions: [{ updated_at: '2026-08-17T00:00:00.000Z' }] })

    expect(progress.totalRecords).toBeUndefined()
    expect(progress.completedRecords).toBeUndefined()
  })

  it('selects the configured primary by target, not getStores array order', async () => {
    let stores = [localStore(), remoteStore()]
    const manager = {
      isActiveEnabled: true,
      getStores: () => stores,
      setActive: vi.fn(async (storageIdentityKey: string) => {
        expect(storageIdentityKey).toBe('remote-id')
        stores = [
          remoteStore({ isActive: true, isEnabled: true, isBackup: false }),
          localStore({ isActive: false, isEnabled: false, isBackup: true })
        ]
        return 'ok'
      })
    }

    await enforceConfiguredPrimary(manager, config)
    expect(manager.setActive).toHaveBeenCalledOnce()
  })

  it('fails closed when reconciliation does not produce exactly one enabled primary', async () => {
    const manager = {
      isActiveEnabled: false,
      getStores: () => [
        remoteStore({ isActive: true, isEnabled: false, isConflicting: true }),
        localStore({ isActive: true, isEnabled: false, isConflicting: true })
      ],
      setActive: vi.fn(async () => 'partial failure')
    }
    await expect(enforceConfiguredPrimary(manager, config)).rejects.toThrow(/reconciled safely/)
  })

  it('reports configured-but-unattached backups as unavailable', () => {
    const statuses = buildWalletStorageProviderStatuses(
      config,
      [remoteStore({ isActive: true, isEnabled: true, isBackup: false })],
      new Map([['local', 'IndexedDB could not be opened']])
    )
    expect(statuses[0].state).toBe('active')
    expect(statuses[1]).toMatchObject({ state: 'unavailable', error: 'IndexedDB could not be opened' })
  })

  it('updates backups even when the configured primary is already active', async () => {
    const manager = {
      isActiveEnabled: true,
      getStores: () => [
        remoteStore({ isActive: true, isEnabled: true, isBackup: false }),
        localStore({ isActive: false, isEnabled: false, isBackup: true })
      ],
      setActive: vi.fn(async () => 'unchanged'),
      updateBackups: vi.fn(async () => 'synchronized')
    }

    await synchronizeConfiguredBackups(manager, config)

    expect(manager.setActive).not.toHaveBeenCalled()
    expect(manager.updateBackups).toHaveBeenCalledOnce()
  })
})
