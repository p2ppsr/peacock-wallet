import { describe, expect, it } from 'vitest';
import {
  backupLocationLabel,
  backupOperationTitle,
  showBackupNotice,
  backupStatus,
  backupSummary,
  canConfirmBackupChange,
  hasVerifiedBackup,
  primaryChangeBlock,
  validateBackupAddress,
} from './walletBackupPresentation';
import type { WalletStorageProviderStatus } from './walletStorageRuntime';

const saved: WalletStorageProviderStatus = {
  target: { kind: 'local' },
  role: 'backup',
  state: 'backup',
  lastSuccessfulSyncAt: new Date(Date.now() - 1000).toISOString(),
};

const primary: WalletStorageProviderStatus = {
  ...saved,
  role: 'primary',
  state: 'active',
  target: { kind: 'remote', url: 'https://storage.example.com' },
};

describe('backup readiness and plain-language status', () => {
  it('does not equate a connected, incomplete copy with a verified backup', () => {
    const first = { ...saved, lastSuccessfulSyncAt: undefined as string | undefined };
    expect(backupStatus(first).color).toBe('warning');
    expect(backupStatus(first).label).toBe('First backup not finished');
    expect(backupSummary([first])).toContain('not finished');
    expect(primaryChangeBlock(first, false, false, primary)).toContain('Finish the first backup');
  });
  it.each(['', 'not-a-date', '2999-01-01T00:00:00Z'])(
    'rejects an unverified timestamp: %s',
    (lastSuccessfulSyncAt) => {
      expect(hasVerifiedBackup({ ...saved, lastSuccessfulSyncAt })).toBe(false);
    }
  );
  it('shows unavailable/conflicting/error copies as needing attention even after an earlier successful copy', () => {
    for (const provider of [
      { ...saved, state: 'unavailable' as const },
      { ...saved, state: 'conflicting' as const },
      { ...saved, state: 'active' as const },
      { ...saved, error: 'network failure' },
    ]) {
      expect(backupStatus(provider).color).toBe('warning');
      expect(backupSummary([provider])).toContain('needs attention');
      expect(primaryChangeBlock(provider, false, false, primary)).toBeDefined();
    }
  });
  it('separates the main wallet from extra saved copies', () => {
    const primary = { ...saved, role: 'primary' as const, state: 'active' as const };
    expect(backupStatus(primary).label).toBe('In use');
    expect(backupSummary([primary])).toContain('Add a backup');
    expect(backupSummary([primary, saved])).toBe('You have one saved backup.');
  });
  it('distinguishes providers hosted at different paths', () => {
    expect(
      backupLocationLabel({ kind: 'remote', url: 'https://storage.example.com/wallet-a' })
    ).not.toBe(
      backupLocationLabel({ kind: 'remote', url: 'https://storage.example.com/wallet-b' })
    );
    expect(backupLocationLabel({ kind: 'local' })).toBe('This device');
  });
});

describe('safeguards on final confirmation', () => {
  const valid = {
    kind: 'primary' as const,
    provider: saved,
    primary,
    acknowledged: true,
    busy: false,
    pending: false,
  };
  it('does not promote a copy when the current main location cannot be verified', () => {
    expect(
      canConfirmBackupChange({
        ...valid,
        primary: undefined as WalletStorageProviderStatus | undefined,
      })
    ).toBe(false);
    expect(
      canConfirmBackupChange({ ...valid, primary: { ...primary, state: 'unavailable' } })
    ).toBe(false);
    expect(
      canConfirmBackupChange({ ...valid, primary: { ...primary, state: 'conflicting' } })
    ).toBe(false);
  });
  it('does not present an old saved copy as freshly protected', () => {
    const old = {
      ...saved,
      lastSuccessfulSyncAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    };
    expect(backupStatus(old).label).toBe('Time to refresh');
    expect(backupSummary([old])).toContain('needs updating');
    expect(canConfirmBackupChange({ ...valid, provider: old })).toBe(false);
  });
  it('requires explicit acknowledgement and an idle, recovered wallet', () => {
    expect(canConfirmBackupChange(valid)).toBe(true);
    for (const changes of [
      { acknowledged: false },
      { busy: true },
      { pending: true },
      { provider: undefined as WalletStorageProviderStatus | undefined },
      { kind: null as null },
    ]) {
      expect(canConfirmBackupChange({ ...valid, ...changes })).toBe(false);
    }
  });
  it('blocks an unsynced or unavailable primary switch and rechecks a target that became primary', () => {
    for (const provider of [
      { ...saved, lastSuccessfulSyncAt: undefined as string | undefined },
      { ...saved, state: 'unavailable' as const },
      { ...saved, role: 'primary' as const },
    ]) {
      expect(canConfirmBackupChange({ ...valid, provider })).toBe(false);
    }
  });
  it('allows a failed backup to be disconnected with acknowledgement, but never disconnects the main wallet', () => {
    expect(
      canConfirmBackupChange({
        ...valid,
        kind: 'disconnect',
        provider: { ...saved, state: 'unavailable' },
      })
    ).toBe(true);
    expect(canConfirmBackupChange({ ...valid, kind: 'disconnect', acknowledged: false })).toBe(
      false
    );
    expect(
      canConfirmBackupChange({
        ...valid,
        kind: 'disconnect',
        provider: { ...saved, role: 'primary' },
      })
    ).toBe(false);
  });
});

describe('provider setup validation', () => {
  it.each([
    'bad-address',
    'http://storage.example.com',
    'https://user:password@storage.example.com',
    'https://storage.example.com?secret=x',
    'https://storage.example.com#key',
  ])('rejects unsafe or malformed addresses: %s', (input) => {
    expect(validateBackupAddress(input, []).url).toBeUndefined();
    expect(validateBackupAddress(input, []).error).toBeDefined();
  });
  it('normalizes secure addresses and prevents equivalent duplicates including the main location', () => {
    expect(validateBackupAddress(' https://storage.example.com/ ', [])).toEqual({
      url: 'https://storage.example.com',
    });
    expect(
      validateBackupAddress('https://storage.example.com/', [
        { kind: 'remote', url: 'https://storage.example.com' },
      ]).error
    ).toContain('already connected');
  });
});

it('never announces completion while cancellation is pending or after an error', () => {
  expect(backupOperationTitle({ busy: true, cancelRequested: true })).toContain('Finishing');
  expect(backupOperationTitle({ busy: false, cancelled: true })).toBe('Sync stopped safely');
  expect(backupOperationTitle({ busy: false, kind: 'cancel-setup', cancelled: true })).toBe('Sync stopped safely');
  expect(backupOperationTitle({ busy: false, kind: 'cancel-setup' })).toBe('Backup setup cancelled');
  expect(backupOperationTitle({ busy: false, error: 'failure' })).toBe('Backup needs attention');
});

describe('backup notices outside settings', () => {
  it('keeps routine automatic work quiet while showing user-initiated progress', () => {
    expect(showBackupNotice({ busy: true, automatic: true, startedAt: 1 })).toBe(false);
    expect(showBackupNotice({ busy: true, automatic: false, startedAt: 1 })).toBe(true);
    expect(showBackupNotice({ busy: true, startedAt: 1 })).toBe(true);
    expect(showBackupNotice({ busy: false, automatic: true, startedAt: 1 })).toBe(false);
  });
  it('surfaces automatic failures and respects dismissal without hiding later failures', () => {
    const failed = { busy: false, automatic: true, startedAt: 1, error: 'Unavailable' };
    expect(showBackupNotice(failed)).toBe(true);
    expect(showBackupNotice(failed, 1)).toBe(false);
    expect(showBackupNotice({ ...failed, startedAt: 2 }, 1)).toBe(true);
  });
  it('keeps a user-requested stop visible even during an automatic copy', () => {
    expect(showBackupNotice({ busy: false, automatic: true, startedAt: 1, cancelled: true })).toBe(
      true
    );
  });
});

it('describes retry progress without presenting the previous failure as the current result', () => {
  expect(backupSummary([{ ...saved, error: 'previous timeout' }], true)).toContain('Updating your backup copies')
  expect(backupSummary([{ ...saved, error: 'previous timeout' }], false)).toContain('needs attention')
})
