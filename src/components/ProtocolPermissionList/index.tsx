import React, { useState, useEffect, useCallback, useContext, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  List,
  ListItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Typography,
  ListSubheader,
  CircularProgress,
  Box,
  Paper,
  Stack,
  Alert,
} from '@mui/material';
import { toast } from 'react-toastify';
import { formatDistance } from 'date-fns';

// Local components & utilities
import ProtoChip from '../ProtoChip';
import AppChip from '../AppChip';
import CounterpartyChip from '../CounterpartyChip';

// Wallet context (replace with the actual path)
import { WalletContext } from '../../WalletContext';
import { PermissionToken } from '@bsv/wallet-toolbox-client';
import AppLogo from '../AppLogo';

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

type RevokedOutpoint = { txid?: string; outputIndex?: number; counterparty?: string };
/* -------------------------------------------------------------------------- */
/*                              Types & Helpers                               */
/* -------------------------------------------------------------------------- */

/**
 * Grouped permission when the list is rendered in **app‑centric** view
 */
interface AppPermissionGroup {
  /** Application (originator) domain */
  originator: string;
  /** All permissions for this application (unique counterparties) */
  permissions: PermissionToken[];
}

/**
 * Grouped permission when the list is rendered in **protocol‑centric** view
 */
interface ProtocolPermissionGroup {
  /** Protocol identifier (e.g. "todo tokens") */
  protocolName: string;
  /** Associated security level */
  securityLevel: number;
  /** All permissions for this protocol/security level (unique counterparties) */
  permissions: PermissionToken[];
  /** Preserved original app name for display consistency */
  _displayOriginator?: string;
}

/**
 * Union type to cover both grouping modes so we can share state easily
 */
type PermissionGroup = AppPermissionGroup | ProtocolPermissionGroup;

/**
 * Props for <ProtocolPermissionList />
 */
export interface ProtocolPermissionListProps {
  /** App domain to filter permissions by (mutually exclusive with `protocol`) */
  app?: string;
  /** Maximum number of groups to display */
  limit?: number;
  /** Protocol ID to filter permissions by (mutually exclusive with `app`) */
  protocol?: string;
  /** Optional security level filter */
  securityLevel?: number;
  /** Counter‑party DID / address to filter by */
  counterparty?: string;
  /** Choose whether the list is grouped by protocol or by application */
  itemsDisplayed?: 'protocols' | 'apps';
  /** Show revoke buttons */
  canRevoke?: boolean;
  /** Display a numeric total below the list */
  displayCount?: boolean;
  /** Optional header text */
  listHeaderTitle?: string;
  /** Render an empty placeholder instead of returning `null` */
  showEmptyList?: boolean;
  /** Make the list items clickable */
  clickable?: boolean;
  /** Callback when the list is empty (e.g. collapse parent) */
  onEmptyList?: () => void;
}

/* -------------------------------------------------------------------------- */
/*                                 Styles                                      */
/* -------------------------------------------------------------------------- */

// NOTE: replace – or extend – with your own JSS if you have an existing
// `./style` export you want to build upon.

/* -------------------------------------------------------------------------- */
/*                                Utilities                                    */
/* -------------------------------------------------------------------------- */

/**
 * Groups permissions by **application domain** (originator). Only one permission
 * is kept per counter‑party to avoid duplicates.
 */
function groupPermissionsByApp(tokens: PermissionToken[]): AppPermissionGroup[] {
  const map = new Map<string, PermissionToken[]>();

  tokens.forEach((token) => {
    const key = token.originator;

    const list = map.get(key) ?? [];
    // Only add if this counterparty hasn't already been seen for the app
    if (!list.some((p) => p.counterparty === token.counterparty)) {
      list.push(token);
      map.set(key, list);
    }
  });

  return Array.from(map.entries()).map(([originator, permissions]) => ({
    originator,
    permissions,
  }));
}

/**
 * Groups permissions by **protocol & security level**. Only one permission is
 * kept per counter‑party to avoid duplicates.
 */
function groupPermissionsByProtocol(tokens: PermissionToken[]): ProtocolPermissionGroup[] {
  // Composite key ensures uniqueness for protocol + security level combo
  const map = new Map<string, ProtocolPermissionGroup>();

  tokens.forEach((token) => {
    const key = JSON.stringify({ protocol: token.protocol, securityLevel: token.securityLevel });

    let entry = map.get(key);
    if (!entry) {
      entry = {
        protocolName: token.protocol,
        securityLevel: token.securityLevel ?? 0,
        permissions: [],
      };
      map.set(key, entry);
    }

    // Deduplicate by counterparty
    if (!entry.permissions.some((p) => p.counterparty === token.counterparty)) {
      entry.permissions.push(token);
    }
  });

  return Array.from(map.values());
}

const formatExpiry = (expiry?: number) => {
  // expiry of 0 means never expires - don't show any text
  if (expiry === 0) return undefined;
  
  return typeof expiry === 'number'
    ? formatDistance(new Date(expiry * 1000), new Date(), { addSuffix: true })
    : undefined;
};

/* -------------------------------------------------------------------------- */
/*                            Simple In-Memory Cache                           */
/* -------------------------------------------------------------------------- */
// Keyed by a JSON-stringified query descriptor
const PERM_CACHE = new Map<string, PermissionGroup[]>();

/* -------------------------------------------------------------------------- */
/*                              Main Component                                 */
/* -------------------------------------------------------------------------- */

/**
 * Lists protocol‑permission relationships (either: which apps can access a
 * protocol, **or** which protocols an app has access to). Fully typed with strict
 * deduplication and predictable rendering.
 */
const ProtocolPermissionList: React.FC<ProtocolPermissionListProps> = ({
  app,
  limit,
  protocol,
  securityLevel,
  counterparty,
  itemsDisplayed = 'protocols',
  clickable = false,
  canRevoke = false,
  displayCount = true,
  listHeaderTitle,
  showEmptyList = false,
  onEmptyList = () => {
    /* noop */
  },
}) => {
  /* ---------------------------- Memo Key ---------------------------- */
  const queryKey = useMemo(
    () =>
      JSON.stringify({ app, protocol, securityLevel, counterparty, itemsDisplayed, limit }),
    [app, protocol, securityLevel, counterparty, itemsDisplayed, limit]
  );

  /* ---------------------------- Runtime state ---------------------------- */
  const [perms, setPerms] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [toRevoke, setToRevoke] = useState<PermissionToken | PermissionGroup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshDebounceRef = useRef<number | null>(null)
  const verifyRefreshRunIdRef = useRef(0)
  const lastRawSignatureRef = useRef<string>('')
  const recentlyRevokedRef = useRef<Map<string, number>>(new Map())
  const REVOKE_TTL_MS = 2 * 60 * 1000

  /* ----------------------------- Context ------------------------------ */
  const { managers } = useContext(WalletContext);

  /* -----------------------------  Hooks  ------------------------------ */
  const navigate = useNavigate();

  /* ---------------------------  Helpers  ----------------------------- */
  const signatureFromPermissions = useCallback((tokens: PermissionToken[]) => {
    return tokens
      .map(p => `${p.txid}.${p.outputIndex}.${p.counterparty ?? ''}`)
      .sort()
      .join('|')
  }, [])

  const refreshPerms = useCallback(async (opts?: { force?: boolean }) => {
    if (!managers?.permissionsManager) return;

    // Return cached results if present
    if (!opts?.force && PERM_CACHE.has(queryKey)) {
      setPerms(PERM_CACHE.get(queryKey)!);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      // Fetch permission tokens from wallet SDK
       const normalizedApp = app ? app.replace(/^https?:\/\//, '') : app;
      const rawAll = await managers.permissionsManager.listProtocolPermissions({
        originator: normalizedApp,
        // privileged: false, // TODO: add support at the component level
        protocolName: protocol,
        protocolSecurityLevel: securityLevel,
        counterparty
      });

      const now = Date.now()
      for (const [k, ts] of recentlyRevokedRef.current.entries()) {
        if (now - ts > REVOKE_TTL_MS) recentlyRevokedRef.current.delete(k)
      }

      const raw = rawAll.filter(t => {
        const key = `${t.txid}.${t.outputIndex}`
        const ts = recentlyRevokedRef.current.get(key)
        return !ts || now - ts > REVOKE_TTL_MS
      })

      lastRawSignatureRef.current = signatureFromPermissions(raw)

      // Group & optionally limit results
      const grouped: PermissionGroup[] =
        itemsDisplayed === 'apps'
          ? groupPermissionsByApp(raw)
          : groupPermissionsByProtocol(raw);

      const finalGroups = limit ? grouped.slice(0, limit) : grouped;
      setPerms(finalGroups);
      // Cache the result
      PERM_CACHE.set(queryKey, finalGroups);
      if (grouped.length === 0) onEmptyList();
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : 'Unable to load protocol permissions.'
      setError(message)
    } finally {
      setLoading(false);
    }
  }, [app, protocol, securityLevel, counterparty, limit, itemsDisplayed, managers?.permissionsManager, onEmptyList, queryKey, signatureFromPermissions]);

  const refreshPermsVerified = useCallback(async (o?: {
    minAttempts?: number
    requireChange?: boolean
    expectedDifferentFrom?: string
  }) => {
    if (!managers?.permissionsManager) return

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
        PERM_CACHE.delete(queryKey)
        await refreshPerms({ force: true })
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
        console.error('verified protocol refresh failed:', err)
        return
      }
    }
  }, [managers?.permissionsManager, queryKey, refreshPerms])

  /**
   * Optimistically update the UI by removing revoked permissions from the current state
   * without refetching from the API. This provides instant feedback to the user.
   */
  const updateUIAfterRevoke = useCallback((revokedPermissions: PermissionToken[]) => {
    if (revokedPermissions.length === 0) return;

    const updatedPerms = perms.map(group => {
      if (isAppGroup(group) || isProtocolGroup(group)) {
        // For grouped permissions, filter out revoked ones
        const remainingPermissions = group.permissions.filter(perm =>
          !revokedPermissions.some(revoked =>
            revoked.txid === perm.txid && revoked.counterparty === perm.counterparty
          )
        );

        // If no permissions remain in this group, it will be filtered out below
        return {
          ...group,
          permissions: remainingPermissions
        };
      } else {
        // This should never happen with current types, but handle individual permissions
        // by treating the group as a PermissionToken
        const permissionToken = group as PermissionToken;
        const shouldRemove = revokedPermissions.some(revoked =>
          revoked.txid === permissionToken.txid && revoked.counterparty === permissionToken.counterparty
        );
        return shouldRemove ? null : group;
      }
    }).filter((group): group is PermissionGroup => {
      // Remove null entries and groups with no remaining permissions
      if (!group) return false;
      if (isAppGroup(group) || isProtocolGroup(group)) {
        return group.permissions.length > 0;
      }
      return true;
    });

    setPerms(updatedPerms);
    // Update cache with the new state
    PERM_CACHE.set(queryKey, updatedPerms);

    // Check if list is now empty and call callback
    if (updatedPerms.length === 0) {
      onEmptyList();
    }
  }, [perms, queryKey, onEmptyList]);

  const openRevokeDialog = (item: PermissionToken | PermissionGroup) => {
    setToRevoke(item);
    setDialogOpen(true);
  };

  const handleConfirmRevoke = async () => {
    if (!managers?.permissionsManager || !toRevoke) return;

    // Store the original permissions for potential rollback
    const originalPerms = [...perms];
    const revokedPermissions: PermissionToken[] = [];

    try {
      setDialogLoading(true);

      if ('permissions' in toRevoke) {
        console.log('revoking group', toRevoke)
        // Revoke permissions sequentially to avoid overwhelming the service
        const results = [];
        for (const perm of toRevoke.permissions) {
          try {
            console.log('revoking individual permission in group:', perm.txid)
            await managers.permissionsManager.revokePermission(perm);
            console.log('successfully revoked:', perm.txid)
            results.push({ success: true, permission: perm });
            revokedPermissions.push(perm);
          } catch (error) {
            console.error('failed to revoke permission:', perm.txid, error);
            results.push({ success: false, permission: perm, error });
            // Continue with other permissions even if one fails
          }
        }

        const failed = results.filter(r => !r.success);
        if (failed.length > 0) {
          console.warn(`${failed.length} out of ${results.length} permissions failed to revoke`);
        }
      } else {
        console.log('revoking single permission', toRevoke)
        await managers.permissionsManager.revokePermission(toRevoke);
        revokedPermissions.push(toRevoke);
      }

      // Optimistically update the UI by removing revoked permissions
      updateUIAfterRevoke(revokedPermissions);

      try {
        const revokedOutpoints: RevokedOutpoint[] = revokedPermissions.map(t => ({
          txid: t.txid,
          outputIndex: t.outputIndex,
          counterparty: t.counterparty
        }))

        const originatorForEvent = (() => {
          if (app) return app.replace(/^https?:\/\//, '')
          if (revokedPermissions[0]?.originator) return revokedPermissions[0].originator
          if ('permissions' in toRevoke && (toRevoke as any)?.originator) return (toRevoke as any).originator
          const first = (revokedPermissions[0] as any)
          return first?.originator
        })()

        window.dispatchEvent(new CustomEvent('protocol-permissions-changed', {
          detail: {
            op: ('permissions' in (toRevoke as any)) ? 'revoke-all' : 'revoke',
            originator: originatorForEvent,
            revoked: revokedOutpoints
          }
        }))
      } catch {
        // ignore
      }

    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
      toast.error(`Permission may not have been revoked: ${errorMessage}`);
      // Rollback to original state on error
      setPerms(originalPerms);
      PERM_CACHE.set(queryKey, originalPerms);
    } finally {
      setDialogLoading(false);
      setDialogOpen(false);
      setToRevoke(null);
    }
  };

  /* ---------------------------- Lifecycle ---------------------------- */
  useEffect(() => {
    refreshPerms();
  }, [refreshPerms]);

  useEffect(() => {
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

        setPerms(prev => {
          const next = prev
            .map(group => {
              if (isAppGroup(group) || isProtocolGroup(group)) {
                const remaining = group.permissions.filter(p => !revoked.some(r => r?.txid === p.txid && r.outputIndex === p.outputIndex))
                return { ...group, permissions: remaining } as PermissionGroup
              }
              return group
            })
            .filter(group => {
              if (isAppGroup(group) || isProtocolGroup(group)) return group.permissions.length > 0
              return true
            })
          return next
        })

        PERM_CACHE.delete(queryKey)
      }

      if (refreshDebounceRef.current) {
        window.clearTimeout(refreshDebounceRef.current)
      }

      refreshDebounceRef.current = window.setTimeout(() => {
        const op = typeof detail.op === 'string' ? detail.op : ''
        const requireChange = op === 'grant' || op === 'revoke' || op === 'grant-group' || op === 'revoke-all'
        const minAttempts = requireChange ? 2 : 1
        const expectedDifferentFrom = requireChange ? lastRawSignatureRef.current : ''
        void refreshPermsVerified({ minAttempts, requireChange, expectedDifferentFrom })
      }, 150)
    }

    window.addEventListener('protocol-permissions-changed', handler as EventListener)
    return () => {
      window.removeEventListener('protocol-permissions-changed', handler as EventListener)
      verifyRefreshRunIdRef.current += 1
      if (refreshDebounceRef.current) {
        window.clearTimeout(refreshDebounceRef.current)
        refreshDebounceRef.current = null
      }
    }
  }, [app, queryKey, refreshPermsVerified])

  /* ---------------------------- Early exit ---------------------------- */
  if (perms.length === 0 && !showEmptyList) return null;

  /* ---------------------------  Render  ------------------------------ */
  return (
    <>
      {/* ---------------- Revoke confirmation dialog ---------------- */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle color="textPrimary">Revoke Permission?</DialogTitle>
        <DialogContent>
          <DialogContentText color="textSecondary">
            You can re-authorize this permission the next time you use the app.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="primary" disabled={dialogLoading} onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            color="primary"
            disabled={dialogLoading}
            onClick={handleConfirmRevoke}
            startIcon={dialogLoading ? <CircularProgress size={16} /> : null}
          >
            Revoke
          </Button>
        </DialogActions>
      </Dialog>

      {/* ------------------------- Permission list ------------------------- */}
      {error && (
        <Box pb={2}>
          <Alert severity="warning" sx={{ mb: 1 }}>
            {error}
          </Alert>
        </Box>
      )}

      <List disablePadding sx={{ width: '100%' }}>
        {listHeaderTitle && <ListSubheader>{listHeaderTitle}</ListSubheader>}

        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" py={4}>
            <Box p={3} display="flex" justifyContent="center" alignItems="center">
              <AppLogo rotate size={50} />
            </Box>
            <Typography variant="body2" color="textSecondary" sx={{ ml: 2 }}>
              Loading permissions...
            </Typography>
          </Box>
        ) : (
          perms.map((group, i) => {
            if (itemsDisplayed === 'apps' && isAppGroup(group)) {
              return (
                <ListItem key={`app-group-${group.originator}-${i}`} disableGutters sx={{ px: 0, py: 1 }}>
                  <Paper elevation={1} sx={{ width: '100%', p: 2 }}>
                    <Stack spacing={1.5}>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        alignItems={{ xs: 'flex-start', sm: 'center' }}
                        justifyContent="space-between"
                        spacing={1}
                        sx={{ width: '100%' }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <AppChip
                            backgroundColor="default"
                            label={group.originator}
                            showDomain
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              navigate(`/dashboard/app/${encodeURIComponent(group.originator)}`, {
                                state: {
                                  domain: group.originator,
                                  appName: group.originator
                                }
                              });
                            }}
                          />
                        </Box>

                        {canRevoke && (
                          <Button
                            onClick={() => openRevokeDialog(group)}
                            color="secondary"
                            sx={{ textTransform: 'none' }}
                          >
                            {group.permissions.length > 1 ? 'Revoke All' : 'Revoke'}
                          </Button>
                        )}
                      </Stack>

                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        flexWrap="wrap"
                      >
                        {group.permissions
                          .filter((x) => x.counterparty)
                          .map((permission) => (
                            <CounterpartyChip
                              key={`${permission.counterparty}-${permission.txid}`}
                              counterparty={permission.counterparty!}
                              size={1.05}
                              expires={formatExpiry(permission.expiry)}
                              onCloseClick={() => openRevokeDialog(permission)}
                              clickable
                              canRevoke={canRevoke}
                              layout="compact"
                            />
                          ))}
                      </Stack>
                    </Stack>
                  </Paper>
                </ListItem>
              );
            }

            if (itemsDisplayed === 'protocols' && isProtocolGroup(group)) {
              return (
                <ListItem key={`protocol-group-${group.protocolName}-${group.securityLevel}-${i}`} disableGutters sx={{ px: 0, py: 1 }}>
                  <Paper elevation={1} sx={{ width: '100%', p: 2 }}>
                    <Stack spacing={1.5}>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        alignItems={{ xs: 'flex-start', sm: 'center' }}
                        justifyContent="space-between"
                        spacing={1}
                        sx={{ width: '100%' }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <ProtoChip
                            backgroundColor="default"
                            protocolID={group.protocolName}
                            securityLevel={group.securityLevel}
                            originator={group._displayOriginator || group.permissions[0].originator}
                            clickable={clickable}
                            canRevoke={false}
                            layout="compact"
                          />
                        </Box>

                        {canRevoke && (
                          <Button
                            onClick={() => openRevokeDialog(group)}
                            color="secondary"
                            sx={{ textTransform: 'none' }}
                          >
                            {group.permissions.length > 1 ? 'Revoke All' : 'Revoke'}
                          </Button>
                        )}
                      </Stack>

                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        flexWrap="wrap"
                      >
                        {group.permissions.map((permission) =>
                          counterparty ? (
                            <AppChip
                              key={`app-${permission.txid}-${permission.originator}`}
                              backgroundColor="default"
                              label={permission.originator}
                              showDomain
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                navigate(`/dashboard/app/${encodeURIComponent(permission.originator)}`, {
                                  state: { domain: permission.originator },
                                });
                              }}
                              onCloseClick={() => openRevokeDialog(permission)}
                            />
                          ) : (
                            <CounterpartyChip
                              key={`${permission.counterparty}-${permission.txid}`}
                              counterparty={permission.counterparty!}
                              size={1.05}
                              expires={formatExpiry(permission.expiry)}
                              onCloseClick={() => openRevokeDialog(permission)}
                              clickable
                              canRevoke={canRevoke}
                              layout="compact"
                            />
                          )
                        )}
                      </Stack>
                    </Stack>
                  </Paper>
                </ListItem>
              );
            }

            return null;
          })
        )}
      </List>

      {/* ------------------------- Footer – total count ------------------------- */}
      {displayCount && (
        <center>
          <Typography color="textSecondary">
            <i>Total Protocol Grants: {perms.length}</i>
          </Typography>
        </center>
      )}
    </>
  );
};

export default ProtocolPermissionList;

/* -------------------------------------------------------------------------- */
/*                          Type‑Guard Helper Fns                              */
/* -------------------------------------------------------------------------- */
function isAppGroup(group: PermissionGroup): group is AppPermissionGroup {
  return (group as AppPermissionGroup).originator !== undefined;
}

function isProtocolGroup(group: PermissionGroup): group is ProtocolPermissionGroup {
  return (group as ProtocolPermissionGroup).protocolName !== undefined;
}
