import { describe, expect, it, vi } from 'vitest'
import { type sdk } from '@bsv/wallet-toolbox-client'
import { WalletBackupStorageManager, WalletStorageConnections } from './walletStorageConnections'
import { clearPendingWalletStorageOperation, type NetworkWalletStorageConfig } from './walletStorageConfig'

const primaryTarget = { kind: 'remote', url: 'https://primary.example.com' } as const
const backupTarget = { kind: 'remote', url: 'https://backup.example.com' } as const
const config: NetworkWalletStorageConfig = {
  revision: 1, primary: primaryTarget, backups: [], localStorageIdentityKey: 'local',
  lastSuccessfulSyncAt: {}, updatedAt: new Date(0).toISOString(),
  pendingOperation: { id: 'synthetic', kind: 'add-backup', target: backupTarget, startedAt: new Date(0).toISOString() }
}
const entities = ['provenTx', 'outputBasket', 'outputTag', 'txLabel', 'transaction', 'output',
  'txLabelMap', 'outputTagMap', 'certificate', 'certificateField', 'commission', 'provenTxReq']

// Synthetic durable paginated provider. Real Toolbox manages authentication, conflict
// classification and checkpoint requests; faults occur at actual provider boundaries.
class SyntheticProvider {
  user: { userId: number; identityKey: string; activeStorage: string; created_at: Date; updated_at: Date }
  rows = new Set<string>()
  offsets = new Map<string, number>()
  reads: number[] = []
  writes = 0
  failAvailable = false
  failWrite = 0
  loseAcknowledgement = false
  failSetActive = false
  constructor (readonly key: string, readonly endpointUrl?: string, activeStorage = key) {
    this.user = { userId: 1, identityKey: 'wallet', activeStorage, created_at: new Date(0), updated_at: new Date(key === 'primary' ? 1 : 2) }
  }
  asProvider (): sdk.WalletStorageProvider { return this as unknown as sdk.WalletStorageProvider }
  isStorageProvider () { return false }
  isAvailable () { return true }
  setServices () {}
  getSettings () { return { storageIdentityKey: this.key, storageName: this.key } }
  async makeAvailable () {
    if (this.failAvailable) throw new Error('Timed out waiting for authenticated response.')
    return this.getSettings()
  }
  async findOrInsertUser () { return { user: { ...this.user }, isNew: false } }
  async findOrInsertSyncStateAuth (_auth: unknown, key: string) {
    return { syncState: {
      syncStateId: 1, userId: 1, storageIdentityKey: key, storageName: key,
      created_at: new Date(0), updated_at: new Date(0), init: false, refNum: '', status: 'unknown',
      syncMap: JSON.stringify(Object.fromEntries(entities.map(entityName => [entityName, {
        entityName, count: entityName === 'outputBasket' ? this.offsets.get(key) ?? 0 : 0, idMap: {}
      }])))
    }, isNew: false }
  }
  async getSyncChunk (args: sdk.RequestSyncChunkArgs) {
    const offset = args.offsets.find(o => o.name === 'outputBasket')!.offset
    this.reads.push(offset)
    const names = [...this.rows].slice(offset, offset + 1)
    return { fromStorageIdentityKey: this.key, toStorageIdentityKey: args.toStorageIdentityKey,
      userIdentityKey: 'wallet', user: { ...this.user },
      outputBaskets: names.map(name => ({ name, basketId: 1, userId: 1, created_at: new Date(0), updated_at: new Date(2) })) }
  }
  async processSyncChunk (args: sdk.RequestSyncChunkArgs, chunk: sdk.SyncChunk) {
    this.writes++
    const fail = this.writes === this.failWrite
    if (fail && !this.loseAcknowledgement) throw new Error('Timed out waiting for authenticated response.')
    if (chunk.user && chunk.user.updated_at > this.user.updated_at) this.user = { ...chunk.user } as typeof this.user
    for (const row of chunk.outputBaskets ?? []) this.rows.add(row.name)
    const oldOffset = args.offsets.find(o => o.name === 'outputBasket')!.offset
    this.offsets.set(args.fromStorageIdentityKey, oldOffset + (chunk.outputBaskets?.length ?? 0))
    if (fail) throw new Error('Timed out waiting for authenticated response.')
    return { inserts: chunk.outputBaskets?.length ?? 0, updates: 0, done: !chunk.outputBaskets?.length }
  }
  async setActive (_auth: unknown, key: string) {
    if (this.failSetActive) throw new Error('Timed out waiting for authenticated response.')
    this.user.activeStorage = key
    this.user.updated_at = new Date(this.user.updated_at.getTime() + 1)
    return 1
  }
}

async function fixture () {
  const primary = new SyntheticProvider('primary', primaryTarget.url)
  primary.rows.add('main-data')
  const backup = new SyntheticProvider('backup', backupTarget.url)
  backup.rows.add('backup-only-a'); backup.rows.add('backup-only-b')
  const manager = new WalletBackupStorageManager('wallet')
  manager.setServices({} as sdk.WalletServices)
  await manager.addWalletStorageProvider(primary.asProvider())
  const publish = vi.fn()
  const connections = new WalletStorageConnections('wallet', manager, primaryTarget, primary.asProvider(), publish)
  return { primary, backup, manager, publish, connections }
}

describe('backup setup failure isolation with real Toolbox manager', () => {
  it('reproduces the reported old attach/setActive failure that blocks profile access', async () => {
    const { primary, backup, manager } = await fixture()
    primary.failWrite = 2
    await manager.addWalletStorageProvider(backup.asProvider())
    await expect(manager.setActive('primary')).rejects.toThrow(/Timed out/)
    await expect(manager.getAuth(true)).rejects.toThrow(/not accessing|conflicting/)
    expect(primary.user.activeStorage).toBe('backup')
  })

  it('preserves cached and persisted primary access after a partial conflict merge and resumes saved pages', async () => {
    const { primary, backup, manager, publish, connections } = await fixture()
    primary.failWrite = 2
    await expect(connections.attach(backupTarget, backup.asProvider(), config, undefined, true)).rejects.toThrow(/Timed out/)
    expect(connections.manager).toBe(manager)
    expect(publish).not.toHaveBeenCalled()
    expect(primary.user.activeStorage).toBe('primary')
    expect(primary.rows.has('backup-only-a')).toBe(true)
    await expect(manager.getAuth(true)).resolves.toMatchObject({ isActive: true })
    const fresh = new WalletBackupStorageManager('wallet', primary.asProvider())
    await expect(fresh.getAuth(true)).resolves.toMatchObject({ isActive: true })
    await connections.attach(backupTarget, backup.asProvider(), config, undefined, true)
    expect(backup.reads.slice(0, 3)).toEqual([0, 1, 1])
    expect(backup.rows).toEqual(primary.rows)
    expect(primary.user.activeStorage).toBe('primary')
    expect(backup.user.activeStorage).toBe('primary')
    await expect(connections.manager.getAuth(true)).resolves.toMatchObject({ isActive: true })
  })

  it('reads the durable destination checkpoint after a committed page loses its acknowledgement', async () => {
    const { primary, backup, connections } = await fixture()
    backup.user.activeStorage = 'primary'
    backup.failWrite = 1; backup.loseAcknowledgement = true
    await expect(connections.attach(backupTarget, backup.asProvider(), config, undefined, true)).rejects.toThrow(/Timed out/)
    expect(backup.rows.has('main-data')).toBe(true)
    await connections.attach(backupTarget, backup.asProvider(), config, undefined, true)
    expect(primary.reads).toEqual([0, 1])
    await expect(connections.manager.getAuth(true)).resolves.toMatchObject({ isActive: true })
  })

  it('cancels without contacting the failed backup, keeps its data, and permits a local backup', async () => {
    const { primary, backup, connections } = await fixture()
    backup.failSetActive = true
    await expect(connections.attach(backupTarget, backup.asProvider(), config, undefined, true)).rejects.toThrow(/Timed out/)
    backup.failAvailable = true
    const retained = [...backup.rows]
    const install = await connections.preparePrimary(config)
    const cancelled = clearPendingWalletStorageOperation(config)
    install()
    expect(cancelled.pendingOperation).toBeUndefined()
    await expect(connections.manager.getAuth(true)).resolves.toMatchObject({ isActive: true })
    const local = new SyntheticProvider('local', undefined, 'primary')
    await connections.attach({ kind: 'local' }, local.asProvider(), cancelled, undefined, true)
    expect(local.rows).toEqual(primary.rows)
    expect([...backup.rows]).toEqual(retained)
    expect(connections.manager.getStores().map(s => s.storageIdentityKey)).toEqual(['primary', 'local'])
  })

  it('keeps existing backup configuration when setup is cancelled and reconnects it later', async () => {
    const { primary, connections } = await fixture()
    const existing = new SyntheticProvider('existing', 'https://existing.example.com', 'primary')
    const existingTarget = { kind: 'remote', url: existing.endpointUrl! } as const
    const configured = { ...config, backups: [existingTarget] }
    await connections.attach(existingTarget, existing.asProvider(), configured)
    const install = await connections.preparePrimary(configured)
    const cancelled = clearPendingWalletStorageOperation(configured)
    install()
    expect(cancelled.backups).toEqual([existingTarget])
    await connections.attach(existingTarget, existing.asProvider(), cancelled, undefined, true)
    expect(existing.rows).toEqual(primary.rows)
    expect(connections.manager.getStores().map(s => s.storageIdentityKey)).toEqual(['primary', 'existing'])
  })

  it('adds a local copy independently of an already attached degraded backup', async () => {
    const { primary, connections } = await fixture()
    const remote = new SyntheticProvider('existing', 'https://existing.example.com', 'primary')
    const target = { kind: 'remote', url: remote.endpointUrl! } as const
    const configured = { ...clearPendingWalletStorageOperation(config), backups: [target] }
    await connections.attach(target, remote.asProvider(), configured)
    remote.failAvailable = true
    const local = new SyntheticProvider('local', undefined, 'primary')
    await connections.attach({ kind: 'local' }, local.asProvider(), configured, undefined, true)
    expect(local.rows).toEqual(primary.rows)
    expect(connections.manager.getStores().some(store => store.storageIdentityKey === 'local')).toBe(true)
    const result = await connections.sync({ ...configured, backups: [target, { kind: 'local' }] })
    expect(result.synced).toEqual([{ kind: 'local' }])
    expect(result.errors.get('remote:https://existing.example.com')?.message).toMatch(/Timed out/)
    remote.failAvailable = false
    const recovered = await connections.sync({ ...configured, backups: [target, { kind: 'local' }] })
    expect(recovered.errors.size).toBe(0)
    expect(recovered.synced).toHaveLength(2)
  })

  it('serializes conflict merges with wallet writes and releases the lock after failure', async () => {
    const { primary, backup, manager, connections } = await fixture()
    let start!: () => void
    let fail!: () => void
    const started = new Promise<void>(resolve => { start = resolve })
    const gate = new Promise<never>((_resolve, reject) => { fail = () => reject(new Error('Timed out waiting for authenticated response.')) })
    vi.spyOn(primary, 'processSyncChunk').mockImplementationOnce(async () => { start(); return gate })
    const setup = connections.attach(backupTarget, backup.asProvider(), config, undefined, true).catch(error => error)
    await started
    let writerEntered = false
    const write = manager.runAsWriter(async () => { writerEntered = true; return await manager.getAuth(true) })
    await Promise.resolve()
    expect(writerEntered).toBe(false)
    fail()
    expect(await setup).toBeInstanceOf(Error)
    await expect(write).resolves.toMatchObject({ isActive: true })
    expect(writerEntered).toBe(true)
  })

  it.each(['runAsReader', 'runAsWriter', 'runAsSync'] as const)(
    'keeps %s serialized with requests still using the manager replaced during recovery', async mode => {
      const { manager, connections } = await fixture()
      let enter!: () => void
      let release!: () => void
      const entered = new Promise<void>(resolve => { enter = resolve })
      const gate = new Promise<void>(resolve => { release = resolve })
      const order: string[] = []
      const oldRequest = manager.runAsWriter(async () => {
        order.push('old start'); enter(); await gate; order.push('old finish')
      })
      await entered
      const queuedOldRequest = manager.runAsWriter(async () => { order.push('queued old') })
      const install = await connections.preparePrimary(config)
      install()
      const newRequest = connections.manager[mode](async () => { order.push('new') })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(order).toEqual(['old start'])
      release()
      await Promise.all([oldRequest, queuedOldRequest, newRequest])
      expect(order).toEqual(['old start', 'old finish', 'queued old', 'new'])
    })

  it('does not poison the live manager when provider discovery fails', async () => {
    const { backup, manager, connections } = await fixture()
    backup.failAvailable = true
    await expect(connections.attach(backupTarget, backup.asProvider(), config)).rejects.toThrow(/Timed out/)
    expect(connections.manager).toBe(manager)
    await expect(manager.getAuth(true)).resolves.toMatchObject({ isActive: true })
  })

  it('keeps a conflicting startup backup detached until explicitly reconciled', async () => {
    const { primary, backup, manager, connections } = await fixture()
    await expect(connections.attach(backupTarget, backup.asProvider(), config)).rejects.toThrow(/conflicting/)
    expect(primary.writes + backup.writes).toBe(0)
    await expect(manager.getAuth(true)).resolves.toMatchObject({ isActive: true })
  })

  it('fails closed when the saved main provider points to a different active location', async () => {
    const { primary, backup, connections } = await fixture()
    primary.user.activeStorage = 'elsewhere'
    await expect(connections.attach(backupTarget, backup.asProvider(), config, undefined, true)).rejects.toThrow(/needs recovery/)
    await expect(connections.preparePrimary(config)).rejects.toThrow(/needs recovery/)
    expect(primary.user.activeStorage).toBe('elsewhere')
    expect(backup.writes).toBe(0)
  })
})

it('drains the current operation and fences queued requests across all sessions for restore', async () => {
  const { manager } = await fixture()
  const sibling = manager.createSession()
  let release!: () => void
  const held = manager.runAsSync(async () => await new Promise<void>(resolve => { release = resolve }))
  while (!release) await Promise.resolve()
  const commit = vi.fn(async () => {})
  const closing = manager.closeForRestore(commit)
  const queued = sibling.runAsReader(async () => 'must not run')
  const rejected = expect(queued).rejects.toThrow(/Restart the wallet/)
  expect(commit).not.toHaveBeenCalled()
  release(); await held; await closing; await rejected
  expect(commit).toHaveBeenCalledTimes(1)
  await expect(manager.runAsWriter(async () => 'must not run')).rejects.toThrow(/Restart the wallet/)
})


it('refreshes a one-off export copy without enrolling a provider or changing backup preferences', async () => {
  const { primary, manager, connections, publish } = await fixture()
  const copy = new SyntheticProvider('export-copy', undefined, 'primary')
  const preferences = { ...clearPendingWalletStorageOperation(config), backupMode: 'device' as const, automaticBackups: false }
  await connections.copyForExport(copy.asProvider(), preferences)
  expect(copy.rows).toEqual(primary.rows)
  expect(connections.manager).toBe(manager)
  expect(connections.manager.getStores().map(store => store.storageIdentityKey)).toEqual(['primary'])
  expect(publish).not.toHaveBeenCalled()
  expect(preferences.backups).toEqual([])
  expect(preferences.automaticBackups).toBe(false)
})
