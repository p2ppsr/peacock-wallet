import type { ArchiveJob } from './walletPortabilityStore';
import { PortabilityError } from './walletPortability';
import { WALLET_STORAGE_CONFIG_KEY, type NetworkWalletStorageConfig } from './walletStorageConfig';
import { localWalletDatabaseName } from './walletStorageLocal';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'peacock.wallet-archive-activation.v1.';
interface Activation {
  id: string;
  identityKey: string;
  chain: 'main' | 'test' | 'ttn';
  configKey: string;
  bindingKey: string;
  config: string;
  binding: string;
  previousConfig: string | null;
  previousBinding: string | null;
}

/** A synchronous write-ahead record makes the two localStorage writes replayable.
 * Previous settings remain in a separate recovery record, never silently reactivated. */
export function commitArchiveActivation(storage: Storage, job: ArchiveJob): void {
  const summary = job.summary;
  if (
    !summary ||
    job.state !== 'activating' ||
    !job.activationDatabaseName ||
    !job.activationStorageIdentityKey
  )
    throw new PortabilityError('storage');
  if (
    job.activationDatabaseName !==
    localWalletDatabaseName(summary.chain, summary.identityKey, job.activationStorageIdentityKey)
  )
    throw new PortabilityError('identity');
  const configKey = `${WALLET_STORAGE_CONFIG_KEY}.${summary.identityKey}`;
  const bindingKey = `peacock.wallet-storage-db.v1.${summary.chain}.${summary.identityKey}`;
  const previousConfig = storage.getItem(configKey),
    previousBinding = storage.getItem(bindingKey);
  const envelope = previousConfig ? JSON.parse(previousConfig) : { version: 1, networks: {} };
  const next: NetworkWalletStorageConfig = {
    revision: (envelope.networks[summary.chain]?.revision ?? 0) + 1,
    backupMode: 'profile',
    automaticBackups: false,
    primary: { kind: 'local' },
    backups: [],
    localStorageIdentityKey: job.activationStorageIdentityKey,
    lastSuccessfulSyncAt: {},
    updatedAt: new Date().toISOString(),
  };
  envelope.networks[summary.chain] = next;
  const activation: Activation = {
    id: job.id,
    identityKey: summary.identityKey,
    chain: summary.chain,
    configKey,
    bindingKey,
    previousConfig,
    previousBinding,
    config: JSON.stringify(envelope),
    binding: JSON.stringify({
      name: job.activationDatabaseName,
      storageIdentityKey: job.activationStorageIdentityKey,
    }),
  };
  const key = `${PREFIX}${summary.chain}.${summary.identityKey}`;
  const encoded = JSON.stringify(activation);
  storage.setItem(`${PREFIX}history.${job.id}`, encoded);
  storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded) throw new PortabilityError('storage');
  recoverArchiveActivation(storage, summary.chain, summary.identityKey);
}

export function recoverArchiveActivation(
  storage: Storage,
  chain: 'main' | 'test' | 'ttn',
  identityKey: string
): void {
  const key = `${PREFIX}${chain}.${identityKey}`,
    raw = storage.getItem(key);
  if (!raw) return;
  const record = JSON.parse(raw) as Activation;
  if (
    record.identityKey !== identityKey ||
    record.chain !== chain ||
    record.configKey !== `${WALLET_STORAGE_CONFIG_KEY}.${identityKey}` ||
    record.bindingKey !== `peacock.wallet-storage-db.v1.${chain}.${identityKey}`
  )
    throw new PortabilityError('identity');
  storage.setItem(record.bindingKey, record.binding);
  storage.setItem(record.configKey, record.config);
  if (
    storage.getItem(record.bindingKey) !== record.binding ||
    storage.getItem(record.configKey) !== record.config
  )
    throw new PortabilityError('storage');
  storage.removeItem(key);
}
