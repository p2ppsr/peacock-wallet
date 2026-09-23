// Browser/WebView integration fixture: disposable identities and IndexedDB only.
// No funding, remote provider, broadcast, or real wallet state is used.
import { PrivateKey, KeyDeriver } from '@bsv/sdk';
import { StorageIdb, Wallet, Services, CWIStyleWalletManager } from '@bsv/wallet-toolbox-client';
import {
  WalletBackupStorageManager,
  WalletStorageConnections,
} from '../../src/walletStorageConnections.ts';
import { WalletStorageProviderError } from '../../src/walletStorageRpc.ts';
import { clearPendingWalletStorageOperation } from '../../src/walletStorageConfig.ts';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const timeout = (target, method = 'processSyncChunk') =>
  new WalletStorageProviderError(
    target,
    method,
    new Error('Timed out waiting for authenticated response.')
  );
const options = { chain: 'test', commissionSatoshis: 0, feeModel: { model: 'sat/kb', value: 1 } };

export async function runWalletBackupRecoveryQA(report = () => {}) {
  const prefix = `pr42-synthetic-recovery-${crypto.randomUUID()}-`;
  const databases = new Set();
  const providers = new Set();
  const passed = [];
  const check = (name) => {
    passed.push(name);
    report(`PASS: ${name}`);
  };
  let connections, wallet, primary, config, identityKey;
  let publications = 0;
  const main = { kind: 'remote', url: 'https://primary.example.com' };
  const remote = { kind: 'remote', url: 'https://backup.example.com' };
  const createProvider = async (name, key, target) => {
    const provider = new StorageIdb(options);
    provider.dbName = prefix + name;
    databases.add(provider.dbName);
    providers.add(provider);
    if (target?.kind === 'remote') provider.endpointUrl = target.url;
    await provider.migrate(`Synthetic ${name}`, key);
    await provider.makeAvailable();
    const read = provider.getSyncChunk.bind(provider);
    provider.getSyncChunk = (args) => read({ ...args, maxItems: 1, maxRoughSize: 65536 });
    return provider;
  };
  const names = async (provider) =>
    (
      await provider.findOutputBaskets({
        partial: { userId: (await provider.findOrInsertUser(identityKey)).user.userId },
      })
    )
      .map((row) => row.name)
      .sort();
  const seed = async (provider, name) => {
    const { user } = await provider.findOrInsertUser(identityKey);
    return provider.findOrInsertOutputBasket(user.userId, name);
  };
  try {
    const builder = async (key, privilegedKeyManager) => {
      if (wallet) return wallet;
      const keyDeriver = new KeyDeriver(new PrivateKey(key));
      identityKey = keyDeriver.identityKey;
      primary = await createProvider('primary', '1'.repeat(64), main);
      const manager = new WalletBackupStorageManager(identityKey);
      const services = new Services(Services.createDefaultOptions('test'));
      wallet = new Wallet({
        chain: 'test',
        keyDeriver,
        storage: manager,
        services,
        privilegedKeyManager,
      });
      await manager.addWalletStorageProvider(primary);
      connections = new WalletStorageConnections(identityKey, manager, main, primary, (next) => {
        wallet.storage = next;
      });
      config = {
        revision: 1,
        primary: main,
        backups: [],
        localStorageIdentityKey: '3'.repeat(64),
        lastSuccessfulSyncAt: {},
        updatedAt: new Date().toISOString(),
      };
      return wallet;
    };
    // Exercise the real addProfile/encryption lifecycle. Only token publication is
    // replaced: it runs actual wallet reads and an authenticated IndexedDB write.
    const interactor = {
      findByPresentationKeyHash: async () => undefined,
      findByRecoveryKeyHash: async () => undefined,
      buildAndSend: async (activeWallet) => {
        await activeWallet.listOutputs({ basket: 'synthetic-profile', limit: 1 });
        const auth = await activeWallet.storage.getAuth(true);
        await activeWallet.storage.runAsWriter((writer) =>
          writer.findOrInsertOutputBasket(
            auth.userId,
            `synthetic-profile-publication-${++publications}`
          )
        );
        return `${'a'.repeat(64)}.${publications}`;
      },
    };
    const profiles = new CWIStyleWalletManager(
      'qa.example.com',
      builder,
      interactor,
      async () => true,
      async () => 'disposable-fixture-password',
      undefined,
      undefined,
      { algorithm: 'pbkdf2-sha512', iterations: 1 }
    ); // Deliberately cheap for disposable test identities only.
    await profiles.providePresentationKey(Array(32).fill(17));
    await profiles.providePassword('disposable-fixture-password');
    await seed(primary, 'main-only');
    let backup = await createProvider('backup', '2'.repeat(64), remote);
    await seed(backup, 'backup-only-a');
    await seed(backup, 'backup-only-b');
    config.pendingOperation = {
      id: 'synthetic-setup',
      kind: 'add-backup',
      target: remote,
      startedAt: new Date().toISOString(),
    };
    const write = primary.processSyncChunk.bind(primary);
    let writes = 0;
    primary.processSyncChunk = async (args, chunk) => {
      const result = await write(args, chunk);
      if (++writes === 2) throw timeout(main); // Commit then lose the acknowledgement.
      return result;
    };
    let failed = false;
    try {
      await connections.attach(remote, backup, config, undefined, true);
    } catch (error) {
      failed = error instanceof WalletStorageProviderError;
    }
    assert(failed, 'Expected a timeout after a committed conflict-merge page');
    assert(
      (await primary.findOrInsertUser(identityKey)).user.activeStorage === '1'.repeat(64),
      'Main selection changed on failure'
    );
    assert(
      (await connections.manager.getAuth(true)).isActive,
      'Wallet access disabled by backup failure'
    );
    check('partial merge and lost acknowledgement preserve cached and persisted main access');
    await profiles.addProfile('After failed backup');
    assert(
      profiles.listProfiles().some((profile) => profile.name === 'After failed backup'),
      'Profile creation failed after backup timeout'
    );
    check('real addProfile lifecycle succeeds after timeout (token publication stubbed)');
    primary.processSyncChunk = write;
    // Reopen the failed destination and discard connection-manager caches, as on restart.
    await backup.destroy();
    backup = await createProvider('backup', '2'.repeat(64), remote);
    const freshManager = new WalletBackupStorageManager(identityKey);
    freshManager.setServices(connections.manager.getServices());
    await freshManager.addWalletStorageProvider(primary);
    wallet.storage = freshManager;
    connections = new WalletStorageConnections(identityKey, freshManager, main, primary, (next) => {
      wallet.storage = next;
    });
    await connections.attach(remote, backup, config, undefined, true);
    assert(
      JSON.stringify(await names(primary)) === JSON.stringify(await names(backup)),
      'Resume lost or duplicated basket data'
    );
    check('reopened IndexedDB resumes durable checkpoints and preserves both stores data');
    config = { ...clearPendingWalletStorageOperation(config), backups: [remote] };
    const failedTarget = { kind: 'remote', url: 'https://unavailable.example.com' };
    const failedBackup = await createProvider('unavailable', '4'.repeat(64), failedTarget);
    await seed(failedBackup, 'second-backup-only');
    failedBackup.setActive = async () => {
      throw timeout(failedTarget, 'setActive');
    };
    config.pendingOperation = {
      id: 'synthetic-cancel',
      kind: 'add-backup',
      target: failedTarget,
      startedAt: new Date().toISOString(),
    };
    failed = false;
    try {
      await connections.attach(failedTarget, failedBackup, config, undefined, true);
    } catch (error) {
      failed = error instanceof WalletStorageProviderError;
    }
    assert(failed, 'Expected failed destination alignment');
    const kept = await names(failedBackup);
    failedBackup.makeAvailable = async () => {
      throw new Error('Failed target must not be contacted by cancellation');
    };
    const install = await connections.preparePrimary(config);
    config = clearPendingWalletStorageOperation(config);
    install();
    assert(
      config.backups.length === 1 && !config.pendingOperation,
      'Cancellation changed existing backup configuration'
    );
    await profiles.addProfile('After cancelled setup');
    assert(
      profiles.listProfiles().some((profile) => profile.name === 'After cancelled setup'),
      'Profile creation failed after cancellation'
    );
    check(
      'cancel avoids the unavailable target and retains existing configuration and profile access'
    );
    const local = await createProvider('local', '3'.repeat(64), { kind: 'local' });
    await connections.attach({ kind: 'local' }, local, config, undefined, true);
    assert(
      JSON.stringify(await names(primary)) === JSON.stringify(await names(local)),
      'Local backup differs after cancellation'
    );
    assert(
      kept.includes('second-backup-only') && (await names(primary)).includes('second-backup-only'),
      'Cancellation lost conflicting data'
    );
    const before = JSON.stringify(await names(local));
    let mutations = 0;
    const localWrite = local.processSyncChunk.bind(local);
    local.processSyncChunk = async (args, chunk) => {
      const result = await localWrite(args, chunk);
      mutations += result.inserts + result.updates;
      return result;
    };
    const synced = await connections.sync({ ...config, backups: [{ kind: 'local' }] });
    assert(synced.errors.size === 0 && synced.synced.length === 1, 'Local resync did not complete');
    assert(
      JSON.stringify(await names(local)) === before && mutations === 0,
      'Unchanged local resync mutated data'
    );
    check(
      'local backup succeeds after cancellation and unchanged resync makes zero entity mutations'
    );
    return { passed, tokenPublicationStubbed: true, databaseCount: databases.size };
  } finally {
    for (const provider of providers) await provider.destroy();
    for (const name of databases) {
      assert(name.startsWith(prefix), 'Refusing to remove an unrelated database');
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Synthetic database cleanup is blocked'));
      });
    }
    report('CLEANUP: disposable databases removed');
  }
}
