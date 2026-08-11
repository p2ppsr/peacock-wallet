import { useContext, useMemo, useState, useEffect } from 'react';
import {
  Alert,
  Box,
  Grid,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { useParams } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader';
import DetailsSection from '../../../components/DetailsSection';
import CounterpartyChip from '../../../components/CounterpartyChip';
import ProtocolPermissionList from '../../../components/ProtocolPermissionList';
import CertificateAccessList from '../../../components/CertificateAccessList';
import { WalletContext } from '../../../WalletContext';
import AppLogo from '../../../components/AppLogo';
import { DEFAULT_APP_ICON } from '../../../constants/popularApps';
import { DisplayableIdentity } from '@bsv/sdk';
import { getIdentityClient } from '../../../utils/clientFactories';

const CounterpartyAccess = () => {
  const { counterparty } = useParams<{ counterparty: string }>();
  const { managers, adminOriginator, network } = useContext(WalletContext);

  const identityClient = useMemo(
    () => getIdentityClient(managers?.permissionsManager, { adminOriginator, networkPreset: network }),
    [managers?.permissionsManager, adminOriginator, network]
  );

  const [identity, setIdentity] = useState<DisplayableIdentity | null>(null);
  const [trustEndorsements, setTrustEndorsements] = useState<DisplayableIdentity[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const createFallbackIdentity = (): DisplayableIdentity => ({
    identityKey: counterparty,
    abbreviatedKey: counterparty,
    name: 'Unverified counterparty',
    avatarURL: undefined,
    badgeIconURL: '',
    badgeLabel: 'Unverified',
    badgeClickURL: '',
  });

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (!identityClient) return;
      setLoading(true);
      setError(null);

      try {
        const results = await identityClient.resolveByIdentityKey({ identityKey: counterparty });
        if (cancelled) return;

        setTrustEndorsements(results);
        setIdentity(results[0] ?? createFallbackIdentity());
      } catch (err: any) {
        if (cancelled) return;
        console.error(err);
        setError(err.message ?? 'Failed to load counterparty details.');
        setIdentity(createFallbackIdentity());
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [counterparty, identityClient]);

  const handleCopy = () => {
    navigator.clipboard.writeText(counterparty);
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

  if (!identity) {
    return (
      <Box p={3}>
        <Alert severity="error">Counterparty information could not be found.</Alert>
      </Box>
    );
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader
        title={identity.name || 'Unverified counterparty'}
        subheading={
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
              {counterparty}
            </Typography>
            <IconButton size="small" onClick={handleCopy} disabled={copied}>
              {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Stack>
        }
        icon={identity.avatarURL ?? DEFAULT_APP_ICON}
        buttonTitle=""
        onClick={() => {}}
        showButton={false}
      />

      {error && <Alert severity="warning">{error}</Alert>}

      <DetailsSection title="Overview" subtitle="Identity details provided by your trust network.">
        <Stack spacing={2}>
          <CounterpartyChip counterparty={counterparty} clickable={false} />
          <Typography variant="body2" color="textSecondary">
            Identity key: {identity.identityKey}
          </Typography>
        </Stack>
      </DetailsSection>

      <Grid container spacing={3}>
        <Grid item xs={12} lg={6}>
          <DetailsSection
            title="Trust Endorsements"
            subtitle="Entities that have published information about this counterparty."
          >
            {trustEndorsements.length === 0 ? (
              <Typography color="textSecondary">
                No trust endorsements have been discovered for this counterparty yet.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {trustEndorsements.map(endorsement => (
                  <CounterpartyChip
                    key={endorsement.identityKey}
                    counterparty={endorsement.identityKey}
                    clickable
                    layout="compact"
                  />
                ))}
              </Stack>
            )}
          </DetailsSection>
        </Grid>
        <Grid item xs={12} lg={6}>
          <DetailsSection
            title="Protocol Permissions"
            subtitle="Apps and protocols authorised to interact with this counterparty."
          >
            <ProtocolPermissionList
              counterparty={counterparty}
              itemsDisplayed="protocols"
              showEmptyList
              canRevoke
              displayCount={false}
            />
          </DetailsSection>
        </Grid>
        <Grid item xs={12}>
          <DetailsSection
            title="Certificates Shared"
            subtitle="Certificate data that has been revealed to this counterparty."
          >
            <CertificateAccessList
              counterparty={counterparty}
              itemsDisplayed="certificates"
              showEmptyList
              canRevoke
              type="certificate"
              displayCount={false}
            />
          </DetailsSection>
        </Grid>
      </Grid>
    </Stack>
  );
};

export default CounterpartyAccess;
