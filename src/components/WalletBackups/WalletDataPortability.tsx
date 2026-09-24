import { parseWalletStorageSyncProgress } from '../../walletStorageRuntime';
import { useContext, useEffect, useRef, useState } from 'react';
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
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Link } from 'react-router-dom';
import { WalletContext } from '../../WalletContext';
import {
  ARCHIVE_TABLES,
  PortabilityError,
  PORTABILITY_MESSAGES,
  matchesArchiveWallet,
  type ArchiveSource,
  type ArchiveSummary,
} from '../../walletPortability';
import {
  listArchiveJobs,
  originalArchiveFile,
  updateArchiveJob,
  type ArchiveJob,
} from '../../walletPortabilityStore';
import { runPortabilityWorker, saveWalletArchive } from '../../walletPortabilityClient';

const names: Record<(typeof ARCHIVE_TABLES)[number], string> = {
  provenTxs: 'Transaction proofs',
  provenTxReqs: 'Proof requests',
  outputBaskets: 'Baskets',
  transactions: 'Transactions',
  commissions: 'Commissions',
  outputs: 'Outputs',
  outputTags: 'Output tags',
  outputTagMaps: 'Output tag links',
  txLabels: 'Transaction labels',
  txLabelMaps: 'Transaction label links',
  certificates: 'Certificates',
  certificateFields: 'Certificate fields',
  syncStates: 'Synchronization records',
};
const date = (value?: string) =>
  value ? new Date(value).toLocaleString() : 'No completed synchronization recorded';

export function ArchivePreview({ summary }: { summary: ArchiveSummary }) {
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        Network: {summary.chain === 'main' ? 'Mainnet' : summary.chain === 'ttn' ? 'TerraTestNet' : 'Testnet'} · Exported{' '}
        {date(summary.exportedAt)}
      </Typography>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        Wallet identity: {summary.identityKey}
      </Typography>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        Archive source: {summary.sourceName}
      </Typography>
      <Typography variant="body2">
        {summary.totalRecords.toLocaleString()} records across 13 categories, including deleted
        records and synchronization state.
      </Typography>
      <Accordion disableGutters elevation={0}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          Record counts and source details
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
            Source storage identity: {summary.sourceIdentity}
          </Typography>
          <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 1 }}>
            {ARCHIVE_TABLES.map((table) => (
              <Box key={table} sx={{ display: 'contents' }}>
                <Typography component="dt" variant="body2">
                  {names[table]}
                </Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                  {summary.counts[table].toLocaleString()}
                </Typography>
              </Box>
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>
      {summary.pendingTransactions > 0 && (
        <Alert severity="warning">
          This copy contains {summary.pendingTransactions} pending transactions. Their saved records
          are retained. Pending batches and auxiliary runtime state are excluded by design. Review
          unsettled activity before spending.
        </Alert>
      )}
    </Stack>
  );
}

export default function WalletDataPortability() {
  const wallet = useContext(WalletContext);
  const [jobs, setJobs] = useState<ArchiveJob[]>([]);
  const [selected, setSelected] = useState<ArchiveJob>();
  const [mode, setMode] = useState<'export' | 'import' | 'review' | 'activate' | null>(null);
  const [source, setSource] = useState<ArchiveSource>();
  const [file, setFile] = useState<File>();
  const [encryptedInput, setEncryptedInput] = useState(false);
  const [plaintext, setPlaintext] = useState(false);
  const [ack, setAck] = useState(false);
  const [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false),
    [phase, setPhase] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const controller = useRef<AbortController>(),
    running = useRef(false),
    fileInput = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    const all = await listArchiveJobs();
    // Preparation/live transfer can advance the durable job before a stop or
    // failure. Reflect that state so recovery offers Resume, not a fresh merge.
    setSelected((current) => (current ? all.find((job) => job.id === current.id) : current));
    setJobs(
      wallet.walletDataIdentity
        ? all.filter(
            (job) =>
              job.summary?.identityKey === wallet.walletDataIdentity &&
              job.summary?.chain === wallet.environment.chain
          )
        : all
    );
  };
  useEffect(() => {
    void refresh().catch(() => setError(PORTABILITY_MESSAGES.storage));
    return () => controller.current?.abort();
  }, [wallet.walletDataIdentity, wallet.network]);
  const locked = busy || wallet.storageOperation.busy;
  const currentIdentity = wallet.walletDataIdentity;
  const currentChain = wallet.environment.chain;
  const matching =
    !!selected?.summary &&
    !!currentIdentity &&
    matchesArchiveWallet(selected.summary, currentIdentity, currentChain);
  const report = (message: string) => {
    const page = parseWalletStorageSyncProgress(message);
    setPhase(
      page
        ? `Preparing ${page.stageName}: through record ${page.stageOffset.toLocaleString()}; ${page.records.toLocaleString()} records in this page…`
        : message.replace(
            /\b(provenTxs|provenTxReqs|outputBaskets|transactions|commissions|outputs|outputTags|outputTagMaps|txLabels|txLabelMaps|certificates|certificateFields|syncStates)\b/g,
            (table) => names[table as keyof typeof names].toLowerCase()
          )
    );
  };
  const clearSecrets = () => {
    setPassword('');
    setConfirm('');
  };
  const close = () => {
    if (locked) return;
    setMode(null);
    setFile(undefined);
    clearSecrets();
    setAck(false);
  };
  const perform = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (running.current || wallet.storageOperation.busy) return;
    running.current = true;
    controller.current = new AbortController();
    setBusy(true);
    setError('');
    setNotice('');
    setPhase('Preparing…');
    try {
      await task(controller.current.signal);
    } catch (failure) {
      setError(
        controller.current?.signal.aborted ||
          (failure instanceof Error && failure.name === 'WalletStorageOperationCancelledError')
          ? PORTABILITY_MESSAGES.cancelled
          : failure instanceof PortabilityError
            ? failure.message
            : PORTABILITY_MESSAGES.storage
      );
    } finally {
      clearSecrets();
      setBusy(false);
      running.current = false;
      controller.current = undefined;
      await refresh().catch(() => {});
    }
  };
  const openExport = (copy?: ArchiveSource) => {
    setMode('export');
    setSource(copy);
    setPlaintext(false);
    setAck(false);
    clearSecrets();
    setError('');
    setNotice('');
  };
  const prepareSource = (synchronize: boolean): void => {
    void perform(async (signal): Promise<void> => {
      const prepared = await wallet.getArchiveSource(synchronize, report);
      if (signal.aborted) throw new PortabilityError('cancelled');
      setSource(prepared);
    });
  };
  const exportFile = (): void => {
    void perform(async (signal): Promise<void> => {
      if (!source) throw new PortabilityError('storage');
      const passphrase = password;
      clearSecrets();
      const result = await runPortabilityWorker<{ bytes: ArrayBuffer; summary: ArchiveSummary }>(
        {
          operation: 'export',
          source,
          format: plaintext ? 'brc38' : 'brc39',
          password: passphrase,
        },
        report,
        signal
      );
      setPhase('Choose where to save the wallet file…');
      try {
        const saved = await saveWalletArchive(result.bytes, !plaintext);
        setNotice(
          saved
            ? `File saved and verified before writing: ${result.summary.totalRecords.toLocaleString()} records. Device snapshot captured ${date(result.summary.exportedAt)}; copied from ${source.copiedFrom}; last completed synchronization ${date(source.lastSyncedAt)}. Keep your account recovery material separately.`
            : 'Save cancelled. No destination file was written.'
        );
        if (saved) setMode(null);
      } finally {
        new Uint8Array(result.bytes).fill(0);
      }
    });
  };
  const importFile = (): void => {
    void perform(async (signal): Promise<void> => {
      const passphrase = password;
      clearSecrets();
      const job =
        selected?.state === 'preparing' && !file
          ? await runPortabilityWorker<ArchiveJob>(
              { operation: 'resume', id: selected.id, password: passphrase },
              report,
              signal
            )
          : await runPortabilityWorker<ArchiveJob>(
              { operation: 'import', file: file!, fileName: file!.name, password: passphrase },
              report,
              signal
            );
      setSelected(job);
      setMode('review');
      setAck(false);
      setFile(undefined);
    });
  };
  const merge = (): void => {
    void perform(async (signal): Promise<void> => {
      const job = await wallet.mergeWalletArchive(selected!.id, report, signal);
      setSelected(job);
      setAck(false);
      setNotice(
        `Merge completed: ${job.inserts ?? 0} inserted and ${job.updates ?? 0} updated in this pass. Matching unchanged records are kept without duplication. Your main location is unchanged; sync backups to update other copies.`
      );
    });
  };
  const restore = (): void => {
    void perform(async (): Promise<void> => {
      setSelected(await updateArchiveJob(selected!.id, { state: 'restored' }));
      setNotice(
        'Data restored and verified as a separate device copy. Your current wallet is unchanged. Recover matching keys before using these funds.'
      );
    });
  };
  const activate = (): void => {
    void perform(async (signal): Promise<void> => {
      await wallet.activateWalletArchive(selected!.id, report, signal);
    });
  };
  const saveOriginal = (): void => {
    void perform(async (): Promise<void> => {
      setPhase('Choose where to save the retained original file…');
      const original = await originalArchiveFile(selected!.id),
        bytes = await original.arrayBuffer();
      const magic = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
      try {
        setNotice(
          (await saveWalletArchive(bytes, magic.join(',') === '87,68,65,84'))
            ? 'Original file saved without modification.'
            : 'Save cancelled.'
        );
      } finally {
        new Uint8Array(bytes).fill(0);
      }
    });
  };
  const exportCopy = (databaseName: string, label: string) => {
    if (!selected?.summary) return;
    openExport({
      databaseName,
      chain: selected.summary.chain,
      identityKey: selected.summary.identityKey,
      copiedFrom: label,
    });
  };
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, my: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6" component="h2">
          Portable wallet data — {wallet.activeProfile?.name || 'one profile'}
        </Typography>
        <Typography variant="body2">
          Save an encrypted .brc39 file or import BRC-38/39 data from another compatible wallet.
          Each file contains exactly one profile’s wallet records, proofs, certificates and
          derivation data. Pending batches and auxiliary runtime state are excluded by design.
          Account keys, login credentials, device backup preferences and app settings have their own
          recovery process. Select other profiles separately to export their data; imports never
          combine different profiles.
        </Typography>
        <Alert severity="info">
          Exports capture one consistent device database snapshot. A synchronized copy includes its
          own synchronization records, not the remote provider’s internal history. Keep the file and
          your account recovery material safe.
        </Alert>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button
            variant="contained"
            disabled={locked || !currentIdentity}
            onClick={() => openExport()}
          >
            Export wallet data
          </Button>
          <Button
            variant="outlined"
            disabled={locked}
            onClick={() => {
              setSelected(undefined);
              setFile(undefined);
              setMode('import');
              setAck(false);
              clearSecrets();
              setError('');
              setNotice('');
            }}
          >
            Import wallet data
          </Button>
          <Button component={Link} to={currentIdentity ? '/dashboard/settings' : '/'} disabled={locked}>
            Account key recovery
          </Button>
        </Stack>
        {notice && (
          <Alert severity="success" role="status">
            {notice}
          </Alert>
        )}
        {error && (
          <Alert severity="warning" role="alert">
            {error}
          </Alert>
        )}
        {jobs.length > 0 && (
          <Accordion disableGutters elevation={0}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              {currentIdentity
                ? 'Imports and recovery copies for this profile'
                : 'Restored profiles on this device'}{' '}
              ({jobs.length})
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1}>
                {jobs.map((job) => (
                  <Paper variant="outlined" key={job.id} sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {job.fileName}
                    </Typography>
                    <Typography variant="caption">
                      {date(job.createdAt)} ·{' '}
                      {job.summary?.chain === 'ttn' ? 'TerraTestNet' : job.summary?.chain === 'test' ? 'Testnet' : 'Mainnet'} ·{' '}
                      {job.summary?.totalRecords.toLocaleString()} records
                    </Typography>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Chip
                        size="small"
                        label={
                          job.state === 'preparing'
                            ? 'Preparation interrupted'
                            : job.state === 'merging'
                              ? 'Merge needs resume'
                              : job.state === 'active'
                                ? 'Selected for matching keys'
                                : 'Verified data copy'
                        }
                      />
                      <Button
                        disabled={locked}
                        onClick={() => {
                          setSelected(job);
                          setFile(undefined);
                          setMode(job.state === 'preparing' ? 'import' : 'review');
                          setEncryptedInput(true);
                          clearSecrets();
                          setAck(false);
                          setError('');
                        }}
                      >
                        Review
                      </Button>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        )}
      </Stack>
      <Dialog
        open={mode !== null}
        onClose={locked ? undefined : close}
        fullWidth
        maxWidth="sm"
        aria-labelledby="wallet-data-title"
        disableEscapeKeyDown={locked}
      >
        <DialogTitle id="wallet-data-title">
          {mode === 'export'
            ? 'Export wallet data'
            : mode === 'import'
              ? 'Import wallet data'
              : mode === 'activate'
                ? 'Use restored data as main?'
                : 'Review restored wallet data'}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {busy && (
              <Box role="status" aria-live="polite">
                <LinearProgress sx={{ mb: 1 }} />
                <Typography variant="body2">{phase}</Typography>
                <Typography variant="caption">
                  Synchronization and merge can hold the wallet queue. Other wallet calls may wait.
                  A stopped merge retains completed pages and can be resumed.
                </Typography>
              </Box>
            )}
            {error && <Alert severity="warning">{error}</Alert>}
            {notice && <Alert severity="success">{notice}</Alert>}
            {mode === 'export' && (
              <>
                <Typography variant="body2">
                  A complete local BRC-38 snapshot, encrypted as BRC-39 by default. Supported file
                  size: up to 2 GiB, subject to available memory and disk space. Large wallets can
                  take several minutes. Preparing a device snapshot retains a local copy; it does
                  not change your backup preferences.
                </Typography>
                {!source ? (
                  <Stack spacing={1}>
                    <Button
                      disabled={locked}
                      variant="contained"
                      onClick={() => prepareSource(true)}
                    >
                      Synchronize and prepare device copy
                    </Button>
                    <Button disabled={locked} onClick={() => prepareSource(false)}>
                      Use last saved device copy (offline)
                    </Button>
                  </Stack>
                ) : (
                  <Alert severity="info">
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      Source: {source.copiedFrom} → consistent device snapshot
                      <br />
                      Network: {source.chain === 'ttn' ? 'TerraTestNet' : source.chain === 'main' ? 'Mainnet' : 'Testnet'}
                      <br />
                      Last completed synchronization: {date(source.lastSyncedAt)}
                    </Typography>
                    <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
                      Wallet identity: {source.identityKey}
                    </Typography>
                  </Alert>
                )}
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={plaintext}
                      disabled={locked}
                      onChange={(_, value) => {
                        setPlaintext(value);
                        setAck(false);
                        clearSecrets();
                      }}
                    />
                  }
                  label="Advanced: export plaintext .brc38.json"
                />
                {plaintext ? (
                  <>
                    <Alert severity="warning">
                      Anyone with this file can read sensitive wallet data. Store it securely and
                      only share it with a trusted wallet.
                    </Alert>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={ack}
                          disabled={locked}
                          onChange={(_, value) => setAck(value)}
                        />
                      }
                      label="I understand this file will not be encrypted."
                    />
                  </>
                ) : (
                  <>
                    <TextField
                      label="New file passphrase"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      disabled={locked}
                      onChange={(e) => setPassword(e.target.value)}
                      helperText="Use at least 12 characters. This passphrase cannot be recovered."
                    />
                    <TextField
                      label="Confirm file passphrase"
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      disabled={locked}
                      onChange={(e) => setConfirm(e.target.value)}
                      error={confirm.length > 0 && confirm !== password}
                    />
                  </>
                )}
              </>
            )}
            {mode === 'import' && (
              <>
                <Typography variant="body2">
                  The file is validated and restored into a separate copy before your current wallet
                  can be changed. The original file is retained on this device; the passphrase is
                  never saved. Decrypted copies use the same device storage protection as your local
                  wallet.
                </Typography>
                {selected?.state === 'preparing' ? (
                  <Alert severity="info">
                    Resume {selected.fileName}. Enter its passphrase again if encrypted; leave blank
                    for plaintext.
                  </Alert>
                ) : (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".brc39,.json,.brc38"
                      hidden
                      onChange={async (e) => {
                        const next = e.target.files?.[0];
                        e.target.value = '';
                        setFile(undefined);
                        clearSecrets();
                        setError('');
                        if (!next) return;
                        if (next.size > 2 * 1024 * 1024 * 1024 - 1) {
                          setError(PORTABILITY_MESSAGES.size);
                          return;
                        }
                        const prefix = new Uint8Array(await next.slice(0, 4).arrayBuffer());
                        setEncryptedInput(prefix.join(',') === '87,68,65,84');
                        setFile(next);
                      }}
                    />
                    <Button
                      variant="outlined"
                      disabled={locked}
                      onClick={() => fileInput.current?.click()}
                    >
                      Choose wallet data file
                    </Button>
                    {file && (
                      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                        {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MiB ·{' '}
                        {encryptedInput ? 'Encrypted BRC-39' : 'Plaintext BRC-38'}
                      </Typography>
                    )}
                  </>
                )}
                {(encryptedInput || selected?.state === 'preparing') && (
                  <TextField
                    label="File passphrase"
                    type="password"
                    autoComplete="off"
                    value={password}
                    disabled={locked}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </>
            )}
            {(mode === 'review' || mode === 'activate') && selected?.summary && (
              <>
                <ArchivePreview summary={selected.summary} />
                <Alert severity={matching ? 'success' : 'info'}>
                  {matching
                    ? 'The file matches the current wallet identity and network. Data is verified; account keys remain separate.'
                    : 'This copy is separate from the current wallet. Recover the matching account keys and select the matching network to use it. A file alone cannot grant signing authority.'}
                </Alert>
                {mode === 'review' && (
                  <>
                    <Typography variant="body2">
                      Merge reconciles matching records and their references using Toolbox’s sync
                      rules; newer records and deletion markers can update existing data. Before
                      merging, a synchronized device recovery point is saved. Remote-provider
                      internal sync history stays in the retained archive; the destination uses its
                      own checkpoints.
                    </Typography>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={ack}
                          disabled={locked}
                          onChange={(_, value) => setAck(value)}
                        />
                      }
                      label="I understand a merge updates this wallet and may finish in several resumable steps."
                    />
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                      <Button
                        disabled={
                          locked ||
                          !matching ||
                          !ack ||
                          !['ready', 'restored', 'merged', 'merging'].includes(selected.state)
                        }
                        variant="contained"
                        onClick={merge}
                      >
                        {selected.state === 'merging' ? 'Resume merge' : 'Merge into this wallet'}
                      </Button>
                      <Button
                        disabled={locked || !['ready', 'restored'].includes(selected.state)}
                        onClick={restore}
                      >
                        Restore a separate copy
                      </Button>
                      <Button
                        disabled={
                          locked ||
                          selected.state === 'merging' ||
                          selected.state === 'active' ||
                          (selected.summary.chain !== currentChain || (!!currentIdentity && !matching))
                        }
                        onClick={() => {
                          setMode('activate');
                          setAck(false);
                        }}
                      >
                        Use restored copy as main…
                      </Button>
                    </Stack>
                    <Accordion disableGutters elevation={0}>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        Original file and recovery copies
                      </AccordionSummary>
                      <AccordionDetails>
                        <Stack spacing={1}>
                          <Typography variant="body2">
                            An original plaintext file remains plaintext when saved. Recovery files
                            contain sensitive wallet data. These copies remain on this device until
                            its app data is removed.
                          </Typography>
                          <Button disabled={locked} onClick={saveOriginal}>
                            Save original file unchanged
                          </Button>
                          <Button
                            disabled={locked}
                            onClick={() =>
                              exportCopy(
                                selected.databaseName,
                                `Verified import: ${selected.summary!.sourceName}`
                              )
                            }
                          >
                            Export verified imported copy…
                          </Button>
                          {selected.beforeDatabaseName && (
                            <Button
                              disabled={locked}
                              onClick={() =>
                                exportCopy(
                                  selected.beforeDatabaseName!,
                                  'Device recovery point before this merge'
                                )
                              }
                            >
                              Export recovery point before merge…
                            </Button>
                          )}
                        </Stack>
                      </AccordionDetails>
                    </Accordion>
                  </>
                )}
                {mode === 'activate' && (
                  <>
                    <Alert severity="warning">
                      Stop using this wallet identity on other devices first. Selecting an older
                      copy can omit newer activity. The wallet will restart with a new local working
                      copy as main; previous local data and provider settings are retained for
                      recovery. Reconnect remote providers only after reconciling their data.
                    </Alert>
                    <Typography variant="body2">
                      This works without the original storage provider. Account key recovery may
                      still require your authentication service. Standard wallet policies are
                      applied when the working copy opens; the verified imported copy remains
                      unchanged.
                    </Typography>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={ack}
                          disabled={locked}
                          onChange={(_, value) => setAck(value)}
                        />
                      }
                      label="Other devices are stopped, I have matching recovery material, and I want this restored copy to be main."
                    />
                  </>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}>
          {busy ? (
            <Button
              disabled={
                phase.startsWith('Choose where') || phase.startsWith('Selecting the restored')
              }
              onClick={() => {
                controller.current?.abort();
                wallet.cancelStorageOperation();
                setPhase('Stopping safely…');
              }}
            >
              Stop safely
            </Button>
          ) : (
            <Button onClick={close}>Close</Button>
          )}
          {mode === 'export' && (
            <Button
              variant="contained"
              disabled={
                locked ||
                !source ||
                (plaintext ? !ack : password.length < 12 || password !== confirm)
              }
              onClick={exportFile}
            >
              Save file…
            </Button>
          )}
          {mode === 'import' && (
            <Button
              variant="contained"
              disabled={locked || (!file && selected?.state !== 'preparing')}
              onClick={importFile}
            >
              Validate and preview
            </Button>
          )}
          {mode === 'activate' && (
            <Button variant="contained" disabled={locked || !ack} onClick={activate}>
              Select copy and restart
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
