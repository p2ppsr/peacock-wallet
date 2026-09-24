import { useContext, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { WalletContext } from '../../WalletContext';
import {
  normalizeBackupPreferences,
  missingPreferredBackups,
} from '../../walletStoragePreferences';
import { backupLocationLabel } from '../../walletBackupPresentation';
import { walletStorageTargetId, type WalletStorageTarget } from '../../walletStorageConfig';

export default function BackupPreferences() {
  const wallet = useContext(WalletContext);
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState<'device' | 'profile'>('device');
  const [local, setLocal] = useState(true),
    [automatic, setAutomatic] = useState(true),
    [remotes, setRemotes] = useState('');
  const [ack, setAck] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const busy = wallet.storageOperation.busy || saving || !!wallet.storageConfig.pendingOperation;
  const profile = wallet.activeProfile?.name || 'Current profile';
  const shared = wallet.backupPreferences.mode === 'device';
  const missing = missingPreferredBackups(wallet.storageConfig, wallet.backupPreferences);
  const edit = () => {
    setMode(wallet.backupPreferences.mode);
    setLocal(wallet.deviceBackupPreferences.backups.some((target) => target.kind === 'local'));
    setRemotes(
      wallet.deviceBackupPreferences.backups
        .filter((target) => target.kind === 'remote')
        .map((target) => (target.kind === 'remote' ? target.url : ''))
        .join('\n')
    );
    setAutomatic(wallet.backupPreferences.automatic);
    setAck(false);
    setError('');
    setOpen(true);
  };
  let targets: WalletStorageTarget[] = [],
    invalid = false;
  try {
    targets = normalizeBackupPreferences({
      automatic,
      backups: [
        ...(local ? [{ kind: 'local' } as const] : []),
        ...remotes
          .split('\n')
          .map((url) => url.trim())
          .filter(Boolean)
          .map((url) => ({ kind: 'remote' as const, url })),
      ],
    }).backups;
  } catch {
    invalid = true;
  }
  const wanted = new Set(targets.map(walletStorageTargetId));
  const disconnected =
    mode === 'device'
      ? wallet.storageConfig.backups.filter((target) => !wanted.has(walletStorageTargetId(target)))
      : [];
  const save = async () => {
    if (busy || invalid || (mode === 'device' && !ack)) return;
    setSaving(true);
    setError('');
    try {
      await wallet.saveBackupPreferences(mode, { backups: targets, automatic });
    } catch {
      setError(
        'The preferences could not be saved. Existing wallet data is intact. Restart to recover the current settings.'
      );
      setSaving(false);
    }
  };
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, my: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="h6" component="h2">
          Backup preferences
        </Typography>
        <Typography variant="body2">
          <strong>{profile}</strong> · {wallet.environment.chain === 'ttn' ? 'TerraTestNet' : 'Mainnet'} ·{' '}
          {shared ? 'Using device defaults' : 'Independent profile settings'}
        </Typography>
        <Typography variant="body2">
          Each profile has its own wallet data and backup copies. Device defaults share the choice
          of backup locations and automatic sync—not wallet data, keys, checkpoints or the main
          location.
        </Typography>
        <Typography variant="body2">
          {shared
            ? `Shared locations: ${wallet.deviceBackupPreferences.backups.map(backupLocationLabel).join(', ') || 'None'}.`
            : 'Changes to this profile’s backup locations do not affect other profiles. Existing setups are preserved; you can adopt device defaults below.'}{' '}
          Automatic sync is {wallet.backupPreferences.automatic ? 'on' : 'off'}.
        </Typography>
        <Button sx={{ alignSelf: 'flex-start' }} variant="outlined" disabled={busy} onClick={edit}>
          Change backup preferences
        </Button>
        {missing.length > 0 && (
          <Alert severity="info">
            {missing.length} preferred backup {missing.length === 1 ? 'needs' : 'need'} setup for
            this profile.{' '}
            {wallet.backupPreferences.automatic
              ? 'Setup starts automatically while this profile is open.'
              : 'Automatic sync is off.'}
            <Button
              disabled={busy}
              onClick={() =>
                void wallet
                  .setUpPreferredBackup()
                  .catch(() =>
                    setError(
                      'Backup setup did not finish. Review its activity and resume when ready.'
                    )
                  )
              }
            >
              Set up next copy
            </Button>
          </Alert>
        )}
        {error && !open && <Alert severity="warning">{error}</Alert>}
      </Stack>
      <Dialog
        open={open}
        onClose={busy ? undefined : () => setOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="backup-preferences-title"
      >
        <DialogTitle id="backup-preferences-title">Backup preferences for {profile}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <RadioGroup
              value={mode}
              onChange={(_, value) => {
                setMode(value as 'device' | 'profile');
                setAutomatic(
                  value === 'device'
                    ? wallet.deviceBackupPreferences.automatic
                    : wallet.backupPreferences.automatic
                );
                setAck(false);
              }}
            >
              <FormControlLabel
                disabled={busy}
                value="device"
                control={<Radio />}
                label="Use device defaults (recommended for new profiles)"
              />
              <FormControlLabel
                disabled={busy}
                value="profile"
                control={<Radio />}
                label="Use independent settings for this profile"
              />
            </RadioGroup>
            {mode === 'device' ? (
              <>
                <Alert severity="info">
                  These defaults apply to every participating{' '}
                  {wallet.environment.chain === 'ttn' ? 'TerraTestNet' : 'Mainnet'} profile on this device when
                  opened. New profiles use them by default. Each profile connects with its own
                  identity and keeps separate copies. A provider receives data for each profile
                  using it.
                </Alert>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={local}
                      disabled={busy}
                      onChange={(_, value) => {
                        setLocal(value);
                        setAck(false);
                      }}
                    />
                  }
                  label="Keep a copy on this device"
                />
                <TextField
                  multiline
                  minRows={2}
                  label="Shared remote backup providers"
                  placeholder="https://provider.example"
                  value={remotes}
                  disabled={busy}
                  onChange={(e) => {
                    setRemotes(e.target.value);
                    setAck(false);
                  }}
                  error={invalid}
                  helperText={
                    invalid
                      ? 'Use one valid HTTPS provider URL per line, without credentials or query parameters.'
                      : 'Optional. One URL per line. Only add providers you trust with data from these profiles.'
                  }
                />
                {disconnected.length > 0 && (
                  <Alert severity="warning">
                    This profile will disconnect: {disconnected.map(backupLocationLabel).join(', ')}
                    . Existing copies remain at those locations.
                  </Alert>
                )}
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={ack}
                      disabled={busy}
                      onChange={(_, value) => setAck(value)}
                    />
                  }
                  label="Apply these backup destinations to profiles using device defaults. I trust the listed providers."
                />
              </>
            ) : (
              <Typography variant="body2">
                This profile keeps its current locations. Manage them below after saving. Device
                defaults and other profiles are unchanged.
              </Typography>
            )}
            <FormControlLabel
              control={
                <Checkbox
                  checked={automatic}
                  disabled={busy}
                  onChange={(_, value) => setAutomatic(value)}
                />
              }
              label="Automatically set up preferred copies and sync every five minutes while the profile is open"
            />
            <Typography variant="body2">
              The main wallet location always remains specific to each profile. Saving restarts this
              profile to apply the provider connections safely. No wallet records are deleted.
            </Typography>
            {error && <Alert severity="warning">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={busy || (mode === 'device' && (invalid || !ack))}
            onClick={save}
          >
            Save and restart
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
