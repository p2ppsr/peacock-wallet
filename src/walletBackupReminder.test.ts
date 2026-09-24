import { describe, expect, it } from 'vitest';
import {
  backupReminderKey,
  BACKUP_REMINDER_DELAY_MS,
  shouldSuggestDeviceBackup,
} from './walletBackupReminder';
import type { NetworkWalletStorageConfig } from './walletStorageConfig';

const config: NetworkWalletStorageConfig = {
  revision: 1,
  primary: { kind: 'remote', url: 'https://storage.example.com' },
  backups: [],
  localStorageIdentityKey: 'synthetic',
  lastSuccessfulSyncAt: {},
  updatedAt: '2026-01-01T00:00:00Z',
};
const now = Date.parse('2026-01-02T00:00:00Z');

describe('device backup reminder', () => {
  it('prompts a remote-only wallet without changing its topology', () => {
    const before = JSON.stringify(config);
    expect(shouldSuggestDeviceBackup(config, 0, now)).toBe(true);
    expect(JSON.stringify(config)).toBe(before);
  });
  it('does not prompt for a configured device copy, including one that is currently unavailable or unfinished', () => {
    expect(shouldSuggestDeviceBackup({ ...config, backups: [{ kind: 'local' }] }, 0, now)).toBe(
      false
    );
    expect(shouldSuggestDeviceBackup({ ...config, primary: { kind: 'local' } }, 0, now)).toBe(
      false
    );
    expect(
      shouldSuggestDeviceBackup(
        {
          ...config,
          pendingOperation: {
            id: 'synthetic',
            kind: 'add-backup',
            target: { kind: 'local' },
            startedAt: config.updatedAt,
          },
        },
        0,
        now
      )
    ).toBe(false);
  });
  it('honors a week-long dismissal, expires it, and rejects corrupt/far-future values', () => {
    expect(shouldSuggestDeviceBackup(config, now + BACKUP_REMINDER_DELAY_MS, now)).toBe(false);
    expect(shouldSuggestDeviceBackup(config, now, now)).toBe(true);
    expect(shouldSuggestDeviceBackup(config, Number.NaN, now)).toBe(true);
    expect(shouldSuggestDeviceBackup(config, now + 2 * BACKUP_REMINDER_DELAY_MS, now)).toBe(true);
  });
  it('keeps dismissal separate for each profile and network', () => {
    expect(
      new Set([
        backupReminderKey('a', 'mainnet'),
        backupReminderKey('a', 'testnet'),
        backupReminderKey('b', 'mainnet'),
      ]).size
    ).toBe(3);
  });
});
