import type { WalletStorageProviderStatus } from './walletStorageRuntime';
import type { WalletStorageOperationState } from './WalletContext';
import {
  normalizeRemoteStorageUrl,
  walletStorageTargetsEqual,
  type WalletStorageTarget,
} from './walletStorageConfig';

export const backupLocationLabel = (target: WalletStorageTarget): string =>
  target.kind === 'local'
    ? 'This device'
    : `${new URL(target.url).host}${new URL(target.url).pathname.replace(/\/$/, '')}`;

export function hasVerifiedBackup(provider: WalletStorageProviderStatus): boolean {
  const time = Date.parse(provider.lastSuccessfulSyncAt ?? '');
  return Number.isFinite(time) && time > 0 && time <= Date.now();
}

export function backupNeedsRefresh(provider: WalletStorageProviderStatus): boolean {
  return (
    hasVerifiedBackup(provider) &&
    Date.now() - Date.parse(provider.lastSuccessfulSyncAt!) >= 24 * 60 * 60 * 1000
  );
}

export function backupStatus(provider: WalletStorageProviderStatus): {
  label: string;
  color: 'success' | 'warning' | 'default';
  description: string;
} {
  if (provider.state === 'unavailable')
    return {
      label: 'Cannot connect',
      color: 'warning',
      description:
        'We will try again automatically while the app is open. Previously saved data stays where it is.',
    };
  if (
    provider.error ||
    (provider.role === 'primary' ? provider.state !== 'active' : provider.state !== 'backup')
  )
    return {
      label: 'Needs attention',
      color: 'warning',
      description:
        'We could not finish checking this location. Try syncing again before relying on this copy.',
    };
  if (provider.role === 'primary')
    return {
      label: 'In use',
      color: 'default',
      description: 'Your wallet saves new activity here first.',
    };
  if (!hasVerifiedBackup(provider))
    return {
      label: 'First backup not finished',
      color: 'warning',
      description: 'Keep the app open to finish saving your first copy.',
    };
  if (backupNeedsRefresh(provider))
    return {
      label: 'Time to refresh',
      color: 'warning',
      description:
        'This copy has not been refreshed in a day or more. Sync now to check for new activity.',
    };
  return {
    label: 'Backup saved',
    color: 'success',
    description:
      'A copy was saved at the time shown below. New activity will be copied automatically while the app is open.',
  };
}

export function backupSummary(providers: WalletStorageProviderStatus[], busy = false): string {
  if (busy) return 'Updating your backup copies. Any previous warnings will be checked again as each location finishes.';
  const backups = providers.filter((provider) => provider.role === 'backup');
  if (!backups.length) return 'Add a backup to keep an extra copy of your wallet data.';
  if (backups.some((provider) => provider.state !== 'backup' || provider.error)) {
    return 'A backup needs attention. Your last saved copies have not been removed.';
  }
  if (backups.some((provider) => !hasVerifiedBackup(provider)))
    return 'Your first backup is not finished yet.';
  if (backups.some(backupNeedsRefresh))
    return 'A saved copy needs updating. Sync now to check for changes.';
  return backups.length === 1
    ? 'You have one saved backup.'
    : `You have ${backups.length} saved backups.`;
}

export function primaryChangeBlock(
  provider: WalletStorageProviderStatus | undefined,
  busy: boolean,
  pending: boolean,
  primary: WalletStorageProviderStatus | undefined
): string | undefined {
  if (busy) return 'Wait for the current operation to finish.';
  if (pending) return 'Finish recovering the interrupted setup first.';
  if (primary?.role !== 'primary' || primary.state !== 'active' || primary.error)
    return 'Reconnect to your current main wallet location before switching.';
  if (!provider || provider.role !== 'backup') return 'Choose an existing backup.';
  if (provider.state !== 'backup' || provider.error) return 'Reconnect and sync this backup first.';
  if (!hasVerifiedBackup(provider)) return 'Finish the first backup before using this location.';
  if (backupNeedsRefresh(provider))
    return 'Refresh this backup before using it as your main location.';
  return undefined;
}

/** Validate before closing setup, so a typo never loses the user's input. */
export function validateBackupAddress(
  value: string,
  existing: WalletStorageTarget[]
): { url?: string; error?: string } {
  try {
    const url = normalizeRemoteStorageUrl(value);
    if (existing.some((target) => walletStorageTargetsEqual(target, { kind: 'remote', url }))) {
      return { error: 'This location is already connected to your wallet.' };
    }
    return { url };
  } catch {
    return {
      error:
        'Enter a secure wallet-storage address, such as https://storage.example.com. Do not include a password, query, or # fragment.',
    };
  }
}

export function backupOperationTitle(
  operation: Pick<
    WalletStorageOperationState,
    'kind' | 'busy' | 'cancelRequested' | 'cancelled' | 'error'
  >
): string {
  if (operation.busy && operation.cancelRequested) return 'Finishing the current step…';
  if (operation.busy) {
    if (operation.kind === 'portable-data') return 'Preparing portable wallet data…';
    if (operation.kind === 'cancel-setup') return 'Restoring your main wallet connection…';
    if (operation.kind === 'set-primary') return 'Changing your main wallet location…';
    if (operation.kind === 'remove-backup') return 'Disconnecting your backup…';
    if (operation.kind === 'local-benchmark') return 'Running a sync diagnostic…';
    return 'Saving your wallet backup…';
  }
  if (operation.kind === 'portable-data') return operation.cancelled ? 'Wallet data operation stopped' : operation.error ? 'Wallet data needs attention' : 'Wallet data operation finished';
  if (operation.cancelled) return 'Sync stopped safely';
  if (!operation.error && operation.kind === 'cancel-setup') return 'Backup setup cancelled';
  if (operation.error) return 'Backup needs attention';
  if (operation.kind === 'set-primary') return 'Main wallet location changed';
  if (operation.kind === 'remove-backup') return 'Backup disconnected';
  if (operation.kind === 'local-benchmark') return 'Sync diagnostic finished';
  return 'Backup sync finished';
}

/** Re-check every condition on submission as well as disabling the button. */
export function canConfirmBackupChange(options: {
  kind: 'disconnect' | 'primary' | null;
  provider?: WalletStorageProviderStatus;
  primary?: WalletStorageProviderStatus;
  acknowledged: boolean;
  busy: boolean;
  pending: boolean;
}): boolean {
  const { kind, provider, primary, acknowledged, busy, pending } = options;
  if (!kind || !acknowledged || busy || pending || provider?.role !== 'backup') return false;
  return kind === 'disconnect' || !primaryChangeBlock(provider, busy, pending, primary);
}

/** Routine scheduled sync stays quiet outside the Backups page; failures remain visible. */
export function showBackupNotice(
  operation: Pick<
    WalletStorageOperationState,
    'busy' | 'automatic' | 'error' | 'cancelled' | 'startedAt'
  >,
  dismissedAt?: number
): boolean {
  if (operation.busy) return !operation.automatic;
  return Boolean(operation.error || operation.cancelled) && dismissedAt !== operation.startedAt;
}
