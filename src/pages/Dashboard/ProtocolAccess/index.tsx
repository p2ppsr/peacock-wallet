import { useContext, useEffect, useMemo, useState } from 'react';
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
import ArticleIcon from '@mui/icons-material/Article';
import { useParams, useLocation } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader';
import DetailsSection from '../../../components/DetailsSection';
import ProtocolPermissionList from '../../../components/ProtocolPermissionList';
import { WalletContext } from '../../../WalletContext';
import { SecurityLevel } from '@bsv/sdk';
import AppLogo from '../../../components/AppLogo';
import { selectMostTrusted } from '../../../utils/selectMostTrusted';
import { DEFAULT_APP_ICON } from '../../../constants/popularApps';
import { getRegistryClient } from '../../../utils/clientFactories';
import { openUrl } from '../../../utils/openUrl';

type ProtocolDetails = {
  name: string;
  description: string;
  documentationURL?: string;
  iconURL?: string;
};

const ProtocolAccess = () => {
  const { protocolId: encodedProtocolId, securityLevel: encodedSecurityLevel } = useParams<{
    protocolId: string;
    securityLevel: string;
  }>();
  const protocolId = decodeURIComponent(encodedProtocolId);
  const securityLevel = Number(decodeURIComponent(encodedSecurityLevel));
  const location = useLocation();
  const { managers, settings, network } = useContext(WalletContext);

  const locationState = location.state as Partial<ProtocolDetails> | undefined;

  const [details, setDetails] = useState<ProtocolDetails | null>(
    locationState
      ? {
        name: locationState.name ?? `Protocol ${protocolId}`,
        description: locationState.description ?? 'Additional information will appear once resolved.',
        documentationURL: locationState.documentationURL,
        iconURL: locationState.iconURL,
      }
      : null
  );
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(!locationState);
  const [error, setError] = useState<string | null>(null);

  const registry = useMemo(
    () => getRegistryClient(managers.walletManager, { networkPreset: network }),
    [managers.walletManager, network]
  );

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (!registry) return;

      setLoading(true);
      setError(null);

      try {
        const results = await registry.resolve('protocol', {
          protocolID: [securityLevel as SecurityLevel, protocolId],
          registryOperators: settings.trustSettings.trustedCertifiers.map(c => c.identityKey),
        });

        if (cancelled) return;

        const trusted = selectMostTrusted(results, settings.trustSettings.trustedCertifiers);
        setDetails({
          name: trusted?.name ?? `Protocol ${protocolId}`,
          description: trusted?.description ?? 'No description is available for this protocol.',
          documentationURL: trusted?.documentationURL,
          iconURL: trusted?.iconURL,
        });
      } catch (err: any) {
        if (cancelled) return;
        console.error(err);
        setError(err.message ?? 'Failed to load protocol details.');
        setDetails({
          name: `Protocol ${protocolId}`,
          description: 'No description is available for this protocol.',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [registry, protocolId, securityLevel, settings.trustSettings.trustedCertifiers]);

  const handleCopy = () => {
    navigator.clipboard.writeText(protocolId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

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
        <Alert severity="error">Protocol details could not be found.</Alert>
      </Box>
    );
  }

  return (
    <Stack spacing={8} sx={{ p: 2 }}>
      <PageHeader
        title={details.name}
        subheading={
          <Stack spacing={0.5}>
            <Typography variant="caption" color="textSecondary">
              Security Level
            </Typography>
            <Typography variant="body2">{securityLevel}</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                {protocolId}
              </Typography>
              <IconButton size="small" onClick={handleCopy} disabled={copied}>
                {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              </IconButton>
            </Stack>
          </Stack>
        }
        icon={details.iconURL || DEFAULT_APP_ICON}
        buttonTitle=""
        onClick={() => { }}
        showButton={false}
      />

      {error && <Alert severity="warning">{error}</Alert>}

      <DetailsSection title="Overview" subtitle="Protocol information and documentation.">
        <Stack spacing={2}>
          <Typography variant="body1">
            {details.description || 'No description is available for this protocol.'}
          </Typography>
          {details.documentationURL && (
            <Button
              startIcon={<ArticleIcon />}
              variant="outlined"
              size="small"
              onClick={() => {
                if (details.documentationURL) {
                  void openUrl(details.documentationURL);
                }
              }}
              sx={{ alignSelf: 'flex-start' }}
            >
              View Documentation
            </Button>
          )}
        </Stack>
      </DetailsSection>

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <DetailsSection
            title="Apps With Access"
            subtitle="Applications currently authorised to use this protocol."
          >
            <ProtocolPermissionList
              protocol={protocolId}
              securityLevel={securityLevel}
              itemsDisplayed="apps"
              showEmptyList
              canRevoke
              displayCount={false}
            />
          </DetailsSection>
        </Grid>
      </Grid>
    </Stack>
  );
};

export default ProtocolAccess;
