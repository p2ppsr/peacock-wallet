import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Grid,
  IconButton,
  Stack,
  Typography,
  Button,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import DownloadIcon from '@mui/icons-material/Download';
import Tooltip from '@mui/material/Tooltip';
import { useLocation, useParams } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader';
import DetailsSection from '../../../components/DetailsSection';
import BasketAccessList from '../../../components/BasketAccessList';
import AmountDisplay from '../../../components/AmountDisplay';
import { WalletContext } from '../../../WalletContext';
import { UserContext } from '../../../UserContext';
import { Transaction, Utils, WalletOutput } from '@bsv/sdk';
import AppLogo from '../../../components/AppLogo';
import { selectMostTrusted } from '../../../utils/selectMostTrusted';
import { getRegistryClient } from '../../../utils/clientFactories';
import { openUrl } from '../../../utils/openUrl';

type BasketDetails = {
  id: string;
  name: string;
  description: string;
  documentationURL?: string;
  iconURL?: string;
};

type ParsedOutpoint = {
  txid: string;
  vout: number;
};

const parseOutpointString = (outpoint?: string): ParsedOutpoint => {
  if (!outpoint) {
    return { txid: 'unknown', vout: 0 };
  }

  const [txidPart, indexPart] = outpoint.split(':');
  const txid = txidPart || 'unknown';
  const parsedIndex = indexPart ? Number.parseInt(indexPart, 10) : 0;

  return {
    txid,
    vout: Number.isNaN(parsedIndex) ? 0 : parsedIndex,
  };
};

const toSafeFilenameSegment = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]+/g, '-');

const BasketAccess = () => {
  const { basketId } = useParams<{ basketId: string }>();
  const location = useLocation();
  const locationState = location.state as Partial<BasketDetails> | undefined;
  const { managers, adminOriginator, settings, network } = useContext(WalletContext);
  const { onDownloadFile } = useContext(UserContext);

  const [details, setDetails] = useState<BasketDetails | null>(null);
  const [items, setItems] = useState<WalletOutput[]>([]);
  const [aggregatedBeef, setAggregatedBeef] = useState<number[] | null>(null);
  const [totalOutputsCount, setTotalOutputsCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalValue = useMemo(
    () => items.reduce((sum, output) => sum + Number(output?.satoshis ?? 0), 0),
    [items]
  );

  const permissionManager = managers.permissionsManager;
  const registry = useMemo(
    () => getRegistryClient(permissionManager, { networkPreset: network }),
    [permissionManager, network]
  );

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (!permissionManager || !registry || !basketId) return;
      setLoading(true);
      setError(null);

      try {
        const [outputsResult, registryResults] = await Promise.all([
          permissionManager.listOutputs(
            {
              basket: basketId,
              includeCustomInstructions: true,
              includeTags: true,
              includeLabels: true,
              include: 'entire transactions',
            },
            adminOriginator
          ),
          registry.resolve('basket', {
            basketID: basketId,
            registryOperators: settings.trustSettings.trustedCertifiers.map(c => c.identityKey),
          }),
        ]);

        if (cancelled) return;

        const outputs = outputsResult.outputs as WalletOutput[];
        setItems(outputs);
        setAggregatedBeef(outputsResult.BEEF as number[] ?? null);
        setTotalOutputsCount(outputsResult.totalOutputs ?? outputs.length);

        if (locationState?.id === basketId) {
          setDetails({
            id: basketId,
            name: locationState.name ?? 'Unregistered basket',
            description: locationState.description ?? 'No description available yet.',
            documentationURL: locationState.documentationURL,
            iconURL: locationState.iconURL,
          });
        } else {
          const trusted = selectMostTrusted(registryResults, settings.trustSettings.trustedCertifiers);
          setDetails({
            id: basketId,
            name: trusted?.name ?? 'Unregistered basket',
            description: trusted?.description ?? 'No description available yet.',
            documentationURL: trusted?.documentationURL,
            iconURL: trusted?.iconURL,
          });
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error(err);
        setError(err.message ?? 'Failed to load basket details.');
        setDetails({
          id: basketId,
          name: 'Unregistered basket',
          description: 'No description is available for this basket.',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [adminOriginator, basketId, locationState, permissionManager, registry, settings.trustSettings.trustedCertifiers]);

  const aggregatedBeefBase64 = useMemo(
    () => (aggregatedBeef ? Utils.toBase64(aggregatedBeef) : undefined),
    [aggregatedBeef]
  );

  const transactionBeefByTxid = useMemo(() => {
    if (!aggregatedBeef || items.length === 0) return new Map<string, string>();

    const map = new Map<string, string>();
    const seen = new Set<string>();

    for (const output of items) {
      const { txid } = parseOutpointString(output.outpoint);
      if (!txid || txid === 'unknown' || seen.has(txid)) continue;

      try {
        const tx = Transaction.fromBEEF(aggregatedBeef, txid);
        map.set(txid, Utils.toBase64(tx.toBEEF()));
        seen.add(txid);
      } catch (err) {
        console.warn('Failed to isolate transaction BEEF', { txid, err });
      }
    }

    return map;
  }, [aggregatedBeef, items]);

  const handleCopy = () => {
    navigator.clipboard.writeText(basketId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const buildOutputEntry = useCallback(
    (output: WalletOutput) => {
      const { txid, vout } = parseOutpointString(output.outpoint);
      const transactionBeefBase64 = txid ? transactionBeefByTxid.get(txid) : undefined;

      return {
        outpoint: output.outpoint,
        txid,
        vout,
        satoshis: Number(output?.satoshis ?? 0),
        spendable: output.spendable,
        customInstructions: output.customInstructions,
        tags: output.tags ?? [],
        labels: output.labels ?? [],
        lockingScript: output.lockingScript,
        transactionBeefBase64,
      };
    },
    [transactionBeefByTxid]
  );

  const handleExport = useCallback(() => {
    try {
      const exportPayload = {
        basketId,
        generatedAt: new Date().toISOString(),
        totalOutputs: totalOutputsCount,
        totalValue,
        aggregatedBeefBase64,
        outputs: items.map(buildOutputEntry),
      };

      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
      const safeBasketId = toSafeFilenameSegment(basketId);
      onDownloadFile(blob, `basket_${safeBasketId}_contents.json`);
    } catch (err) {
      console.error(err);
    }
  }, [aggregatedBeefBase64, basketId, buildOutputEntry, items, onDownloadFile, totalOutputsCount, totalValue]);

  const handleExportSingle = useCallback(
    (output: WalletOutput) => {
      try {
        const exportPayload = {
          basketId,
          generatedAt: new Date().toISOString(),
          totalOutputs: 1,
          totalValue: Number(output?.satoshis ?? 0),
          aggregatedBeefBase64:
            (() => {
              const { txid } = parseOutpointString(output.outpoint);
              const txBeef = txid ? transactionBeefByTxid.get(txid) : undefined;
              return txBeef ?? aggregatedBeefBase64;
            })(),
          outputs: [buildOutputEntry(output)],
        };

        const { txid, vout } = parseOutpointString(output.outpoint);
        const safeBasketId = toSafeFilenameSegment(basketId);
        const safeTxId = txid ? txid.slice(0, 12) : 'output';

        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
        onDownloadFile(blob, `basket_${safeBasketId}_${safeTxId}_${vout}.json`);
      } catch (err) {
        console.error(err);
      }
    },
    [aggregatedBeefBase64, basketId, buildOutputEntry, onDownloadFile, transactionBeefByTxid]
  );

  if (loading) {
    return (
      <Box p={3} display="flex" justifyContent="center" alignItems="center">
        <AppLogo rotate size={100} />
      </Box>
    );
  }

  if (!details) {
    return (
      <Box p={3}>
        <Alert severity="error">Basket details could not be found.</Alert>
      </Box>
    );
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader
        title={details.name}
        subheading={
          <Stack spacing={0.5}>
            <Typography variant="caption" color="textSecondary">
              Basket ID
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                {basketId}
              </Typography>
              <IconButton size="small" onClick={handleCopy} disabled={copied}>
                {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              </IconButton>
            </Stack>
          </Stack>
        }
        icon={details.iconURL}
        buttonTitle="Export Contents"
        buttonIcon={<DownloadIcon />}
        onClick={handleExport}
      />

      {error && (
        <Alert severity="warning">{error}</Alert>
      )}

      <DetailsSection
        title="Overview"
        subtitle="High-level information about this basket."
      >
        <Stack spacing={2}>
          <Typography variant="body1">
            {details.description || 'No description is available for this basket.'}
          </Typography>
          {details.documentationURL && (
            <Typography variant="body2" color="textSecondary">
              Documentation:{' '}
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  if (details.documentationURL) {
                    void openUrl(details.documentationURL);
                  }
                }}
              >
                {details.documentationURL}
              </Button>
            </Typography>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="textSecondary">
                Items
              </Typography>
              <Typography variant="h6" color="textPrimary">
                {totalOutputsCount}
              </Typography>
            </Stack>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="textSecondary">
                Total Value
              </Typography>
              <Typography variant="h6" color="textPrimary">
                <AmountDisplay abbreviate>{totalValue}</AmountDisplay>
              </Typography>
            </Stack>
          </Stack>
        </Stack>
      </DetailsSection>

      <Grid container spacing={3}>
        <Grid item xs={12} lg={6}>
          <DetailsSection
            title="Apps With Access"
            subtitle="Applications currently authorized to view this basket."
          >
            <BasketAccessList
              basket={basketId}
              itemsDisplayed="apps"
              showEmptyList
              canRevoke
            />
          </DetailsSection>
        </Grid>
        <Grid item xs={12} lg={6}>
          <DetailsSection
            title="Recent Basket Outputs"
            subtitle="Most recent entries stored in this basket."
          >
            {items.length === 0 ? (
              <Typography color="textSecondary">This basket does not contain any items yet.</Typography>
            ) : (
              <Stack spacing={1.5}>
                {items.map((output) => {
                  const { txid, vout } = parseOutpointString(output.outpoint);
                  const displayTxid = txid && txid !== 'unknown'
                    ? `${txid.slice(0, 20)}…`
                    : 'unknown-tx';
                  const txAmount = Number(output?.satoshis ?? 0);
                  const instructions = output.customInstructions;
                  const tags = output.tags ?? [];
                  const labels = output.labels ?? [];

                  return (
                    <Box
                      key={`${txid}:${vout}`}
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        bgcolor: 'background.paper',
                        boxShadow: theme => theme.shadows[1],
                      }}
                    >
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                        <Box flexGrow={1}>
                          <Typography variant="subtitle2" sx={{ wordBreak: 'break-all' }}>
                            {txid}:{vout}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            {displayTxid}
                          </Typography>
                          {instructions && (
                            <Typography variant="body2" sx={{ mt: 0.5 }}>
                              {instructions}
                            </Typography>
                          )}
                          {labels.length > 0 && (
                            <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                              Labels: {labels.join(', ')}
                            </Typography>
                          )}
                          {tags.length > 0 && (
                            <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                              Tags: {tags.join(', ')}
                            </Typography>
                          )}
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                          <AmountDisplay abbreviate>{txAmount}</AmountDisplay>
                          <Tooltip title="Download this output">
                            <span>
                              <IconButton onClick={() => handleExportSingle(output)} color="primary">
                                <DownloadIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      </Stack>
                    </Box>
                  );
                })}
                {totalOutputsCount > items.length && (
                  <Typography variant="caption" color="textSecondary">
                    Showing {items.length} of {totalOutputsCount} outputs. Export to view all entries.
                  </Typography>
                )}
              </Stack>
            )}
          </DetailsSection>
        </Grid>
      </Grid>
    </Stack>
  );
};

export default BasketAccess;
