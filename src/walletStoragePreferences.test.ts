import { expect, it } from 'vitest';
import {
  createDefaultWalletStorageConfig,
  persistWalletStorageConfig,
  loadWalletStorageConfig,
} from './walletStorageConfig';
import { loadProfileWalletStorageConfig, walletProfileStorage } from './walletStorageProfiles';
import {
  loadDeviceBackupPreferences,
  saveDeviceBackupPreferences,
  resolveBackupPreferences,
  reconcileBackupPreferences,
  missingPreferredBackups,
} from './walletStoragePreferences';

it('shares destinations across profiles without sharing primary selection, IDs, checkpoints, or pending work', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const a = '02' + 'a'.repeat(64),
    b = '03' + 'b'.repeat(64);
  const device = {
    automatic: true,
    backups: [
      { kind: 'local' as const },
      { kind: 'remote' as const, url: 'https://backup.example' },
    ],
  };
  saveDeviceBackupPreferences(storage, 'main', device);
  const first = {
    ...createDefaultWalletStorageConfig('https://main.example', () => '1'.repeat(64)),
    lastSuccessfulSyncAt: { local: 'a-only' },
  };
  persistWalletStorageConfig(walletProfileStorage(storage, a), 'main', first);
  const second = createDefaultWalletStorageConfig('https://different.example', () =>
    '2'.repeat(64)
  );
  persistWalletStorageConfig(walletProfileStorage(storage, b), 'main', second);
  const profileA = loadProfileWalletStorageConfig(storage, 'main', a, 'https://main.example', () =>
    '3'.repeat(64)
  );
  const profileB = loadProfileWalletStorageConfig(storage, 'main', b, 'https://main.example', () =>
    '4'.repeat(64)
  );
  expect(resolveBackupPreferences(profileA, device).backups).toEqual(
    resolveBackupPreferences(profileB, device).backups
  );
  expect(profileB.primary).toEqual(second.primary);
  expect(profileB.localStorageIdentityKey).not.toBe(profileA.localStorageIdentityKey);
  expect(profileB.lastSuccessfulSyncAt).toEqual({});
  expect(missingPreferredBackups(profileB, resolveBackupPreferences(profileB, device))).toEqual(
    device.backups
  );
  expect(loadDeviceBackupPreferences(storage, 'test').backups).toEqual([{ kind: 'local' }]);
  const independent = {
    ...profileB,
    backupMode: 'profile' as const,
    backups: [{ kind: 'remote' as const, url: 'https://private.example' }],
  };
  expect(reconcileBackupPreferences(independent, device)).toBe(independent);
  expect(
    missingPreferredBackups(independent, resolveBackupPreferences(independent, device))
  ).toEqual([]);
});

it('preserves existing independent setups and never uses global preferences to change the active location', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const config = createDefaultWalletStorageConfig('https://primary.example', () => '1'.repeat(64));
  const { backupMode: _mode, automaticBackups: _automatic, ...old } = config;
  persistWalletStorageConfig(storage, 'main', {
    ...old,
    primary: { kind: 'local' },
    backups: [{ kind: 'remote', url: 'https://old.example' }],
  });
  const migrated = loadWalletStorageConfig(storage, 'main', 'https://primary.example', () =>
    '2'.repeat(64)
  );
  expect(migrated.backupMode).toBe('profile');
  const device = { automatic: false, backups: [{ kind: 'local' as const }] };
  expect(reconcileBackupPreferences(migrated, device)).toBe(migrated);
  const adopted = reconcileBackupPreferences({ ...migrated, backupMode: 'device' }, device);
  expect(adopted.primary).toEqual({ kind: 'local' });
  expect(adopted.backups).toEqual([]);
  expect(adopted.localStorageIdentityKey).toBe(migrated.localStorageIdentityKey);
  expect(missingPreferredBackups(adopted, resolveBackupPreferences(adopted, device))).toEqual([]);
});
