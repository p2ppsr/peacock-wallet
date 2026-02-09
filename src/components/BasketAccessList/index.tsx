import React, { useState, useEffect, useCallback, useContext, useMemo, useRef } from 'react';
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  ListSubheader,
  CircularProgress,
  Typography,
  Stack,
  Paper,
  Alert
} from '@mui/material';
import { toast } from 'react-toastify';
import BasketChip from '../BasketChip';
import { useNavigate } from 'react-router-dom';
import AppChip from '../AppChip';
import { formatDistance } from 'date-fns';
import { WalletContext } from '../../WalletContext'
import AppLogo from '../AppLogo';
import { PermissionToken } from '@bsv/wallet-toolbox-client';

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

type RevokedOutpoint = { txid?: string; outputIndex?: number }

// Simple in-memory cache for basket permissions
const BASKET_CACHE = new Map<string, PermissionToken[]>();

const formatExpiry = (expiry?: number) => {
  // expiry of 0 means never expires - don't show any text
  if (expiry === 0) return undefined;
  
  return typeof expiry === 'number'
    ? formatDistance(new Date(expiry * 1000), new Date(), { addSuffix: true })
    : undefined;
};

interface BasketAccessListProps {
  app?: string;
  basket?: string;
  itemsDisplayed?: 'baskets' | 'apps';
  showEmptyList?: boolean;
  canRevoke?: boolean;
  limit?: number;
}

/**
 * A component for displaying a list of basket permissions as apps with access to a basket, or baskets an app can access.
 */
const BasketAccessList: React.FC<BasketAccessListProps> = ({
  app,
  basket,
  itemsDisplayed = 'baskets',
  showEmptyList = false,
  canRevoke = false,
  limit = 10
}) => {
  // Validate params
  if (itemsDisplayed === 'apps' && app) {
    const e = new Error('Error in BasketAccessList: apps cannot be displayed when providing an app param! Please provide a valid basket instead.');
    throw e;
  }
  if (itemsDisplayed === 'baskets' && basket) {
    const e = new Error('Error in BasketAccessList: baskets cannot be displayed when providing a basket param! Please provide a valid app domain instead.');
    throw e;
  }

  const { managers, adminOriginator } = useContext(WalletContext);
  const permissionsManager = managers.permissionsManager;
  const normalizedApp = useMemo(() => app ? app.replace(/^https?:\/\//, '') : undefined, [app]);

  // Build a stable cache key
  const queryKey = useMemo(() => JSON.stringify({ app, basket, itemsDisplayed, limit }), [app, basket, itemsDisplayed, limit]);
  const [loading, setLoading] = useState<boolean>(true);
  const [listHeaderTitle, setListHeaderTitle] = useState<string | null>(null);

  const [grants, setGrants] = useState<PermissionToken[]>([]);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [currentAccessGrant, setCurrentAccessGrant] = useState<PermissionToken | null>(null);
  const [dialogLoading, setDialogLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const refreshDebounceRef = useRef<number | null>(null)
  const verifyRefreshRunIdRef = useRef(0)
  const lastRawSignatureRef = useRef<string>('')
  const recentlyRevokedRef = useRef<Map<string, number>>(new Map())
  const REVOKE_TTL_MS = 2 * 60 * 1000

  const signatureFromPermissions = useCallback((tokens: PermissionToken[]) => {
    return tokens
      .map(p => `${p.txid}.${p.outputIndex}`)
      .sort()
      .join('|')
  }, [])

  const fetchPermissions = useCallback(async (opts?: { force?: boolean }) => {
    if (!permissionsManager || !adminOriginator) {
      setLoading(false);
      setError('Permissions manager is not available.');
      return;
    }
    // Return cached data if available
    if (!opts?.force && BASKET_CACHE.has(queryKey)) {
      setGrants(BASKET_CACHE.get(queryKey)!);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const tokensAll = await permissionsManager.listBasketAccess({
        basket,
        originator: normalizedApp
      })

      const now = Date.now()
      for (const [k, ts] of recentlyRevokedRef.current.entries()) {
        if (now - ts > REVOKE_TTL_MS) recentlyRevokedRef.current.delete(k)
      }

      const tokens = tokensAll.filter(t => {
        const key = `${t.txid}.${t.outputIndex}`
        const ts = recentlyRevokedRef.current.get(key)
        return !ts || now - ts > REVOKE_TTL_MS
      })

      lastRawSignatureRef.current = signatureFromPermissions(tokens)

      // Transform tokens into grants with necessary display properties
      const grants = tokens.map((token: PermissionToken) => {
        // Extract the domain from the token
        const domain = token.originator || 'unknown';

        return {
          ...token,
          domain,
          basket: (token as any).basketName, // TODO: Update permission token type in wallet toolbox!
        };
      });

      setGrants(grants);
      // cache for future
      BASKET_CACHE.set(queryKey, grants);
      if (grants.length === 0) {
        setListHeaderTitle('No access grants found');
      }
    } catch (error) {
      console.error('Failed to refresh grants:', error);
      const message = error instanceof Error ? error.message : 'Failed to load access list.';
      setError(message);
      toast.error(`Failed to load access list: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [permissionsManager, adminOriginator, queryKey, basket, app, limit, normalizedApp]);

  const revokeAccess = async (grant?: PermissionToken) => {
    if (!permissionsManager) {
      toast.error('Permissions manager is not available.');
      return;
    }
    try {
      setDialogLoading(true);
      if (grant) {
        // Revoke the specific grant passed as parameter
        await permissionsManager.revokePermission(grant);
      } else if (currentAccessGrant) {
        // Revoke the current access grant from dialog
        await permissionsManager.revokePermission(currentAccessGrant);
      }
      BASKET_CACHE.delete(queryKey);
      // Refresh the list after revoking
      await fetchPermissions({ force: true });

      try {
        window.dispatchEvent(new CustomEvent('basket-access-changed', {
          detail: {
            op: 'revoke',
            originator: normalizedApp || app,
            revoked: grant
              ? [{ txid: grant.txid, outputIndex: grant.outputIndex }]
              : currentAccessGrant
                ? [{ txid: currentAccessGrant.txid, outputIndex: currentAccessGrant.outputIndex }]
                : []
          }
        }))
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('Failed to revoke access:', error);
    } finally {
      setDialogLoading(false);
      setDialogOpen(false);
      setCurrentAccessGrant(null);
    }
  };

  const openRevokeDialog = (grant: PermissionToken) => {
    setCurrentAccessGrant(grant);
    setDialogOpen(true);
  };

  const handleConfirm = async () => {
    await revokeAccess();
  };

  const handleDialogClose = () => {
    setCurrentAccessGrant(null);
    setDialogOpen(false);
  };

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  useEffect(() => {
    const fetchPermissionsVerified = async (o?: {
      minAttempts?: number
      requireChange?: boolean
      expectedDifferentFrom?: string
    }) => {
      if (!permissionsManager || !adminOriginator) return

      const minAttempts = typeof o?.minAttempts === 'number' ? Math.max(1, o.minAttempts) : 2
      const requireChange = !!o?.requireChange
      const expectedDifferentFrom = typeof o?.expectedDifferentFrom === 'string' ? o.expectedDifferentFrom : ''

      const runId = ++verifyRefreshRunIdRef.current
      const delays = [0, 150, 350, 750, 1500, 3000, 6000]
      let prevSig: string | null = null
      let sawChange = !requireChange

      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (runId !== verifyRefreshRunIdRef.current) return
        const delay = delays[attempt]
        if (delay) await sleep(delay)

        try {
          BASKET_CACHE.delete(queryKey)
          await fetchPermissions({ force: true })
          if (runId !== verifyRefreshRunIdRef.current) return

          const sig = lastRawSignatureRef.current
          if (!sawChange && sig !== expectedDifferentFrom) {
            sawChange = true
          }

          if (!sawChange) {
            prevSig = sig
            continue
          }

          if (attempt + 1 < minAttempts) {
            prevSig = sig
            continue
          }

          if (prevSig !== null && sig === prevSig) {
            return
          }
          prevSig = sig
        } catch (err) {
          console.error('verified basket refresh failed:', err)
          return
        }
      }
    }

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail || {}
      if (app) {
        const norm = app.replace(/^https?:\/\//, '')
        const detailOriginator = typeof detail.originator === 'string'
          ? detail.originator.replace(/^https?:\/\//, '')
          : undefined
        if (detailOriginator && detailOriginator !== norm) return
      }

      const revoked: RevokedOutpoint[] = Array.isArray(detail.revoked) ? detail.revoked : []
      if (revoked.length) {
        const now = Date.now()
        for (const r of revoked) {
          if (!r?.txid || typeof r.outputIndex !== 'number') continue
          recentlyRevokedRef.current.set(`${r.txid}.${r.outputIndex}`, now)
        }
        setGrants(prev => prev.filter(p => !revoked.some(r => r?.txid === p.txid && r.outputIndex === p.outputIndex)))
        BASKET_CACHE.delete(queryKey)
      }

      if (refreshDebounceRef.current) {
        window.clearTimeout(refreshDebounceRef.current)
      }

      refreshDebounceRef.current = window.setTimeout(() => {
        const op = typeof detail.op === 'string' ? detail.op : ''
        const requireChange = op === 'grant' || op === 'revoke' || op === 'grant-group'
        const minAttempts = requireChange ? 2 : 1
        const expectedDifferentFrom = requireChange ? lastRawSignatureRef.current : ''
        void fetchPermissionsVerified({ minAttempts, requireChange, expectedDifferentFrom })
      }, 150)
    }

    window.addEventListener('basket-access-changed', handler as EventListener)
    return () => {
      window.removeEventListener('basket-access-changed', handler as EventListener)
      verifyRefreshRunIdRef.current += 1
      if (refreshDebounceRef.current) {
        window.clearTimeout(refreshDebounceRef.current)
        refreshDebounceRef.current = null
      }
    }
  }, [app, adminOriginator, fetchPermissions, permissionsManager, queryKey])

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={4}>
            <Box p={3} display="flex" justifyContent="center" alignItems="center"><AppLogo rotate size={50} /></Box>
            <Typography variant="body2" color="textSecondary" sx={{ ml: 2 }}>
              Loading baskets...
            </Typography>
          </Box>
    );
  }

  if (grants.length === 0 && !showEmptyList) {
    return null;
  }

  return (
    <>
      <Dialog open={dialogOpen}>
        <DialogTitle color='textPrimary'>
          Revoke Access?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            You can re-authorize this access grant next time you use this app.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            color='primary'
            disabled={dialogLoading}
            onClick={handleDialogClose}
          >
            Cancel
          </Button>
          <Button
            color='primary'
            disabled={dialogLoading}
            onClick={handleConfirm}
          >
            {dialogLoading ? <CircularProgress size={24} color='inherit' /> : 'Revoke'}
          </Button>
        </DialogActions>
      </Dialog>
      {listHeaderTitle && (
        <ListSubheader>
          {listHeaderTitle}
        </ListSubheader>
      )}

      <Stack spacing={1.5}>
        {error && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}
        {grants.map((grant, index) => {
          const expiryLabel = formatExpiry(grant.expiry);
          const basketIdentifier =
            (grant as any).basketName ||
            (grant as any).basket ||
            (grant as any).basketID ||
            'Unknown basket';

          return (
            <Paper key={`${grant.txid}-${index}`} elevation={1} sx={{ p: 2 }}>
              {itemsDisplayed === 'apps' ? (
                <Stack spacing={1}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <AppChip
                        label={grant.originator}
                        showDomain
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          navigate(`/dashboard/app/${encodeURIComponent(grant.originator)}`, {
                            state: {
                              domain: grant.originator
                            }
                          });
                        }}
                        onCloseClick={canRevoke ? () => openRevokeDialog(grant) : undefined}
                        backgroundColor='default'
                        expires={expiryLabel}
                      />
                    </Box>
                    {canRevoke && (
                      <Button
                        onClick={() => openRevokeDialog(grant)}
                        color="secondary"
                        sx={{ textTransform: 'none' }}
                      >
                        Revoke
                      </Button>
                    )}
                  </Stack>
                  <Typography variant="caption" color="textSecondary">
                    Basket: {basketIdentifier}
                  </Typography>
                </Stack>
              ) : (
                <Stack spacing={1}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <BasketChip
                        basketId={basketIdentifier}
                        clickable
                        expires={expiryLabel}
                        onCloseClick={canRevoke ? () => openRevokeDialog(grant) : undefined}
                        canRevoke={canRevoke}
                        layout="compact"
                      />
                    </Box>
                    {canRevoke && (
                      <Button
                        onClick={() => openRevokeDialog(grant)}
                        color="secondary"
                        sx={{ textTransform: 'none' }}
                      >
                        Revoke
                      </Button>
                    )}
                  </Stack>
                  <Typography variant="caption" color="textSecondary">
                    Granted to: {grant.originator}
                  </Typography>
                </Stack>
              )}
            </Paper>
          );
        })}
      </Stack>
    </>
  );
};

export default BasketAccessList;
