import { useState, useEffect, useCallback, useContext, useMemo, useRef, type MouseEvent } from 'react'
import {
  List,
  ListItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Typography,
  Button,
  Paper,
  ListSubheader,
  CircularProgress,
  Stack,
  Box,
  Alert
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { WalletContext } from '../../WalletContext'
import CertificateChip from '../CertificateChip'
import AppChip from '../AppChip'
import sortPermissions from './sortPermissions'
import { toast } from 'react-toastify'
import { PermissionToken } from '@bsv/wallet-toolbox-client'

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

type RevokedOutpoint = { txid?: string; outputIndex?: number }

// Simple cache for certificate permissions
const CERT_CACHE = new Map<string, GrantItem[]>();

interface AppGrant {
  originator: string
  permissions: PermissionToken[]
}

// When the list is not displayed as apps, we assume that the grant is simply a Permission.
type GrantItem = AppGrant | PermissionToken

const isAppGrant = (grant: GrantItem): grant is AppGrant =>
  Array.isArray((grant as AppGrant).permissions)

// Props for the CertificateAccessList component.
interface CertificateAccessListProps {
  app?: string
  itemsDisplayed?: 'certificates' | 'apps'
  counterparty?: string
  type?: string
  certTypeFilter?: string
  limit?: number
  displayCount?: boolean
  listHeaderTitle?: string
  showEmptyList?: boolean
  canRevoke?: boolean
  onEmptyList?: () => void
}

const CertificateAccessList = ({
  app,
  itemsDisplayed = 'certificates',
  counterparty = '',
  type = 'certificate',
  certTypeFilter,
  limit,
  canRevoke = false,
  displayCount = true,
  listHeaderTitle,
  showEmptyList = false,
  onEmptyList = () => { }
}: CertificateAccessListProps) => {
  const navigate = useNavigate()
  // Build stable query key
  const queryKey = useMemo(
    () => JSON.stringify({ app, itemsDisplayed, counterparty, type, certTypeFilter }),
    [app, itemsDisplayed, counterparty, type, certTypeFilter]
  );
  const [grants, setGrants] = useState<GrantItem[]>([])
  const [dialogOpen, setDialogOpen] = useState<boolean>(false)
  const [currentAccessGrant, setCurrentAccessGrant] = useState<PermissionToken | null>(null)
  const [currentApp, setCurrentApp] = useState<AppGrant | null>(null)
  const [dialogLoading, setDialogLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const { managers } = useContext(WalletContext)
  const normalizedApp = useMemo(() => app ? app.replace(/^https?:\/\//, '') : undefined, [app])

  const refreshDebounceRef = useRef<number | null>(null)
  const verifyRefreshRunIdRef = useRef(0)
  const lastRawSignatureRef = useRef<string>('')
  const recentlyRevokedRef = useRef<Map<string, number>>(new Map())
  const REVOKE_TTL_MS = 2 * 60 * 1000

  const applyLimit = useCallback(
    (items: GrantItem[]) => (typeof limit === 'number' ? items.slice(0, limit) : items),
    [limit]
  )

  const revokeMany = useCallback(async (tokens: PermissionToken[], concurrency = 2) => {
    if (!managers?.permissionsManager) return
    if (!tokens.length) return

    try {
      const pmAny = managers.permissionsManager as any
      if (typeof pmAny?.revokePermissions === 'function') {
        await pmAny.revokePermissions(tokens)
        return
      }
    } catch (error) {
      console.error('bulk revokePermissions failed, falling back to per-token revoke:', error)
    }

    let i = 0
    const worker = async () => {
      while (true) {
        const idx = i++
        if (idx >= tokens.length) return
        const t = tokens[idx]
        try {
          await managers.permissionsManager.revokePermission(t)
        } catch (error) {
          console.error(error)
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, tokens.length) }, () => worker()))
  }, [managers?.permissionsManager])

  const signatureFromPermissions = useCallback((permissions: PermissionToken[]) => {
    return permissions
      .map(p => `${p.txid}.${p.outputIndex}.${p.counterparty ?? ''}`)
      .sort()
      .join('|')
  }, [])

  const signatureFromGrants = useCallback((items: GrantItem[]) => {
    const tokens: PermissionToken[] = []
    for (const item of items) {
      if (isAppGrant(item)) {
        tokens.push(...item.permissions)
      } else {
        tokens.push(item as PermissionToken)
      }
    }
    return signatureFromPermissions(tokens)
  }, [signatureFromPermissions])
  const refreshGrants = useCallback(async (force: boolean = false) => {
    try {
      setError(null)
      if (!managers?.permissionsManager) return

      if (!force && CERT_CACHE.has(queryKey)) {
        const cached = CERT_CACHE.get(queryKey)!
        setGrants(applyLimit(cached));
        lastRawSignatureRef.current = signatureFromGrants(cached)
        return;
      }

      // invalidate cache for this key when forcing
      if (force) {
        CERT_CACHE.delete(queryKey)
      }
      const permissionsAll: PermissionToken[] = await managers.permissionsManager.listCertificateAccess({
        originator: normalizedApp
      })

      const now = Date.now()
      for (const [k, ts] of recentlyRevokedRef.current.entries()) {
        if (now - ts > REVOKE_TTL_MS) recentlyRevokedRef.current.delete(k)
      }

      const permissions: PermissionToken[] = permissionsAll.filter(t => {
        const key = `${t.txid}.${t.outputIndex}`
        const ts = recentlyRevokedRef.current.get(key)
        return !ts || now - ts > REVOKE_TTL_MS
      })
      let filtered = counterparty
        ? permissions.filter(perm => perm.counterparty === counterparty)
        : permissions
      if (certTypeFilter) {
        filtered = filtered.filter(perm => perm.certType === certTypeFilter)
      }
      lastRawSignatureRef.current = signatureFromPermissions(filtered)

      if (itemsDisplayed === 'apps') {
        const results = sortPermissions(filtered)
        setGrants(applyLimit(results))
        CERT_CACHE.set(queryKey, results)
      } else {
        const results = filtered as GrantItem[]
        setGrants(applyLimit(results))
        CERT_CACHE.set(queryKey, results)
      }

      if (filtered.length === 0) {
        onEmptyList()
      }
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : 'Unable to load certificate access.'
      setError(message)
    }
  }, [applyLimit, app, counterparty, type, certTypeFilter, limit, itemsDisplayed, onEmptyList, managers?.permissionsManager, queryKey, normalizedApp, signatureFromGrants, signatureFromPermissions])

  const refreshGrantsVerified = useCallback(async (opts?: {
    minAttempts?: number
    requireChange?: boolean
    expectedDifferentFrom?: string
  }) => {
    if (!managers?.permissionsManager) return

    const minAttempts = typeof opts?.minAttempts === 'number' ? Math.max(1, opts.minAttempts) : 2
    const requireChange = !!opts?.requireChange
    const expectedDifferentFrom = typeof opts?.expectedDifferentFrom === 'string' ? opts.expectedDifferentFrom : ''

    const runId = ++verifyRefreshRunIdRef.current
    const delays = [0, 150, 350, 750, 1500, 3000, 6000]
    let prevSig: string | null = null
    let sawChange = !requireChange

    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (runId !== verifyRefreshRunIdRef.current) return
      const delay = delays[attempt]
      if (delay) await sleep(delay)

      try {
        await refreshGrants(true)
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
      } catch (error) {
        console.error('verified certificate refresh failed:', error)
        return
      }
    }
  }, [managers?.permissionsManager, refreshGrants])

  const revokeAccess = async (grant: PermissionToken) => {
    setCurrentAccessGrant(grant)
    setDialogOpen(true)
  }

  const revokeAllAccess = async (appGrant: AppGrant) => {
    setCurrentApp(appGrant)
    setDialogOpen(true)
  }

  // Handle revoke dialog confirmation
  const handleConfirm = async () => {
    try {
      setDialogLoading(true)

      if (!managers?.permissionsManager) {
        throw new Error('Permissions manager is not available.')
      }

      const originator = currentAccessGrant?.originator || currentApp?.originator || normalizedApp

      const revokedOutpoints: RevokedOutpoint[] = []

      if (currentAccessGrant) {
        await managers.permissionsManager.revokePermission(currentAccessGrant)
        revokedOutpoints.push({ txid: currentAccessGrant.txid, outputIndex: currentAccessGrant.outputIndex })
      } else {
        if (!currentApp || !currentApp.permissions) {
          throw new Error('Unable to revoke permissions!')
        }
        for (const p of currentApp.permissions) {
          revokedOutpoints.push({ txid: p.txid, outputIndex: p.outputIndex })
        }
        await revokeMany(currentApp.permissions)
        setCurrentApp(null)
      }

      try {
        window.dispatchEvent(new CustomEvent('cert-access-changed', {
          detail: {
            op: currentAccessGrant ? 'revoke' : 'revoke-all',
            originator,
            revoked: revokedOutpoints
          }
        }))
      } catch {
        // ignore
      }

      setCurrentAccessGrant(null)

      CERT_CACHE.delete(queryKey)
      await refreshGrants(true)

      setDialogOpen(false)
      setDialogLoading(false)
    } catch (e: any) {
      toast.error('Certificate access grant may not have been revoked: ' + e.message)
      await refreshGrants(true) // still try to refresh
      setCurrentAccessGrant(null)
      setCurrentApp(null)
      setDialogOpen(false)
      setDialogLoading(false)
    }
  }

  const handleDialogClose = () => {
    if (dialogLoading) return // prevent closing while in-flight
    setCurrentAccessGrant(null)
    setCurrentApp(null)
    setDialogOpen(false)
  }

  useEffect(() => {
    refreshGrants()
  }, [refreshGrants])

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
        setGrants(prev => {
          const next = prev
            .map(item => {
              if (isAppGrant(item)) {
                const remaining = item.permissions.filter(p => !revoked.some(r => r?.txid === p.txid && r.outputIndex === p.outputIndex))
                return { ...item, permissions: remaining }
              }
              const p = item as PermissionToken
              const remove = revoked.some(r => r?.txid === p.txid && r.outputIndex === p.outputIndex)
              return remove ? null : item
            })
            .filter(Boolean) as GrantItem[]
          return next.filter(i => !isAppGrant(i) || i.permissions.length > 0)
        })
        CERT_CACHE.delete(queryKey)
      }

      if (refreshDebounceRef.current) {
        window.clearTimeout(refreshDebounceRef.current)
      }

      refreshDebounceRef.current = window.setTimeout(() => {
        const op = typeof detail.op === 'string' ? detail.op : ''
        const requireChange = op === 'grant' || op === 'revoke' || op === 'grant-group' || op === 'revoke-all'
        const minAttempts = requireChange ? 2 : 1
        const expectedDifferentFrom = requireChange ? lastRawSignatureRef.current : ''
        void refreshGrantsVerified({ minAttempts, requireChange, expectedDifferentFrom })
      }, 150)
    }

    window.addEventListener('cert-access-changed', handler as EventListener)
    return () => {
      window.removeEventListener('cert-access-changed', handler as EventListener)
      verifyRefreshRunIdRef.current += 1
      if (refreshDebounceRef.current) {
        window.clearTimeout(refreshDebounceRef.current)
        refreshDebounceRef.current = null
      }
    }
  }, [app, queryKey, refreshGrantsVerified])

  if (grants.length === 0 && !showEmptyList) {
    return <></>
  }

  return (
    <>
      <Dialog open={dialogOpen} onClose={handleDialogClose}>
        <DialogTitle>Revoke Access?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You can re-authorize this certificate access grant next time you use this app.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="primary" disabled={dialogLoading} onClick={handleDialogClose}>
            Cancel
          </Button>
          <Button color="primary" disabled={dialogLoading} onClick={handleConfirm} startIcon={dialogLoading ? <CircularProgress size={16} /> : null}>
            Revoke
          </Button>
        </DialogActions>
      </Dialog>

      {error && (
        <Box pb={2}>
          <Alert severity="warning">{error}</Alert>
        </Box>
      )}

      <List disablePadding sx={{ width: '100%' }}>
        {listHeaderTitle && <ListSubheader>{listHeaderTitle}</ListSubheader>}
        {grants.map((grant, i) => {
          if (itemsDisplayed === 'apps' && isAppGrant(grant)) {
            return (
              <ListItem key={`cert-app-${grant.originator}-${i}`} disableGutters sx={{ px: 0, py: 1 }}>
                <Paper elevation={1} sx={{ width: '100%', p: 2 }}>
                  <Stack spacing={1.5}>
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
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            navigate(`/dashboard/app/${encodeURIComponent(grant.originator)}`, {
                              state: { domain: grant.originator }
                            })
                          }}
                        />
                      </Box>

                      {canRevoke && (
                        <Button
                          onClick={() => revokeAllAccess(grant)}
                          color="secondary"
                          sx={{ textTransform: 'none' }}
                        >
                          {grant.permissions.length > 1 ? 'Revoke All' : 'Revoke'}
                        </Button>
                      )}
                    </Stack>

                    <Stack spacing={1}>
                      {grant.permissions.map(permission => (
                        <CertificateChip
                          key={`${permission.txid}-${permission.certType}`}
                          certType={permission.certType}
                          expiry={permission.expiry}
                          canRevoke={canRevoke}
                          onRevokeClick={() => revokeAccess(permission)}
                          certVerifier={permission.verifier}
                          clickable
                          size={1.1}
                        />
                      ))}
                    </Stack>
                  </Stack>
                </Paper>
              </ListItem>
            )
          }

          if (itemsDisplayed !== 'apps') {
            const permission = grant as PermissionToken
            return (
              <ListItem key={`cert-permission-${permission.txid}-${i}`} disableGutters sx={{ px: 0, py: 1 }}>
                <Paper elevation={1} sx={{ width: '100%', p: 2 }}>
                  <CertificateChip
                    certType={permission.certType}
                    expiry={permission.expiry}
                    canRevoke={canRevoke}
                    onRevokeClick={() => revokeAccess(permission)}
                    certVerifier={permission.verifier}
                    clickable
                    size={1.1}
                  />
                </Paper>
              </ListItem>
            )
          }

          return null
        })}
      </List>

      {displayCount && (
        <center>
          <Typography color="textSecondary">
            <i>Total Certificate Access Grants: {grants.length} {limit && `limit: ${limit}`}</i>
          </Typography>
        </center>
      )}
    </>
  )
}

export default CertificateAccessList
