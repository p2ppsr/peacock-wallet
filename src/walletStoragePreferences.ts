import {
  normalizeWalletStorageTarget,
  walletStorageTargetId,
  type NetworkWalletStorageConfig,
  type WalletStorageNetwork,
  type WalletStorageTarget,
} from './walletStorageConfig';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export const DEVICE_BACKUP_PREFERENCES_KEY = 'peacock.device-backup-preferences.v1';
export interface DeviceBackupPreferences {
  backups: WalletStorageTarget[];
  automatic: boolean;
}
export interface ResolvedBackupPreferences extends DeviceBackupPreferences {
  mode: 'device' | 'profile';
}
export const defaultDeviceBackupPreferences = (): DeviceBackupPreferences => ({
  backups: [{ kind: 'local' }],
  automatic: true,
});

export function normalizeBackupPreferences(
  value: DeviceBackupPreferences
): DeviceBackupPreferences {
  const unique = new Map<string, WalletStorageTarget>();
  for (const entry of value.backups) {
    const target = normalizeWalletStorageTarget(entry);
    unique.set(walletStorageTargetId(target), target);
  }
  return { backups: [...unique.values()], automatic: value.automatic === true };
}
export function loadDeviceBackupPreferences(
  storage: Storage,
  network: WalletStorageNetwork
): DeviceBackupPreferences {
  const raw = storage.getItem(`${DEVICE_BACKUP_PREFERENCES_KEY}.${network}`);
  if (!raw) return defaultDeviceBackupPreferences();
  try {
    return normalizeBackupPreferences(JSON.parse(raw));
  } catch {
    throw new Error(
      'The device backup preferences need recovery. Existing profile copies have been kept.'
    );
  }
}
export function saveDeviceBackupPreferences(
  storage: Storage,
  network: WalletStorageNetwork,
  preferences: DeviceBackupPreferences
): void {
  const key = `${DEVICE_BACKUP_PREFERENCES_KEY}.${network}`,
    encoded = JSON.stringify(normalizeBackupPreferences(preferences));
  storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded)
    throw new Error('Could not save the device backup preferences');
}
export function resolveBackupPreferences(
  config: NetworkWalletStorageConfig,
  device: DeviceBackupPreferences
): ResolvedBackupPreferences {
  return config.backupMode === 'device'
    ? { ...device, mode: 'device' }
    : { mode: 'profile', backups: config.backups, automatic: config.automaticBackups !== false };
}
/** Preferences contain destinations, never profile identities, databases, checkpoints,
 * activeStorage or recovery journals. Existing primary selection always wins. */
export function missingPreferredBackups(
  config: NetworkWalletStorageConfig,
  preferences: ResolvedBackupPreferences
): WalletStorageTarget[] {
  if (preferences.mode !== 'device' || config.pendingOperation) return [];
  const configured = new Set([config.primary, ...config.backups].map(walletStorageTargetId));
  return preferences.backups.filter((target) => !configured.has(walletStorageTargetId(target)));
}
export function reconcileBackupPreferences(
  config: NetworkWalletStorageConfig,
  device: DeviceBackupPreferences
): NetworkWalletStorageConfig {
  if (config.backupMode !== 'device' || config.pendingOperation) return config;
  const wanted = new Set(device.backups.map(walletStorageTargetId));
  const backups = config.backups.filter((target) => wanted.has(walletStorageTargetId(target)));
  return backups.length === config.backups.length ? config : { ...config, backups };
}
