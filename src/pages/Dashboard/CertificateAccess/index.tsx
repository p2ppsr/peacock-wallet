import { useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Grid,
  IconButton,
  Stack,
  Typography,
  Button,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DescriptionIcon from '@mui/icons-material/Description';
import { useParams } from 'react-router-dom';
import Img from '../../../components/UhrpImg';
import PageHeader from '../../../components/PageHeader';
import DetailsSection from '../../../components/DetailsSection';
import CertificateAccessList from '../../../components/CertificateAccessList';
import AppLogo from '../../../components/AppLogo';
import { WalletContext } from '../../../WalletContext';
import { selectMostTrusted } from '../../../utils/selectMostTrusted';
import { DEFAULT_APP_ICON } from '../../../constants/popularApps';
import { getRegistryClient } from '../../../utils/clientFactories';
import { openUrl } from '../../../utils/openUrl';

type CertificateField = {
  friendlyName: string;
  description: string;
  fieldIcon?: string;
};

type CertificateDefinition = {
  name: string;
  description: string;
  documentationURL?: string;
  iconURL?: string;
  fields: Record<string, CertificateField>;
};

const CertificateAccess = () => {
  const { certType: encodedCertType } = useParams<{ certType: string }>();
  const certType = decodeURIComponent(encodedCertType);
  const { managers, settings, network } = useContext(WalletContext);

  const [definition, setDefinition] = useState<CertificateDefinition | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
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
        const results = await registry.resolve('certificate', {
          type: certType,
          registryOperators: settings.trustSettings.trustedCertifiers.map(c => c.identityKey),
        });

        if (cancelled) return;

        if (!results.length) {
          setDefinition({
            name: 'Unregistered certificate type',
            description: 'This certificate type has not been published by any trusted certifier yet.',
            fields: {},
          });
          return;
        }

        const trusted = selectMostTrusted(results, settings.trustSettings.trustedCertifiers);

        setDefinition({
          name: trusted?.name ?? 'Unregistered certificate type',
          description: trusted?.description ?? 'No description is available for this certificate type.',
          documentationURL: trusted?.documentationURL,
          iconURL: trusted?.iconURL,
          fields: (trusted as any)?.fields ?? {},
        });
      } catch (err: any) {
        if (cancelled) return;
        console.error(err);
        setError(err.message ?? 'Failed to load certificate details.');
        setDefinition({
          name: 'Unregistered certificate type',
          description: 'No description is available for this certificate type.',
          fields: {},
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [certType, registry, settings.trustSettings.trustedCertifiers]);

  const handleCopy = () => {
    navigator.clipboard.writeText(certType);
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

  if (!definition) {
    return (
      <Box p={3}>
        <Alert severity="error">Certificate definition could not be found.</Alert>
      </Box>
    );
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader
        title={definition.name}
        subheading={
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2">{certType}</Typography>
            <IconButton size="small" onClick={handleCopy} disabled={copied}>
              {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Stack>
        }
        icon={definition.iconURL || DEFAULT_APP_ICON}
        buttonTitle=""
        onClick={() => {}}
        showButton={false}
      />

      {error && <Alert severity="warning">{error}</Alert>}

      <DetailsSection
        title="Overview"
        subtitle="Details provided by the certifier about this certificate type."
      >
        <Stack spacing={2}>
          <Typography variant="body1">
            {definition.description || 'No description is available for this certificate type.'}
          </Typography>
          {definition.documentationURL && (
            <Button
              startIcon={<DescriptionIcon />}
              variant="outlined"
              size="small"
              onClick={() => {
                if (definition.documentationURL) {
                  void openUrl(definition.documentationURL);
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
        <Grid item xs={12} lg={6}>
          <DetailsSection title="Field Definitions" subtitle="Attributes included in this certificate.">
            {Object.keys(definition.fields).length === 0 ? (
              <Typography color="textSecondary">This certificate does not publish any field metadata.</Typography>
            ) : (
              <Stack spacing={2}>
                {Object.entries(definition.fields).map(([key, field]) => (
                  <Stack key={key} direction="row" spacing={2} alignItems="flex-start">
                    {field.fieldIcon && (
                      <Avatar sx={{ bgcolor: 'grey.200' }}>
                        <Img src={field.fieldIcon} alt={field.friendlyName} />
                      </Avatar>
                    )}
                    <Box>
                      <Typography variant="subtitle2" color="textSecondary">
                        {field.friendlyName || key}
                      </Typography>
                      <Typography variant="body2">
                        {field.description || 'No description provided.'}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            )}
          </DetailsSection>
        </Grid>
        <Grid item xs={12} lg={6}>
          <DetailsSection
            title="Apps With Access"
            subtitle="Applications that currently hold permissions for this certificate."
          >
            <CertificateAccessList
              itemsDisplayed="apps"
              canRevoke
              showEmptyList
              certTypeFilter={certType}
            />
          </DetailsSection>
        </Grid>
      </Grid>
    </Stack>
  );
};

export default CertificateAccess;
