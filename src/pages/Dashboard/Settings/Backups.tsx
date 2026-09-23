import BackupPreferences from '../../../components/WalletBackups/BackupPreferences'
import WalletDataPortability from '../../../components/WalletBackups/WalletDataPortability'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
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
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { WalletContext, type WalletContextValue } from '../../../WalletContext';
import {
  canConfirmBackupChange,
  backupLocationLabel,
  backupStatus,
  backupSummary,
  primaryChangeBlock,
  validateBackupAddress,
} from '../../../walletBackupPresentation';
import { walletStorageTargetsEqual, type WalletStorageTarget } from '../../../walletStorageConfig';
import BackupActivity from '../../../components/WalletBackups/BackupActivity';
import { DEFAULT_STORAGE_URL } from '../../../config';

export type BackupSettingsProps = Pick<
  WalletContextValue,
  | 'storageConfig'
  | 'storageProviders'
  | 'storageOperation'
  | 'addBackupStorage'
  | 'removeBackupStorage'
  | 'setPrimaryStorage'
  | 'syncBackupStorage'
  | 'cancelStorageOperation'
  | 'cancelBackupSetup'
  | 'network'
> & { startWithLocalSetup?: boolean; sharedBackupRules?: boolean; automaticBackups?: boolean; profileName?: string; preferences?: ReactNode };

const actionStyle = { minHeight: 44, textTransform: 'none' } as const;

export function BackupSettingsView({
  storageConfig,
  storageProviders,
  storageOperation,
  addBackupStorage,
  removeBackupStorage,
  setPrimaryStorage,
  syncBackupStorage,
  cancelStorageOperation,
  cancelBackupSetup,
  network,
  startWithLocalSetup = false,
  sharedBackupRules = false,
  automaticBackups = true,
  profileName = 'Current profile',
  preferences,
}: BackupSettingsProps) {
  const [setup, setSetup] = useState<'local' | 'remote' | null>(() =>
    startWithLocalSetup && !sharedBackupRules &&
    !storageOperation.busy &&
    !storageConfig.pendingOperation &&
    ![storageConfig.primary, ...storageConfig.backups].some((target) => target.kind === 'local')
      ? 'local'
      : null
  );
  const [providerChoice, setProviderChoice] = useState<'default' | 'custom'>('custom');
  const [address, setAddress] = useState('');
  const addressInput = useRef<HTMLInputElement>(null);
  const setupCancel = useRef<HTMLButtonElement>(null);
  const [addressTouched, setAddressTouched] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submissionRef = useRef(false);
  const [actionError, setActionError] = useState(false);
  const [cancelSetupOpen, setCancelSetupOpen] = useState(false);
  const [manage, setManage] = useState<WalletStorageTarget | null>(null);
  const [confirmation, setConfirmation] = useState<'disconnect' | 'primary' | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const manageCancel = useRef<HTMLButtonElement>(null);
  const confirmTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (confirmation) confirmTitle.current?.focus();
  }, [confirmation]);
  const busy = storageOperation.busy || submitting;
  const pending = storageConfig.pendingOperation;
  const locked = busy || Boolean(pending);
  const backups = storageProviders.filter((provider) => provider.role === 'backup');
  const primary = storageProviders.find((provider) => provider.role === 'primary');
  const configured = [storageConfig.primary, ...storageConfig.backups];
  const hasLocal = configured.some((target) => target.kind === 'local');
  const defaultConnected = configured.some((target) =>
    walletStorageTargetsEqual(target, { kind: 'remote', url: DEFAULT_STORAGE_URL })
  );
  const validation = validateBackupAddress(address, configured);
  const managed = manage
    ? storageProviders.find((provider) => walletStorageTargetsEqual(provider.target, manage))
    : undefined;
  const changeBlocked = primaryChangeBlock(managed, busy, Boolean(pending), primary);
  const lastBackup = storageConfig.backups.length === 1;
  const canConfirm = canConfirmBackupChange({
    kind: confirmation,
    provider: managed,
    primary,
    acknowledged,
    busy,
    pending: Boolean(pending),
  });

  const perform = async (action: () => Promise<void>) => {
    if (busy || submissionRef.current) return;
    submissionRef.current = true;
    setSubmitting(true);
    setActionError(false);
    try {
      await action();
    } catch {
      setActionError(true);
    } finally {
      submissionRef.current = false;
      setSubmitting(false);
    }
  };
  const openSetup = (kind: 'local' | 'remote') => {
    setSetup(kind);
    setAddressTouched(false);
    setTrusted(false);
    if (kind === 'remote') {
      const useDefault = network === 'mainnet' && !defaultConnected;
      setProviderChoice(useDefault ? 'default' : 'custom');
      setAddress(useDefault ? DEFAULT_STORAGE_URL : '');
    }
  };
  const closeManage = () => {
    setManage(null);
    setConfirmation(null);
    setAcknowledged(false);
  };
  const addBackup = () => {
    if (locked || !setup || (setup === 'remote' && (!validation.url || !trusted))) return;
    const target: WalletStorageTarget =
      setup === 'local' ? { kind: 'local' } : { kind: 'remote', url: validation.url! };
    setSetup(null);
    void perform(() => addBackupStorage(target));
  };
  const confirmChange = () => {
    if (!canConfirm || !manage) return;
    const target = manage;
    const action = confirmation;
    if (!action) return;
    closeManage();
    void perform(() =>
      action === 'disconnect' ? removeBackupStorage(target) : setPrimaryStorage(target)
    );
  };

  return (
    <Box
      sx={{
        maxWidth: 1120,
        bgcolor: 'background.default',
        color: 'text.primary',
        borderRadius: 3,
        mx: 'auto',
        px: { xs: 2, md: 3 },
        py: 3,
        '& .MuiButton-root': actionStyle,
      }}
    >
      <Button
        component={RouterLink}
        to="/dashboard/settings"
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 2 }}
      >
        Settings
      </Button>
      <Typography component="h1" variant="h3" sx={{ fontWeight: 700, mb: 1 }}>
        Backups
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {profileName}: manage copies of this profile’s wallet data. Other profiles have their own data and copies; select each profile separately to back it up.
      </Typography>
      {preferences}
      {sharedBackupRules && <Alert severity="info" sx={{ mb: 2 }}>Backup locations follow device defaults above. Choose independent settings to change locations only for this profile. Its main wallet location remains profile-specific.</Alert>}
      {network === 'testnet' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          These backups belong to your test wallet.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3, borderRadius: 3 }}>
        <Stack spacing={2}>
          <Box>
            <Typography component="h2" variant="h5" fontWeight={700}>
              Your backup overview
            </Typography>
            <Typography sx={{ mt: 1 }}>{backupSummary(storageProviders, busy)}</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {automaticBackups ? 'Peacock checks this profile for changes every five minutes while it is open, and tries again when your connection returns.' : 'Automatic sync is off for this profile. Choose Sync now to update connected copies.'}
          </Typography>
          <BackupActivity operation={storageOperation} onStop={cancelStorageOperation} />
          {actionError && !storageOperation.error && !storageOperation.cancelled && (
            <Alert severity="warning">
              The action could not finish. Check your connection and try again.
            </Alert>
          )}
          {pending && !busy && (
            <Alert severity="warning">
              <Typography fontWeight={700}>An interrupted setup needs to finish</Typography>
              <Typography variant="body2">
                {pending.kind === 'add-backup'
                  ? `Setup for ${backupLocationLabel(pending.target)} did not finish. Resume checks saved checkpoints; earlier stages may be checked again without discarding completed pages. You can also cancel setup and choose another backup.`
                  : 'Close and reopen Peacock to safely recover the last saved wallet location before making more changes.'}
              </Typography>
              {pending.kind === 'add-backup' && (
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  <Button disabled={busy} onClick={() => void perform(() => addBackupStorage(pending.target))}>
                    Resume setup
                  </Button>
                  <Button disabled={busy} onClick={() => setCancelSetupOpen(true)}>
                    Cancel setup
                  </Button>
                </Stack>
              )}
            </Alert>
          )}
          {storageConfig.backups.length > 0 && (
            <Box>
              <Button
                variant="contained"
                disabled={locked}
                onClick={() => void perform(() => syncBackupStorage())}
              >
                {busy
                  ? 'Sync in progress'
                  : storageOperation.error || storageOperation.cancelled
                    ? 'Try sync again'
                    : 'Sync now'}
              </Button>
            </Box>
          )}
        </Stack>
      </Paper>

      <Typography component="h2" variant="h5" fontWeight={700} sx={{ mb: 2 }}>
        Your backup copies
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
          gap: 2,
        }}
      >
        {backups.map((provider) => {
          const status = backupStatus(provider);
          const label = backupLocationLabel(provider.target);
          const validTime = Date.parse(provider.lastSuccessfulSyncAt ?? '');
          return (
            <Paper
              component="section"
              aria-label={`${label} backup`}
              key={provider.target.kind === 'local' ? 'local' : provider.target.url}
              variant="outlined"
              sx={{ p: 2, borderRadius: 3, minWidth: 0, display: 'flex', flexDirection: 'column' }}
            >
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                {provider.target.kind === 'local' ? (
                  <DevicesOutlinedIcon sx={{ mt: 0.5 }} />
                ) : (
                  <CloudDoneOutlinedIcon sx={{ mt: 0.5 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography component="h3" variant="h6" sx={{ overflowWrap: 'anywhere' }}>
                    {label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {provider.target.kind === 'local' ? 'Device copy' : 'Remote provider'}
                  </Typography>
                </Box>
              </Stack>
              <Chip
                label={status.label}
                color={status.color}
                variant="outlined"
                size="small"
                sx={{ my: 1.5, alignSelf: 'flex-start', maxWidth: '100%', color: 'text.primary' }}
              />
              {status.color === 'warning' && (
                <Typography variant="body2">{status.description}</Typography>
              )}
              {Number.isFinite(validTime) && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Last successful backup:
                  <Box
                    component="time"
                    dateTime={provider.lastSuccessfulSyncAt}
                    sx={{ display: 'block' }}
                  >
                    {new Date(validTime).toLocaleString()}
                  </Box>
                </Typography>
              )}
              <Box sx={{ mt: 'auto', pt: 1 }}>
                <Button
                  variant="text"
                  aria-label={`Manage backup on ${label}`}
                  disabled={locked}
                  onClick={() => {
                    setManage(provider.target);
                    setConfirmation(null);
                    setAcknowledged(false);
                  }}
                >
                  Manage backup
                </Button>
              </Box>
            </Paper>
          );
        })}
        {!backups.length && (
          <Typography color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
            No extra copy is connected yet. Choose where to keep your first backup below.
          </Typography>
        )}
      </Box>

      {!sharedBackupRules && (
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, my: 3, borderRadius: 3 }}>
        <Typography component="h2" variant="h5" fontWeight={700} sx={{ mb: 1 }}>
          Add a backup
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Adding a copy keeps your current wallet location in place.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {!hasLocal && (
            <Button
              startIcon={<DevicesOutlinedIcon />}
              variant="contained"
              disabled={locked}
              onClick={() => openSetup('local')}
            >
              Keep a copy on this device
            </Button>
          )}
          <Button
            startIcon={<CloudDoneOutlinedIcon />}
            variant="outlined"
            disabled={locked}
            onClick={() => openSetup('remote')}
          >
            Use another provider
          </Button>
        </Stack>
        {hasLocal && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            This device is already connected to your wallet.
          </Typography>
        )}
      </Paper>
      )}

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3, borderRadius: 3 }}>
        <Typography component="h2" variant="h6" fontWeight={700}>
          Keep access to your wallet, too
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          A data backup does not replace your recovery key. Keep your recovery key somewhere safe,
          separate from this device.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          A device copy can be lost if you clear the app’s data, uninstall Peacock, or lose the
          device. Keep another copy with a trusted provider.
        </Typography>
        <Button component={RouterLink} to="/dashboard/settings" sx={{ mt: 1 }}>
          Review account recovery
        </Button>
      </Paper>

      <Accordion
        elevation={0}
        disableGutters
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          '&:before': { display: 'none' },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          id="wallet-location-heading"
          aria-controls="wallet-location-details"
        >
          <Typography component="h2" variant="subtitle1">
            Where your wallet saves new activity
          </Typography>
        </AccordionSummary>
        <AccordionDetails id="wallet-location-details">
          <Typography sx={{ overflowWrap: 'anywhere' }}>
            {backupLocationLabel(storageConfig.primary)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
            This is your main wallet location. New activity is saved here first, then copied to your
            backups. You do not need to change it to use backups.
          </Typography>
          {primary && (
            <Chip
              size="small"
              label={backupStatus(primary).label}
              color={backupStatus(primary).color}
            />
          )}
          {storageConfig.primary.kind === 'remote' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Your current setup needs a connection to this provider. Adding a device backup alone
              does not switch the wallet to offline operation.
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>

      <Dialog open={cancelSetupOpen} onClose={() => !busy && setCancelSetupOpen(false)}
        aria-labelledby="cancel-backup-setup-title" aria-describedby="cancel-backup-setup-description"
        sx={{ '& .MuiButton-root': actionStyle }}>
        <DialogTitle id="cancel-backup-setup-title">Cancel this backup setup?</DialogTitle>
        <DialogContent>
          <Typography id="cancel-backup-setup-description">
            Your main wallet and existing backups stay in place. Any data already copied to this
            location is kept. You can reconnect it later, or set up a different backup.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button autoFocus disabled={busy} onClick={() => setCancelSetupOpen(false)}>Keep setup</Button>
          <Button disabled={busy || pending?.kind !== 'add-backup'} onClick={() => {
            setCancelSetupOpen(false);
            void perform(cancelBackupSetup);
          }}>Cancel setup</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={setup != null}
        onClose={() => !busy && setSetup(null)}
        fullWidth
        maxWidth="sm"
        sx={{ '& .MuiButton-root': actionStyle, '& .MuiFormControlLabel-root': { minHeight: 44 } }}
        aria-labelledby="backup-setup-title"
        aria-describedby="backup-setup-description"
        slotProps={{
          transition: {
            onEntered: () =>
              (setup === 'remote' && providerChoice === 'custom'
                ? addressInput.current
                : setupCancel.current
              )?.focus(),
          },
        }}
      >
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            setAddressTouched(true);
            addBackup();
          }}
        >
          <DialogTitle id="backup-setup-title">
            {setup === 'local' ? 'Keep a copy on this device' : 'Connect a backup provider'}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography id="backup-setup-description">
                {setup === 'local'
                  ? 'Peacock will copy your wallet data to this device and keep it updated while the app is open. Your current wallet location stays the same.'
                  : 'Choose where to keep your extra copy. Only connect to a provider you trust with your wallet data.'}
              </Typography>
              {setup === 'local' ? (
                <Alert severity="info">
                  Keep Peacock open for the first copy. Large wallets can take several minutes or
                  longer. You can leave this page. Wallet reads and writes may wait for the copy;
                  use Stop this sync when you need the wallet. Completed pages stay saved.
                </Alert>
              ) : (
                <>
                  {network === 'mainnet' && (
                    <>
                      <RadioGroup
                        aria-label="Backup provider"
                        value={providerChoice}
                        onChange={(event) => {
                          const choice = event.target.value as 'default' | 'custom';
                          setProviderChoice(choice);
                          setAddress(choice === 'default' ? DEFAULT_STORAGE_URL : '');
                          setTrusted(false);
                          setAddressTouched(false);
                        }}
                      >
                        <FormControlLabel
                          value="default"
                          disabled={defaultConnected || busy}
                          control={<Radio />}
                          label="Babbage — default provider"
                        />
                        <FormControlLabel
                          value="custom"
                          disabled={busy}
                          control={<Radio />}
                          label="Another provider"
                        />
                      </RadioGroup>
                      {defaultConnected && (
                        <Typography variant="body2">
                          Babbage is already connected to this wallet. You do not need to add it
                          again.
                        </Typography>
                      )}
                    </>
                  )}
                  {providerChoice === 'custom' && (
                    <TextField
                      inputRef={addressInput}
                      required
                      fullWidth
                      label="Provider address"
                      placeholder="https://storage.example.com"
                      type="url"
                      value={address}
                      disabled={busy}
                      onBlur={() => setAddressTouched(true)}
                      onChange={(event) => {
                        setAddress(event.target.value);
                        setTrusted(false);
                      }}
                      error={addressTouched && Boolean(address.trim()) && Boolean(validation.error)}
                      helperText={
                        addressTouched && address.trim() && validation.error
                          ? validation.error
                          : 'Only a wallet-storage provider can be used here.'
                      }
                      slotProps={{
                        htmlInput: {
                          spellCheck: false,
                          autoCapitalize: 'none',
                          autoComplete: 'off',
                        },
                      }}
                    />
                  )}
                  {validation.url && (
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      Backup destination: {validation.url}
                    </Typography>
                  )}
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={trusted}
                        disabled={busy}
                        onChange={(event) => setTrusted(event.target.checked)}
                      />
                    }
                    label="I trust this provider to store my wallet transaction and account data."
                  />
                </>
              )}
              <Typography variant="body2" color="text.secondary">
                {setup === 'local'
                  ? 'This copy is stored inside the app. It is not a recovery-key export or protection against losing this device.'
                  : 'Your chosen provider will receive wallet data when you start. Your current wallet location will stay the same.'}
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}>
            <Button ref={setupCancel} disabled={busy} onClick={() => setSetup(null)}>
              Not now
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={locked || (setup === 'remote' && (!validation.url || !trusted))}
            >
              Start backup
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={manage != null}
        onClose={() => !busy && closeManage()}
        fullWidth
        maxWidth="sm"
        sx={{ '& .MuiButton-root': actionStyle, '& .MuiFormControlLabel-root': { minHeight: 44 } }}
        aria-labelledby="backup-manage-title"
        aria-describedby="backup-manage-description"
        slotProps={{ transition: { onEntered: () => manageCancel.current?.focus() } }}
      >
        <DialogTitle id="backup-manage-title" ref={confirmTitle} tabIndex={-1}>
          {confirmation === 'disconnect'
            ? 'Stop backing up to this location?'
            : confirmation === 'primary'
              ? 'Change your main wallet location?'
              : 'Manage backup'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
              {manage && backupLocationLabel(manage)}
            </Typography>
            {manage?.kind === 'remote' && (
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {manage.url}
              </Typography>
            )}
            <Typography id="backup-manage-description">
              {confirmation === 'disconnect'
                ? 'This stops future backups to this location. The saved copy stays there; no wallet data is deleted. Peacock will try one final sync, then reconnect your wallet without this backup, even if that sync fails.'
                : confirmation === 'primary'
                  ? 'New wallet activity for this profile will be saved here first. Peacock will sync connected locations before switching and keep the previous main location as a backup. This profile will use independent backup settings; other profiles are unchanged.'
                  : 'Your saved data stays in place if you disconnect. To copy the latest changes, close this dialog and choose Sync now.'}
            </Typography>
            {confirmation === 'disconnect' && lastBackup && (
              <Alert severity="warning">
                This is your only connected backup. After disconnecting, new activity will have no
                extra backup until you add another.
              </Alert>
            )}
            {confirmation === 'primary' && (
              <Alert severity="warning">
                {manage?.kind === 'local'
                  ? 'This device will hold your main wallet data. Keep another backup and your recovery key safe before clearing app data or changing devices.'
                  : 'Your wallet will need a connection to this provider to save new activity.'}
              </Alert>
            )}
            {confirmation ? (
              <>
                {confirmation === 'primary' && changeBlocked && (
                  <Alert severity="warning">{changeBlocked}</Alert>
                )}
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={acknowledged}
                      disabled={locked}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                    />
                  }
                  label={
                    confirmation === 'disconnect'
                      ? 'I understand that new activity will no longer be backed up here.'
                      : 'I understand where new wallet activity will be saved.'
                  }
                />
              </>
            ) : (
              <>
                <Button
                  variant="outlined"
                  disabled={locked || sharedBackupRules}
                  onClick={() => {
                    setConfirmation('disconnect');
                    setAcknowledged(false);
                  }}
                >
                  Disconnect this backup…
                </Button>
                <Accordion elevation={0} disableGutters>
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    id="change-location-heading"
                    aria-controls="change-location-options"
                  >
                    Change main wallet location
                  </AccordionSummary>
                  <AccordionDetails id="change-location-options">
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      Only change this if you want the wallet to save new activity here first. It is
                      not needed for backups.
                    </Typography>
                    {changeBlocked && (
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        {changeBlocked}
                      </Typography>
                    )}
                    <Button
                      variant="outlined"
                      disabled={Boolean(changeBlocked)}
                      onClick={() => {
                        setConfirmation('primary');
                        setAcknowledged(false);
                      }}
                    >
                      Use as main wallet location…
                    </Button>
                  </AccordionDetails>
                </Accordion>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button ref={manageCancel} disabled={busy} onClick={closeManage}>
            {confirmation ? 'Keep current setup' : 'Done'}
          </Button>
          {confirmation && (
            <Button variant="contained" disabled={!canConfirm} onClick={confirmChange}>
              {confirmation === 'disconnect' ? 'Disconnect backup' : 'Change main location'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default function Backups() {
  const wallet = useContext(WalletContext);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.state?.startLocalBackup)
      navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);
  return (
    <><BackupSettingsView
      {...wallet}
      sharedBackupRules={wallet.backupPreferences.mode === 'device'}
      automaticBackups={wallet.backupPreferences.automatic}
      profileName={wallet.activeProfile?.name || 'Current profile'}
      preferences={<BackupPreferences />}
      key={`${String(wallet.activeProfile?.id ?? 'wallet')}:${wallet.network}`}
      startWithLocalSetup={location.state?.startLocalBackup === true}
    /><WalletDataPortability key={`data:${String(wallet.activeProfile?.id ?? 'wallet')}:${wallet.network}`} /></>
  );
}
