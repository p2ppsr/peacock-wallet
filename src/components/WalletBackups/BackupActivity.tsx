import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { WalletStorageOperationState } from '../../WalletContext';
import { backupOperationTitle, backupLocationLabel } from '../../walletBackupPresentation';
import { liveSyncDisplayProgress } from '../../walletStorageProgress';
import { WALLET_STORAGE_SYNC_PROGRESS_PREFIX } from '../../walletStorageRuntime';

export default function BackupActivity({
  operation,
  onStop,
}: {
  operation: WalletStorageOperationState;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!operation.busy) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [operation.busy]);
  if (!operation.startedAt) return null;
  const progress = operation.syncProgress
    ? liveSyncDisplayProgress(operation.syncProgress, now)
    : undefined;
  const title = backupOperationTitle(operation);
  const details = operation.progress
    .filter((event) => !event.message.startsWith(WALLET_STORAGE_SYNC_PROGRESS_PREFIX))
    .map((event) => event.message)
    .slice(-100)
    .join('\n');
  return (
    <Box component="section" aria-label="Backup activity" sx={{ minWidth: 0 }}>
      <Alert
        severity={
          operation.busy ? 'info' : operation.error || operation.cancelled ? 'warning' : 'success'
        }
        role="status"
        aria-atomic="true"
      >
        <Typography fontWeight={700}>{title}</Typography>
        <Typography variant="body2">
          {operation.busy
            ? 'You can leave this page. Wallet reads and writes may wait until this copy finishes. Stop this sync if you need to use the wallet; completed pages stay saved. Keep Peacock open while copying.'
            : operation.cancelled
              ? operation.kind === 'add-backup' || operation.kind === 'cancel-setup'
                ? 'Data already copied is saved. Resume setup to continue, or cancel setup to choose another backup.'
                : 'Data already copied is saved. Automatic backups will try again while the app is open, or you can sync now.'
              : operation.error
                ? 'Your saved data has not been deleted. This backup has not finished; completed pages stay saved.'
                : operation.kind === 'cancel-setup'
                  ? 'Your wallet is ready. You can choose a different backup; data already copied has been kept.'
                  : 'See each location below for its last successful backup.'}
        </Typography>
        {operation.providerFailure && (
          <Typography variant="body2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
            {backupLocationLabel(operation.providerFailure.target)}: {operation.providerFailure.sourceUpgradeRequired
              ? 'The source provider needs an upgrade to send one of your large wallet records. Contact that provider, then resume setup. Choosing a different backup destination will not fix this source limitation.'
              : operation.providerFailure.proofReconciliationRequired
              ? 'The provider could not verify a transaction’s current confirmation. Try resuming later. If this continues, contact the provider; your saved copies are kept.'
              : operation.providerFailure.timedOut
              ? 'This location did not respond in time. Completed pages stay saved. Try again when connected; if this repeats, contact the provider.'
              : 'This location could not complete the request. Check its connection and try again.'}
          </Typography>
        )}
      </Alert>
      {operation.busy && (
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <LinearProgress
            aria-label="Progress for the current copy"
            variant={progress?.fraction == null ? 'indeterminate' : 'determinate'}
            value={(progress?.fraction ?? 0) * 100}
          />
          <Typography variant="body2">
            {progress
              ? `Copying ${progress.stageName.toLowerCase()} · step ${progress.stageIndex + 1} of ${progress.stageCount}`
              : 'Connecting and checking what needs to be copied…'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The first backup of a large wallet can take a while. Progress may restart for each
            backup location.
            {' '}Record sizes vary, so a remaining-time estimate is not available.
          </Typography>
          <Button
            variant="outlined"
            disabled={operation.cancelRequested}
            onClick={onStop}
            sx={{ alignSelf: 'flex-start', minHeight: 44 }}
          >
            {operation.cancelRequested ? 'Stopping safely…' : 'Stop this sync'}
          </Button>
        </Stack>
      )}
      {(details || operation.error) && (
        <Accordion
          disableGutters
          elevation={0}
          sx={{ mt: 1, bgcolor: 'transparent', '&:before': { display: 'none' } }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            id="backup-activity-details"
            aria-controls="backup-activity-log"
          >
            Technical details
          </AccordionSummary>
          <AccordionDetails id="backup-activity-log">
            <Box
              component="pre"
              tabIndex={0}
              aria-label="Sync details"
              sx={{
                m: 0,
                p: 1,
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: 12,
              }}
            >
              {[operation.error, details].filter(Boolean).join('\n')}
            </Box>
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}
