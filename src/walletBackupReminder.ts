import type { NetworkWalletStorageConfig } from './walletStorageConfig';

export const BACKUP_REMINDER_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
export const backupReminderKey = (profile: string, network: string): string =>
  `peacock.device-backup-reminder.v1:${encodeURIComponent(profile)}:${network}`;

export function shouldSuggestDeviceBackup(
  config: NetworkWalletStorageConfig,
  remindAfter: number,
  now = Date.now()
): boolean {
  if (
    [config.primary, ...config.backups, config.pendingOperation?.target].some(
      (target) => target?.kind === 'local'
    )
  )
    return false;
  // Invalid or implausibly distant values must not suppress the reminder forever.
  return !(
    Number.isFinite(remindAfter) &&
    remindAfter > now &&
    remindAfter <= now + BACKUP_REMINDER_DELAY_MS
  );
}
