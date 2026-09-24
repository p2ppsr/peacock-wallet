import { expect, it, vi } from 'vitest'
import { localWalletDatabaseName, resolveLocalWalletDatabase, inspectLocalWalletDatabase } from './walletStorageLocal'

const identity = '02' + 'a'.repeat(64)
const key = '1'.repeat(64)
const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) } }
}

it('separates deterministic database names by wallet, network and storage identity', () => {
  const names = [localWalletDatabaseName('main', identity, key), localWalletDatabaseName('test', identity, key),
    localWalletDatabaseName('main', '03' + 'b'.repeat(64), key), localWalletDatabaseName('main', identity, '2'.repeat(64))]
  expect(new Set(names).size).toBe(4)
  expect(localWalletDatabaseName('main', identity, key)).toBe(names[0])
})

it('preserves a verified legacy backup in place, including its original storage identity', async () => {
  const storage = memory()
  const inspect = vi.fn().mockResolvedValue({ hasUser: true, chain: 'main', storageIdentityKey: '2'.repeat(64) })
  const first = await resolveLocalWalletDatabase(storage, 'main', identity, key, true, inspect)
  expect(first).toEqual({ name: 'wallet-toolbox-mainnet', storageIdentityKey: '2'.repeat(64) })
  expect(await resolveLocalWalletDatabase(storage, 'main', identity, key, true, inspect)).toEqual(first)
  expect(inspect.mock.calls.every(call => call[0] === 'wallet-toolbox-mainnet')).toBe(true)
})

it('ignores an unrelated legacy wallet and never substitutes an empty database for a lost existing backup', async () => {
  const unrelated = vi.fn().mockResolvedValue({ hasUser: false, chain: 'main', storageIdentityKey: key })
  const storage = memory()
  const fresh = await resolveLocalWalletDatabase(storage, 'main', identity, key, false, unrelated)
  expect(fresh.name).toBe(localWalletDatabaseName('main', identity, key))
  await expect(resolveLocalWalletDatabase(storage, 'main', identity, key, true, vi.fn().mockResolvedValue(undefined))).rejects.toThrow(/missing/)
  await expect(resolveLocalWalletDatabase(memory(), 'main', identity, key, true, unrelated)).rejects.toThrow(/could not be found/)
})

it('bounds a blocked metadata open and closes a late connection without reading it', async () => {
  vi.useFakeTimers()
  const request = {} as IDBOpenDBRequest
  const close = vi.fn()
  vi.stubGlobal('indexedDB', { open: () => request })
  try {
    const result = expect(inspectLocalWalletDatabase('synthetic-test', identity)).rejects.toThrow(/still busy/)
    await vi.advanceTimersByTimeAsync(15_000)
    await result
    Object.defineProperty(request, 'result', { value: { close } })
    request.onsuccess!.call(request, new Event('success'))
    expect(close).toHaveBeenCalledOnce()
  } finally { vi.useRealTimers(); vi.unstubAllGlobals() }
})

it('rejects malformed legacy metadata instead of leaving an unresolved setup promise', async () => {
  const request = {} as IDBOpenDBRequest
  const close = vi.fn()
  vi.stubGlobal('indexedDB', { open: () => request })
  try {
    const result = expect(inspectLocalWalletDatabase('synthetic-test', identity)).rejects.toThrow(/missing index/)
    Object.defineProperty(request, 'result', { value: {
      close, objectStoreNames: { contains: () => true },
      transaction: () => { throw new Error('missing index') }
    } })
    request.onsuccess!.call(request, new Event('success'))
    await result
    expect(close).toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})
