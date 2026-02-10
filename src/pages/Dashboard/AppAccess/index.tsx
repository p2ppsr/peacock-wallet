import { useCallback, useEffect, useMemo, useState, useContext } from 'react';
import {
  Box,
  IconButton,
  Stack,
  Typography,
  CircularProgress,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LaunchIcon from '@mui/icons-material/Launch';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { useParams } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader';
import DetailsSection from '../../../components/DetailsSection';
import AccessAtAGlance from '../../../components/AccessAtAGlance';
import ProtocolPermissionList from '../../../components/ProtocolPermissionList';
import BasketAccessList from '../../../components/BasketAccessList';
import CertificateAccessList from '../../../components/CertificateAccessList';
import SpendingAuthorizationList from '../../../components/SpendingAuthorizationList';
import fetchAndCacheAppData from '../../../utils/fetchAndCacheAppData';
import { DEFAULT_APP_ICON } from '../../../constants/popularApps';
import { WalletContext } from '../../../WalletContext';
import { openUrl } from '../../../utils/openUrl';
import { toast } from 'react-toastify';
import { PermissionToken } from '@bsv/wallet-toolbox-client';

type RevokedOutpoint = { txid: string; outputIndex: number; counterparty?: string };

type SectionMenuProps = {
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  onRevokeEverything?: () => void;
  disabled?: boolean;
};

const SectionMenu = ({ primaryAction, onRevokeEverything, disabled }: SectionMenuProps) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        disabled={!!disabled}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {primaryAction && (
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              primaryAction.onClick();
            }}
            disabled={!!disabled}
          >
            <ListItemIcon>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={primaryAction.label} />
          </MenuItem>
        )}
        {primaryAction && onRevokeEverything && <Divider />}
        {onRevokeEverything && (
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              onRevokeEverything();
            }}
            disabled={!!disabled}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon sx={{ color: 'error.main' }}>
              <DeleteForeverIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Revoke All Permissions For This App"
              primaryTypographyProps={{ fontWeight: 600 }}
            />
          </MenuItem>
        )}
      </Menu>
    </>
  );
};

const AppAccess = () => {
  const { originator: encodedOriginator } = useParams<{ originator: string }>();
  const originator = decodeURIComponent(encodedOriginator);
  const theme = useTheme();
  const lgUp = useMediaQuery(theme.breakpoints.up('lg'));
  const normalizedDomain = useMemo(
    () => originator.replace(/^https?:\/\//, ''),
    [originator]
  );
  const appUrl = useMemo(() => `https://${normalizedDomain}`, [normalizedDomain]);
  const { managers } = useContext(WalletContext);

  type RevokeAction = 'protocol' | 'basket' | 'certificate' | 'spending' | 'everything';
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeAction, setRevokeAction] = useState<RevokeAction | null>(null);

  const revokeMany = useCallback(async (tokens: PermissionToken[], concurrency = 2): Promise<PermissionToken[]> => {
    if (!managers?.permissionsManager) return [];
    if (!tokens.length) return [];

    try {
      const pmAny = managers.permissionsManager as any;
      if (typeof pmAny?.revokePermissions === 'function') {
        return await pmAny.revokePermissions(tokens);
      }
    } catch (error) {
      console.error('bulk revokePermissions failed, falling back to per-token revoke:', error);
    }

    let i = 0;
    const revoked: PermissionToken[] = [];
    const worker = async () => {
      while (true) {
        const idx = i++;
        if (idx >= tokens.length) return;
        const t = tokens[idx];
        try {
          await managers.permissionsManager.revokePermission(t);
          revoked.push(t);
        } catch (error) {
          console.error('failed to revoke permission:', t.txid, error);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, tokens.length) }, () => worker()));
    return revoked;
  }, [managers?.permissionsManager]);

  const revokeAllProtocols = useCallback(async () => {
    if (!managers?.permissionsManager) return;
    const tokens = await managers.permissionsManager.listProtocolPermissions({ originator: normalizedDomain });
    const revoked = await revokeMany(tokens);
    try {
      const revokedOutpoints: RevokedOutpoint[] = revoked.map(t => ({ txid: t.txid, outputIndex: t.outputIndex, counterparty: t.counterparty }));
      window.dispatchEvent(new CustomEvent('protocol-permissions-changed', { detail: { op: 'revoke-all', originator: normalizedDomain, revoked: revokedOutpoints } }));
    } catch { }
  }, [managers?.permissionsManager, normalizedDomain, revokeMany]);

  const revokeAllBaskets = useCallback(async () => {
    if (!managers?.permissionsManager) return;
    const tokens = await managers.permissionsManager.listBasketAccess({ originator: normalizedDomain });
    const revoked = await revokeMany(tokens);
    try {
      const revokedOutpoints: RevokedOutpoint[] = revoked.map(t => ({ txid: t.txid, outputIndex: t.outputIndex }));
      window.dispatchEvent(new CustomEvent('basket-access-changed', { detail: { op: 'revoke-all', originator: normalizedDomain, revoked: revokedOutpoints } }));
    } catch { }
  }, [managers?.permissionsManager, normalizedDomain, revokeMany]);

  const revokeAllCertificates = useCallback(async () => {
    if (!managers?.permissionsManager) return;
    const tokens = await managers.permissionsManager.listCertificateAccess({ originator: normalizedDomain });
    const revoked = await revokeMany(tokens);
    try {
      const revokedOutpoints: RevokedOutpoint[] = revoked.map(t => ({ txid: t.txid, outputIndex: t.outputIndex }));
      window.dispatchEvent(new CustomEvent('cert-access-changed', { detail: { op: 'revoke-all', originator: normalizedDomain, revoked: revokedOutpoints } }));
    } catch { }
  }, [managers?.permissionsManager, normalizedDomain, revokeMany]);

  const revokeSpendingAuthorization = useCallback(async () => {
    if (!managers?.permissionsManager) return;
    const auths = await managers.permissionsManager.listSpendingAuthorizations({ originator: normalizedDomain });
    if (!auths?.length) return;
    await managers.permissionsManager.revokePermission(auths[0]);
    try {
      const revokedOutpoints: RevokedOutpoint[] = [{ txid: auths[0].txid, outputIndex: auths[0].outputIndex }];
      window.dispatchEvent(new CustomEvent('spending-authorization-changed', { detail: { op: 'revoke', originator: normalizedDomain, revoked: revokedOutpoints } }));
    } catch { }
  }, [managers?.permissionsManager, normalizedDomain]);

  const revokeEverything = useCallback(async () => {
    if (!managers?.permissionsManager) return;

    try {
      const pmAny = managers.permissionsManager as any;
      if (typeof pmAny?.revokeAllForOriginator !== 'function') {
        throw new Error('revokeAllForOriginator is not available');
      }

      const revoked = (await pmAny.revokeAllForOriginator(normalizedDomain)) as PermissionToken[];

      const revokedProtocols = revoked.filter(t => typeof (t as any)?.protocol === 'string');
      const revokedBaskets = revoked.filter(t => typeof (t as any)?.basketName === 'string');
      const revokedCertificates = revoked.filter(t => typeof (t as any)?.certType === 'string');
      const revokedSpending = revoked.filter(t => typeof (t as any)?.authorizedAmount === 'number');

      try {
        if (revokedProtocols.length) {
          const revokedOutpoints: RevokedOutpoint[] = revokedProtocols.map(t => ({
            txid: t.txid,
            outputIndex: t.outputIndex,
            counterparty: (t as any).counterparty
          }));
          window.dispatchEvent(new CustomEvent('protocol-permissions-changed', { detail: { op: 'revoke-all', originator: normalizedDomain, revoked: revokedOutpoints } }));
        }
      } catch { }

      try {
        if (revokedBaskets.length) {
          const revokedOutpoints: RevokedOutpoint[] = revokedBaskets.map(t => ({ txid: t.txid, outputIndex: t.outputIndex }));
          window.dispatchEvent(new CustomEvent('basket-access-changed', { detail: { op: 'revoke-all', originator: normalizedDomain, revoked: revokedOutpoints } }));
        }
      } catch { }

      try {
        if (revokedCertificates.length) {
          const revokedOutpoints: RevokedOutpoint[] = revokedCertificates.map(t => ({ txid: t.txid, outputIndex: t.outputIndex }));
          window.dispatchEvent(new CustomEvent('cert-access-changed', { detail: { op: 'revoke-all', originator: normalizedDomain, revoked: revokedOutpoints } }));
        }
      } catch { }

      try {
        if (revokedSpending.length) {
          const revokedOutpoints: RevokedOutpoint[] = revokedSpending.map(t => ({ txid: t.txid, outputIndex: t.outputIndex }));
          window.dispatchEvent(new CustomEvent('spending-authorization-changed', { detail: { op: 'revoke', originator: normalizedDomain, revoked: revokedOutpoints } }));
        }
      } catch { }

      return;
    } catch (error) {
      console.error('bulk revokeAllForOriginator failed, falling back to per-category revoke:', error);
    }

    try { await revokeAllProtocols(); } catch { }
    try { await revokeAllBaskets(); } catch { }
    try { await revokeAllCertificates(); } catch { }
    try { await revokeSpendingAuthorization(); } catch { }
  }, [managers?.permissionsManager, normalizedDomain, revokeAllProtocols, revokeAllBaskets, revokeAllCertificates, revokeSpendingAuthorization]);

  const performRevoke = useCallback(async (action: RevokeAction) => {
    const toastId = toast.loading(action === 'everything' ? 'Revoking all permissions…' : 'Revoking permissions…');
    try {
      if (action === 'protocol') await revokeAllProtocols();
      else if (action === 'basket') await revokeAllBaskets();
      else if (action === 'certificate') await revokeAllCertificates();
      else if (action === 'spending') await revokeSpendingAuthorization();
      else await revokeEverything();
      toast.update(toastId, { render: 'Done.', type: 'success', isLoading: false, autoClose: 2500 });
    } catch (e: unknown) {
      toast.update(toastId, { render: e instanceof Error ? e.message : 'Failed to revoke permissions.', type: 'error', isLoading: false, autoClose: 4000 });
    }
  }, [revokeAllBaskets, revokeAllCertificates, revokeAllProtocols, revokeSpendingAuthorization, revokeEverything]);

  const openRevokeDialog = useCallback((action: RevokeAction) => {
    if (revokeBusy) return;
    setRevokeAction(action);
    setRevokeDialogOpen(true);
  }, [revokeBusy]);

  const confirmRevoke = useCallback(async () => {
    if (!revokeAction || revokeBusy) return;
    setRevokeBusy(true);
    setRevokeDialogOpen(false);
    try {
      await performRevoke(revokeAction);
    } finally {
      setRevokeBusy(false);
      setRevokeAction(null);
    }
  }, [performRevoke, revokeAction, revokeBusy]);

  const [appIcon, setAppIcon] = useState(DEFAULT_APP_ICON);
  const [appName, setAppName] = useState(() => {
    const label = normalizedDomain.split('.')[0] ?? normalizedDomain;
    return label.charAt(0).toUpperCase() + label.slice(1);
  });
  const [copied, setCopied] = useState<{ url?: boolean }>({});
  const [loadingMeta, setLoadingMeta] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setAppIcon(DEFAULT_APP_ICON);
    setLoadingMeta(true);

    fetchAndCacheAppData(
      normalizedDomain,
      icon => {
        if (!cancelled) setAppIcon(icon);
      },
      name => {
        if (!cancelled && name) setAppName(name);
      },
      DEFAULT_APP_ICON
    ).finally(() => {
      if (!cancelled) setLoadingMeta(false);
    });

    return () => {
      cancelled = true;
    };
  }, [normalizedDomain]);

  const handleCopy = useCallback((value: string) => {
    navigator.clipboard.writeText(value);
    setCopied({ url: true });
    window.setTimeout(() => setCopied({}), 2000);
  }, []);

  const handleLaunch = useCallback(() => {
    openUrl(appUrl);
  }, [appUrl]);

  const renderLoading = !managers?.permissionsManager || loadingMeta;

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Dialog
        open={revokeDialogOpen}
        onClose={() => {
          if (!revokeBusy) setRevokeDialogOpen(false);
        }}
      >
        <DialogTitle>Revoke permissions?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {revokeAction === 'everything'
              ? 'This will revoke all permissions for this app.'
              : revokeAction === 'protocol'
                ? 'This will revoke all protocol permissions for this app.'
                : revokeAction === 'basket'
                  ? 'This will revoke all basket access permissions for this app.'
                  : revokeAction === 'certificate'
                    ? 'This will revoke all certificate access permissions for this app.'
                    : 'This will revoke the spending authorization for this app.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeDialogOpen(false)} disabled={revokeBusy}>Cancel</Button>
          <Button onClick={confirmRevoke} color="error" disabled={revokeBusy}>Revoke</Button>
        </DialogActions>
      </Dialog>

      <PageHeader
        title={appName}
        subheading={
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="caption" color="textSecondary" sx={{ wordBreak: 'break-all' }}>
              {appUrl}
            </Typography>
            <IconButton
              size="small"
              onClick={() => handleCopy(appUrl)}
              disabled={!!copied.url}
              sx={{ ml: 0.5 }}
            >
              {copied.url ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Stack>
        }
        icon={appIcon}
        buttonTitle="Launch"
        buttonIcon={<LaunchIcon />}
        onClick={handleLaunch}
      />

      <DetailsSection
        title="Overview"
        subtitle="Recent activity across baskets, protocols, and certificates."
      >
        {renderLoading ? (
          <Box py={6} display="flex" justifyContent="center">
            <CircularProgress />
          </Box>
        ) : (
          <AccessAtAGlance
            originator={normalizedDomain}
          />
        )}
      </DetailsSection>

      <Divider />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h3" color="textPrimary">
          Permissions
        </Typography>
        <SectionMenu
          onRevokeEverything={() => openRevokeDialog('everything')}
          disabled={revokeBusy}
        />
      </Box>

      {lgUp ? (
        <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
          <Stack spacing={3} sx={{ flex: 1, minWidth: 0 }}>
            <DetailsSection
              title="Protocol Permissions"
              subtitle="Apps and counterparties that can use this app through specific protocols."
              actions={
                <SectionMenu
                  primaryAction={{
                    label: 'Revoke All Protocol Permissions',
                    onClick: () => openRevokeDialog('protocol')
                  }}
                  disabled={revokeBusy}
                />
              }
            >
              <ProtocolPermissionList
                app={normalizedDomain}
                itemsDisplayed="protocols"
                showEmptyList
                canRevoke
                displayCount={false}
              />
            </DetailsSection>

            <DetailsSection
              title="Basket Access"
              subtitle="Tokens and baskets this app can view."
              actions={
                <SectionMenu
                  primaryAction={{
                    label: 'Revoke All Basket Access',
                    onClick: () => openRevokeDialog('basket')
                  }}
                  disabled={revokeBusy}
                />
              }
            >
              <BasketAccessList
                app={normalizedDomain}
                itemsDisplayed="baskets"
                showEmptyList
                canRevoke
              />
            </DetailsSection>
          </Stack>

          <Stack spacing={3} sx={{ flex: 1, minWidth: 0 }}>
            <DetailsSection
              title="Spending Authorization"
              subtitle="Monthly spending privileges granted to this app."
            >
              <SpendingAuthorizationList app={normalizedDomain} />
            </DetailsSection>

            <DetailsSection
              title="Certificates Revealed"
              subtitle="Certificate data this app has seen."
              actions={
                <SectionMenu
                  primaryAction={{
                    label: 'Revoke All Certificate Access',
                    onClick: () => openRevokeDialog('certificate')
                  }}
                  disabled={revokeBusy}
                />
              }
            >
              <CertificateAccessList
                app={normalizedDomain}
                itemsDisplayed="certificates"
                type="certificate"
                showEmptyList
                canRevoke
                displayCount={false}
              />
            </DetailsSection>
          </Stack>
        </Box>
      ) : (
        <Stack spacing={3}>
          <DetailsSection
            title="Protocol Permissions"
            subtitle="Apps and counterparties that can use this app through specific protocols."
            actions={
              <SectionMenu
                primaryAction={{
                  label: 'Revoke All Protocol Permissions',
                  onClick: () => openRevokeDialog('protocol')
                }}
                disabled={revokeBusy}
              />
            }
          >
            <ProtocolPermissionList
              app={normalizedDomain}
              itemsDisplayed="protocols"
              showEmptyList
              canRevoke
              displayCount={false}
            />
          </DetailsSection>

          <DetailsSection
            title="Spending Authorization"
            subtitle="Monthly spending privileges granted to this app."
          >
            <SpendingAuthorizationList app={normalizedDomain} />
          </DetailsSection>

          <DetailsSection
            title="Basket Access"
            subtitle="Tokens and baskets this app can view."
            actions={
              <SectionMenu
                primaryAction={{
                  label: 'Revoke All Basket Access',
                  onClick: () => openRevokeDialog('basket')
                }}
                disabled={revokeBusy}
              />
            }
          >
            <BasketAccessList
              app={normalizedDomain}
              itemsDisplayed="baskets"
              showEmptyList
              canRevoke
            />
          </DetailsSection>

          <DetailsSection
            title="Certificates Revealed"
            subtitle="Certificate data this app has seen."
            actions={
              <SectionMenu
                primaryAction={{
                  label: 'Revoke All Certificate Access',
                  onClick: () => openRevokeDialog('certificate')
                }}
                disabled={revokeBusy}
              />
            }
          >
            <CertificateAccessList
              app={normalizedDomain}
              itemsDisplayed="certificates"
              type="certificate"
              showEmptyList
              canRevoke
              displayCount={false}
            />
          </DetailsSection>
        </Stack>
      )}
    </Stack>
  );
};

export default AppAccess;
