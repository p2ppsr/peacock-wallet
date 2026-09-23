import { WalletStorageManager, type StorageProvider, type sdk } from '@bsv/wallet-toolbox-client'
import type { NetworkWalletStorageConfig, WalletStorageTarget } from './walletStorageConfig'
import { walletStorageTargetId } from './walletStorageConfig'
import { enforceConfiguredPrimary, findStoreForTarget } from './walletStorageRuntime'

/** One access queue survives manager replacement and drains requests using old sessions. */
class WalletStorageAccess {
  private tail: Promise<void> = Promise.resolve()
  private closed = false

  async run<R> (operation: () => Promise<R>): Promise<R> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      if (this.closed) throw new Error('Wallet data was restored. Restart the wallet before continuing.')
      return await operation()
    } finally { release() }
  }

  async close (operation: () => Promise<void>): Promise<void> {
    await this.run(async () => { this.closed = true; await operation() })
  }
}

/** Published Toolbox versions identify remotes by constructor name, which bundling/subclassing changes. */
export class WalletBackupStorageManager extends WalletStorageManager {
  constructor (
    private readonly walletIdentityKey: string,
    active?: sdk.WalletStorageProvider,
    backups?: sdk.WalletStorageProvider[],
    private readonly access = new WalletStorageAccess()
  ) {
    super(walletIdentityKey, active, backups)
  }

  createSession (): WalletBackupStorageManager {
    const next = new WalletBackupStorageManager(this.walletIdentityKey, undefined, undefined, this.access)
    next.setServices(this.getServices())
    return next
  }

  /** Drain old requests and fence every session before changing the on-disk binding. */
  async closeForRestore (operation: () => Promise<void>): Promise<void> {
    await this.access.close(operation)
  }

  override async runAsReader<R> (reader: (active: sdk.WalletStorageReader) => Promise<R>): Promise<R> {
    return await this.access.run(async () => super.runAsReader(reader))
  }

  override async runAsWriter<R> (writer: (active: sdk.WalletStorageWriter) => Promise<R>): Promise<R> {
    return await this.access.run(async () => super.runAsWriter(writer))
  }

  override async runAsSync<R> (
    sync: (active: sdk.WalletStorageSync) => Promise<R>, activeSync?: sdk.WalletStorageSync
  ): Promise<R> {
    // Toolbox passes an already-held sync provider to nested merge/copy operations.
    if (activeSync) return await super.runAsSync(sync, activeSync)
    return await this.access.run(async () => super.runAsSync(sync))
  }

  override async runAsStorageProvider<R> (sync: (active: StorageProvider) => Promise<R>): Promise<R> {
    return await this.access.run(async () => super.runAsStorageProvider(sync))
  }

  override getStoreEndpointURL (store: { storage: sdk.WalletStorageProvider }): string | undefined {
    const url = (store.storage as { endpointUrl?: unknown }).endpointUrl
    return typeof url === 'string' && url.length > 0 ? url : undefined
  }
}

/** Stage topology changes away from the manager used by wallet/profile requests. */
export class WalletStorageConnections {
  private providers: Map<string, sdk.WalletStorageProvider>

  constructor (
    private readonly identityKey: string,
    public manager: WalletBackupStorageManager,
    primary: WalletStorageTarget,
    provider: sdk.WalletStorageProvider,
    private readonly publish: (manager: WalletBackupStorageManager) => void
  ) {
    this.providers = new Map([[walletStorageTargetId(primary), provider]])
  }

  private async prepare (providers: Map<string, sdk.WalletStorageProvider>): Promise<WalletBackupStorageManager> {
    const next = this.manager.createSession()
    for (const provider of providers.values()) await next.addWalletStorageProvider(provider)
    return next
  }

  private commit (manager: WalletBackupStorageManager, providers: Map<string, sdk.WalletStorageProvider>): void {
    this.manager = manager
    this.providers = providers
    this.publish(manager)
  }

  async attach (
    target: WalletStorageTarget,
    provider: sdk.WalletStorageProvider,
    config: NetworkWalletStorageConfig,
    progress?: (message: string) => void,
    synchronize = false,
    recoverPrimary = false
  ): Promise<void> {
    const providers = new Map(this.providers)
    providers.set(walletStorageTargetId(target), provider)
    if (synchronize) await this.copyToBackup(provider, config, progress)
    // Committing a new copy must not depend on an unrelated backup answering.
    // Retain every registered location for the next independent sync pass.
    const primaryId = walletStorageTargetId(config.primary)
    const required = new Map([...providers].filter(([id]) => id === primaryId || id === walletStorageTargetId(target)))
    const next = await this.prepare(synchronize ? required : providers)
    // Only an explicit primary-change journal authorizes recovering a changed selection.
    if (recoverPrimary) await enforceConfiguredPrimary(next, config, progress)
    const primary = findStoreForTarget(next.getStores(), config.primary)
    if (!next.isActiveEnabled || !primary?.isActive || !primary.isEnabled) {
      throw new Error('This backup has a conflicting main location. Sync again to reconcile it safely.')
    }
    // No partially attached provider or mutated conflict cache becomes live.
    this.commit(next, providers)
  }

  private async primaryOnly (config: NetworkWalletStorageConfig): Promise<WalletBackupStorageManager> {
    const id = walletStorageTargetId(config.primary)
    const provider = this.providers.get(id)
    if (!provider) throw new Error('Reconnect to your main wallet location before continuing.')
    const next = await this.prepare(new Map([[id, provider]]))
    const primary = findStoreForTarget(next.getStores(), config.primary)
    if (!next.isActiveEnabled || !primary?.isActive || !primary.isEnabled) {
      throw new Error('Your main wallet location needs recovery. Its saved data has not been changed.')
    }
    return next
  }

  private async copyToBackup (
    provider: sdk.WalletStorageProvider,
    config: NetworkWalletStorageConfig,
    progress?: (message: string) => void
  ): Promise<void> {
    const primary = await this.primaryOnly(config)
    const settings = await provider.makeAvailable()
    const primaryKey = primary.getActiveStore()
    if (settings.storageIdentityKey === primaryKey) {
      throw new Error('This location is already your main wallet storage.')
    }
    const { user } = await provider.findOrInsertUser(this.identityKey)
    const auth = { identityKey: this.identityKey, userId: user.userId, isActive: false }
    // Share the live manager's lock with ordinary wallet writes during each copy.
    // Staging must not bypass Toolbox's serialization of writes and sync merges.
    await this.manager.runAsSync(async active => {
      if (user.activeStorage !== primaryKey) {
        progress?.('Preserving existing data from this backup before connecting it…')
        // syncFromReader preserves the chosen primary's activeStorage on every page.
        // setActive's conflict merge does not do so in older published Toolbox clients.
        await primary.syncFromReader(this.identityKey, provider, active)
        // Change only the destination, and only after its unique data has been merged.
        // A lost acknowledgement is recovered by re-reading its user/checkpoint on resume.
        await provider.setActive(auth, primaryKey)
      }
      await primary.syncToWriter(auth, provider, active, undefined, message => {
        progress?.(message)
        return message
      })
    })
  }

  /** Refresh a file-export source without enrolling it in automatic backups. */
  async copyForExport (provider: sdk.WalletStorageProvider, config: NetworkWalletStorageConfig, progress?: (message: string) => void): Promise<void> {
    await this.copyToBackup(provider, config, progress)
  }

  async sync (config: NetworkWalletStorageConfig, progress?: (message: string) => void): Promise<{
    synced: WalletStorageTarget[]
    errors: Map<string, Error>
  }> {
    const primaryId = walletStorageTargetId(config.primary)
    const synced: WalletStorageTarget[] = []
    const errors = new Map<string, Error>()
    let next = await this.primaryOnly(config)
    const healthy = new Map([[primaryId, this.providers.get(primaryId)!]])
    for (const target of config.backups) {
      const id = walletStorageTargetId(target)
      const provider = this.providers.get(id)
      if (!provider) continue
      try {
        await this.copyToBackup(provider, config, progress)
        const candidate = new Map(healthy).set(id, provider)
        const prepared = await this.prepare(candidate)
        await prepared.getAuth(true)
        next = prepared
        healthy.set(id, provider)
        synced.push(target)
      } catch (error) {
        // Cancellation is a command to stop the whole pass, not a provider failure.
        if (error instanceof Error && error.name === 'WalletStorageOperationCancelledError') throw error
        errors.set(id, error instanceof Error ? error : new Error(String(error)))
      }
    }
    this.commit(next, this.providers)
    return { synced, errors }
  }

  /** Prepare a healthy main-only manager without contacting the failed target or deleting data. */
  async preparePrimary (config: NetworkWalletStorageConfig): Promise<() => void> {
    const id = walletStorageTargetId(config.primary)
    const provider = this.providers.get(id)
    if (!provider) throw new Error('Reconnect to your main wallet location before cancelling setup.')
    const providers = new Map([[id, provider]])
    const next = await this.primaryOnly(config)
    return () => this.commit(next, providers)
  }
}
