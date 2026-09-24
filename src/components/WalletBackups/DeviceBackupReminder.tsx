import { useState } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import { useNavigate } from 'react-router-dom';
import type { NetworkWalletStorageConfig } from '../../walletStorageConfig';
import {
  BACKUP_REMINDER_DELAY_MS,
  backupReminderKey,
  shouldSuggestDeviceBackup,
} from '../../walletBackupReminder';

export default function DeviceBackupReminder({
  config,
  profile,
  network,
  busy,
}: {
  config: NetworkWalletStorageConfig;
  profile: string;
  network: string;
  busy: boolean;
}) {
  const navigate = useNavigate();
  const key = backupReminderKey(profile, network);
  const [remindAfter, setRemindAfter] = useState(() => {
    try {
      return Number(localStorage.getItem(key));
    } catch {
      return 0;
    }
  });
  if (!shouldSuggestDeviceBackup(config, remindAfter)) return null;
  const remindLater = () => {
    const next = Date.now() + BACKUP_REMINDER_DELAY_MS;
    setRemindAfter(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      /* Still dismiss for this visit when storage is unavailable. */
    }
  };
  return (
    <Paper
      component="section"
      aria-labelledby="device-backup-reminder-title"
      variant="outlined"
      sx={{ mx: 2, mt: 2, p: { xs: 2, sm: 3 }, borderRadius: 3 }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <DevicesOutlinedIcon sx={{ mt: 0.5 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            id="device-backup-reminder-title"
            component="h2"
            variant="h6"
            fontWeight={700}
          >
            Your wallet data, on your device
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Keep a copy you control, so your wallet data does not depend on a single storage
            provider. Setup keeps your current wallet location in place.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
            <Button
              variant="contained"
              disabled={busy || Boolean(config.pendingOperation)}
              sx={{ minHeight: 44, textTransform: 'none' }}
              onClick={() =>
                navigate('/dashboard/settings/backups', { state: { startLocalBackup: true } })
              }
            >
              Set up device backup
            </Button>
            <Button sx={{ minHeight: 44, textTransform: 'none' }} onClick={remindLater}>
              Remind me in a week
            </Button>
          </Stack>
          {(busy || config.pendingOperation) && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Finish the current backup operation before starting device setup.
            </Typography>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}
