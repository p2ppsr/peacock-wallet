import { useState, useEffect, useContext, useMemo, useCallback, type ReactNode } from 'react'
import {
  DialogContent,
  DialogActions,
  Button,
  Typography,
  CircularProgress,
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Checkbox,
  TextField,
  FormControlLabel,
  InputAdornment
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CustomDialog from '../CustomDialog'
import { WalletContext, WalletContextValue } from '../../WalletContext'
import { UserContext, UserContextValue } from '../../UserContext'
import AppChip from '../AppChip'
import ProtoChip from '../ProtoChip'
import CertificateChip from '../CertificateChip'
import BasketChip from '../BasketChip'
import CounterpartyChip from '../CounterpartyChip'
import AmountDisplay from '../AmountDisplay'
import { ExchangeRateContext } from '../AmountDisplay/ExchangeRateContextProvider'
import type { GroupedPermissions } from '@bsv/wallet-toolbox-client'
import { isSupportedFiatCurrency } from '../../utils/currency'

// Local type definitions for group permissions
type ProtocolPermission = {
  protocolID: [number, string]
  counterparty?: string
  description?: string
}

type BasketAccess = {
  basket: string
  description?: string
}

type CertificateAccess = {
  type: string
  fields?: string[]
  verifierPublicKey?: string
  description?: string
}

type SpendingAuthorization = {
  amount: number
  description?: string
}

// We use the structure of requests from the wallet context
// Each request contains requestID, originator and groupPermissions

const GroupPermissionHandler = () => {
  const {
    groupPermissionRequests,
    advanceGroupQueue,
    managers,
    settings
  } = useContext<WalletContextValue>(WalletContext)

  const {
    groupPermissionModalOpen
  } = useContext<UserContextValue>(UserContext)

  const rates = useContext<any>(ExchangeRateContext)
  const { satoshisPerUSD, fiatPerUSD } = rates || {}

  const rawCurrency: string = String(
    (settings as any)?.currency ??
    (settings as any)?.fiatCurrency ??
    (settings as any)?.displayCurrency ??
    ''
  ).toUpperCase()

  type Unit =
    | { kind: 'sats' }
    | { kind: 'bsv' }
    | { kind: 'fiat'; code: string }

  const unit: Unit = useMemo(() => {
    if (/SAT/i.test(rawCurrency)) return { kind: 'sats' }
    if (rawCurrency === 'BSV' || /BITCOIN/i.test(rawCurrency)) return { kind: 'bsv' }
    if (isSupportedFiatCurrency(rawCurrency)) return { kind: 'fiat', code: rawCurrency }
    return { kind: 'sats' }
  }, [rawCurrency])

  const fiatRatesReady = useMemo(() => {
    if (unit.kind !== 'fiat') return true
    return !!satoshisPerUSD && typeof fiatPerUSD?.[unit.code] === 'number'
  }, [unit, satoshisPerUSD, fiatPerUSD])

  const [originator, setOriginator] = useState('')
  const [requestID, setRequestID] = useState<string | null>(null)
  const [spendingAuthorization, setSpendingAuthorization] = useState<SpendingAuthorization | undefined>(undefined)
  const [protocolPermissions, setProtocolPermissions] = useState<ProtocolPermission[]>([])
  const [basketAccess, setBasketAccess] = useState<BasketAccess[]>([])
  const [certificateAccess, setCertificateAccess] = useState<CertificateAccess[]>([])
  const [checkedProtocolKeys, setCheckedProtocolKeys] = useState<Set<string>>(new Set())
  const [checkedBasketKeys, setCheckedBasketKeys] = useState<Set<string>>(new Set())
  const [checkedCertificateKeys, setCheckedCertificateKeys] = useState<Set<string>>(new Set())
  const [spendingEnabled, setSpendingEnabled] = useState<boolean>(false)
  const [spendingAmount, setSpendingAmount] = useState<string>('')
  const [spendingAmountSats, setSpendingAmountSats] = useState<number | null>(null)
  const [spendingAmountDirty, setSpendingAmountDirty] = useState<boolean>(false)
  const [isGranting, setIsGranting] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const isPeerGroupedRequest = useMemo(() => {
    if (!protocolPermissions.length) return false
    if (basketAccess.length || certificateAccess.length || spendingAuthorization) return false
    const allLevel2 = protocolPermissions.every(p => (p.protocolID?.[0] ?? 0) === 2)
    if (!allLevel2) return false
    const cps = new Set(protocolPermissions.map(p => p.counterparty ?? 'self'))
    return cps.size === 1
  }, [protocolPermissions, basketAccess, certificateAccess, spendingAuthorization])

  const peerCounterparty = useMemo(() => {
    if (!isPeerGroupedRequest) return null
    return protocolPermissions[0]?.counterparty ?? 'self'
  }, [isPeerGroupedRequest, protocolPermissions])

  const protocolKey = (p: ProtocolPermission) => {
    const sec = p.protocolID?.[0] ?? 0
    const name = p.protocolID?.[1] ?? ''
    const cp = p.counterparty ?? 'self'
    return sec === 2 ? `${name}|${cp}` : `${name}`
  }

  const basketKey = (b: BasketAccess) => b.basket

  const certificateKey = (c: CertificateAccess) => {
    const type = c.type ?? ''
    const verifier = c.verifierPublicKey ?? ''
    const fields = (c.fields ?? []).slice().sort().join('|')
    return `${type}|${verifier}|${fields}`
  }

  const spendingAmountNumber = useMemo(() => {
    const n = Number(spendingAmount)
    return Number.isFinite(n) ? n : NaN
  }, [spendingAmount])

  const inputStep = useMemo(() => {
    if (!fiatRatesReady && unit.kind === 'fiat') return 1
    if (unit.kind === 'sats') return 1
    if (unit.kind === 'bsv') return 0.00000001
    return 0.01
  }, [unit, fiatRatesReady])

  const adornmentLabel = useMemo(() => {
    if (!fiatRatesReady && unit.kind === 'fiat') return 'sats'
    if (unit.kind === 'sats') return 'sats'
    if (unit.kind === 'bsv') return 'BSV'
    return unit.code === 'USD' ? '$' : unit.code === 'EUR' ? '€' : unit.code === 'GBP' ? '£' : unit.code
  }, [unit, fiatRatesReady])

  const satsToInput = useCallback((sats: number) => {
    if (!fiatRatesReady && unit.kind === 'fiat') return sats
    if (unit.kind === 'sats') return sats
    if (unit.kind === 'bsv') return sats / 1e8

    if (!satoshisPerUSD) return NaN
    const usd = sats / satoshisPerUSD
    const r = unit.code === 'USD' ? 1 : fiatPerUSD?.[unit.code]
    if (typeof r !== 'number') return NaN
    return usd * r
  }, [unit, fiatRatesReady, satoshisPerUSD, fiatPerUSD])

  const inputToSats = useCallback((amount: number) => {
    if (!fiatRatesReady && unit.kind === 'fiat') return Math.round(amount)
    if (unit.kind === 'sats') return Math.round(amount)
    if (unit.kind === 'bsv') return Math.round(amount * 1e8)

    if (!satoshisPerUSD) return NaN
    const r = unit.code === 'USD' ? 1 : fiatPerUSD?.[unit.code]
    if (typeof r !== 'number' || r === 0) return NaN
    const usd = amount / r
    return Math.round(usd * satoshisPerUSD)
  }, [unit, fiatRatesReady, satoshisPerUSD, fiatPerUSD])

  const formatInputFromSats = useCallback((sats: number) => {
    const trimZeros = (s: string) => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
    const v = satsToInput(sats)
    if (!Number.isFinite(v)) return String(sats)

    if (!fiatRatesReady && unit.kind === 'fiat') {
      return String(Math.round(v))
    }
    if (unit.kind === 'sats') return String(Math.round(v))
    if (unit.kind === 'bsv') return trimZeros(v.toFixed(8))

    const abs = Math.abs(v)
    if (abs > 0 && abs < 1) {
      const e = Math.floor(Math.log10(abs))
      const decimals = Math.min(12, Math.max(2, 3 - 1 - e))
      return trimZeros(v.toFixed(decimals))
    }

    return trimZeros(v.toFixed(2))
  }, [satsToInput, unit, fiatRatesReady])

  useEffect(() => {
    if (!spendingAuthorization) return
    if (spendingAmountDirty) return
    if (typeof spendingAmountSats !== 'number' || !Number.isFinite(spendingAmountSats)) return
    const next = formatInputFromSats(spendingAmountSats)
    setSpendingAmount(prev => (prev === next ? prev : next))
  }, [spendingAuthorization, spendingAmountDirty, spendingAmountSats, formatInputFromSats])

  const handleCancel = async () => {
    // Dismiss the current group permission request so we fall back to individual prompts
    if (requestID) {
      try {
        await (managers?.permissionsManager as any)?.dismissGroupedPermission?.(requestID)
      } catch (error) {
        console.error('Error dismissing group permission:', error)
      }
    }

    advanceGroupQueue()
  }

  const handleGrant = async () => {
    setIsGranting(true)
    try {
      // Grant only the checked items. Unchecked items fall back to individual prompts.
      const granted: Partial<GroupedPermissions> = {
        protocolPermissions: protocolPermissions.filter(p => checkedProtocolKeys.has(protocolKey(p))) as any,
        basketAccess: basketAccess.filter(b => checkedBasketKeys.has(basketKey(b))) as any,
        certificateAccess: certificateAccess.filter(c => checkedCertificateKeys.has(certificateKey(c))) as any
      }

      if (spendingAuthorization && spendingEnabled) {
        if (typeof spendingAmountSats !== 'number' || !Number.isFinite(spendingAmountSats) || spendingAmountSats < 0) {
          setIsGranting(false)
          return
        }
        granted.spendingAuthorization = {
          amount: spendingAmountSats,
          description: spendingAuthorization.description
        } as any
      }

      let grantedSuccessfully = false
      if (requestID) {
        try {
          await managers?.permissionsManager.grantGroupedPermission({
            requestID,
            granted: granted as GroupedPermissions,
            expiry: 0 // Never expires
          })
          grantedSuccessfully = true
        } catch (error) {
          console.error('Error granting group permission:', error)
        }
      }

      if (grantedSuccessfully) {
        try {
          const normOriginator = originator ? originator.replace(/^https?:\/\//, '') : originator
          if ((granted as any)?.protocolPermissions?.length) {
            window.dispatchEvent(new CustomEvent('protocol-permissions-changed', { detail: { op: 'grant-group', originator: normOriginator } }))
          }
          if ((granted as any)?.basketAccess?.length) {
            window.dispatchEvent(new CustomEvent('basket-access-changed', { detail: { op: 'grant-group', originator: normOriginator } }))
          }
          if ((granted as any)?.certificateAccess?.length) {
            window.dispatchEvent(new CustomEvent('cert-access-changed', { detail: { op: 'grant-group', originator: normOriginator } }))
          }
          if ((granted as any)?.spendingAuthorization) {
            window.dispatchEvent(new CustomEvent('spending-authorization-changed', { detail: { op: 'grant-group', originator: normOriginator } }))
          }
        } catch {
          // ignore
        }
        advanceGroupQueue()
      }
    } finally {
      setIsGranting(false)
    }
  }

  useEffect(() => {
    // Monitor the group permission requests from the wallet context
    if (groupPermissionRequests && groupPermissionRequests.length > 0) {
      // Get the first group permission request
      const currentRequest = groupPermissionRequests[0] as any

      if ((currentRequest as any)?.requestID && (currentRequest as any).requestID === requestID) {
        return
      }

      // Process the current request
      const processRequest = async () => {
        try {
          const { requestID, originator, permissions } = currentRequest
          const groupPermissions = permissions || {
            protocolPermissions: [],
            basketAccess: [],
            certificateAccess: []
          }

          setRequestID(requestID)
          setOriginator(originator || '')
          setShowDetails(false)

          const newProtocolPermissions = (groupPermissions?.protocolPermissions) || []
          setProtocolPermissions(newProtocolPermissions)
          setCheckedProtocolKeys(new Set(newProtocolPermissions.map(protocolKey)))

          const newBasketAccess = (groupPermissions?.basketAccess) || []
          setBasketAccess(newBasketAccess)
          setCheckedBasketKeys(new Set(newBasketAccess.map(basketKey)))

          const newCertificateAccess = (groupPermissions?.certificateAccess)
            ? groupPermissions.certificateAccess.map((x: CertificateAccess) => ({
              ...x,
              fields: Array.isArray(x.fields)
                ? x.fields
                : x.fields
                  ? Object.keys(x.fields)
                  : []
            }))
            : []
          setCertificateAccess(newCertificateAccess)
          setCheckedCertificateKeys(new Set(newCertificateAccess.map(certificateKey)))

          setSpendingAuthorization(groupPermissions?.spendingAuthorization)
          setSpendingEnabled(!!groupPermissions?.spendingAuthorization)
          setSpendingAmountDirty(false)
          if (groupPermissions?.spendingAuthorization) {
            const sats = Number(groupPermissions.spendingAuthorization.amount)
            setSpendingAmountSats(Number.isFinite(sats) ? sats : null)
            setSpendingAmount(Number.isFinite(sats) ? formatInputFromSats(sats) : String(groupPermissions.spendingAuthorization.amount))
          } else {
            setSpendingAmountSats(null)
            setSpendingAmount('')
          }
        } catch (e) {
          console.error('Error processing group permission request:', e)
        }
      }

      processRequest()
    } else {
      // Reset the dialog when there are no requests
      setOriginator('')
      setRequestID(null)
      setSpendingAuthorization(undefined)
      setProtocolPermissions([])
      setBasketAccess([])
      setCertificateAccess([])
      setCheckedProtocolKeys(new Set())
      setCheckedBasketKeys(new Set())
      setCheckedCertificateKeys(new Set())
      setSpendingEnabled(false)
      setSpendingAmount('')
      setSpendingAmountSats(null)
      setSpendingAmountDirty(false)
      setShowDetails(false)
    }
  }, [groupPermissionRequests, advanceGroupQueue, requestID, formatInputFromSats])

  const handleDialogClose = (_event: any, reason?: string) => {
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
    handleCancel()
  }

  // Helper to generate permission summary text
  const getPermissionSummary = () => {
    const items: ReactNode[] = []
    if (isPeerGroupedRequest && peerCounterparty) items.push('Trust the counterparty shown above')
    if (protocolPermissions.length > 0) items.push('Use your wallet identity to sign and encrypt data')
    if (basketAccess.length > 0) items.push('Store and access data in your wallet')
    if (certificateAccess.length > 0) items.push('View your identity credentials')
    if (spendingAuthorization) {
      items.push(
        <span>
          Spend up to <AmountDisplay showFiatAsInteger>{spendingAuthorization.amount}</AmountDisplay>
        </span>
      )
    }
    return items
  }

  // Generate app-specific context message
  const getContextMessage = () => {
    const appName = originator || 'This app'
    if (isPeerGroupedRequest && peerCounterparty) {
      return `${appName} wants you to trust the counterparty shown above for the permissions below.`
    }
    return `${appName} wants to use your wallet to manage identity, data, and transactions.`
  }

  return (
    <CustomDialog
      open={groupPermissionModalOpen && groupPermissionRequests.length > 0}
      onClose={handleDialogClose}
      maxWidth='md'
      fullWidth
      title={isPeerGroupedRequest ? 'Trust This Peer?' : 'App Permissions Request'}
    >
      <DialogContent>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          {originator && (
            <AppChip
              size={2.5}
              showDomain
              label={originator}
              clickable={false}
            />
          )}
          {isPeerGroupedRequest && peerCounterparty && (
            <Box sx={{ mt: 1 }}>
              <Typography variant='caption' color='text.secondary'>
                Counterparty
              </Typography>
              {peerCounterparty && (
                <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'center' }}>
                  <CounterpartyChip
                    counterparty={peerCounterparty}
                    clickable={false}
                    layout="compact"
                  />
                </Box>
              )}
            </Box>
          )}
        </Box>

        <Typography variant='body1' sx={{ mb: 3, color: 'text.primary', lineHeight: 1.6 }}>
          {getContextMessage()}
        </Typography>

        <Typography variant='subtitle2' sx={{ mb: 2, fontWeight: 600 }}>
          This allows it to:
        </Typography>

        <List sx={{ mb: 2 }}>
          {getPermissionSummary().map((item, i) => (
            <ListItem key={i} sx={{ py: 1.5 }}>
              <ListItemIcon>
                <CheckCircleOutlineIcon color='primary' />
              </ListItemIcon>
              <ListItemText primary={item} primaryTypographyProps={{ variant: 'body1' }} />
            </ListItem>
          ))}
        </List>

        {spendingAuthorization && (
          <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>
              Spending Authorization
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={spendingEnabled}
                  onChange={(e) => setSpendingEnabled(e.target.checked)}
                  inputProps={{
                    'aria-label': 'Enable grouped spending authorization'
                  }}
                  data-testid="group-permission-spending-enabled"
                  data-proofrun="group-permission-spending-enabled"
                />
              }
              label='Enable automatic spending'
            />
            {spendingEnabled && (
              <Box sx={{ mt: 1 }}>
                <TextField
                  label={!fiatRatesReady && unit.kind === 'fiat' ? 'Max satoshis' : unit.kind === 'fiat' ? `Max ${unit.code}` : unit.kind === 'bsv' ? 'Max BSV' : 'Max satoshis'}
                  type='number'
                  value={spendingAmount}
                  onChange={(e) => {
                    const next = e.target.value
                    setSpendingAmount(next)
                    setSpendingAmountDirty(true)
                    const n = Number(next)
                    if (!Number.isFinite(n)) {
                      setSpendingAmountSats(null)
                      return
                    }
                    const sats = inputToSats(n)
                    setSpendingAmountSats(Number.isFinite(sats) ? sats : null)
                  }}
                  fullWidth
                  inputProps={{
                    min: 0,
                    step: inputStep,
                    'aria-label': 'Grouped spending maximum'
                  }}
                  data-testid="group-permission-spending-amount"
                  data-proofrun="group-permission-spending-amount"
                  InputProps={{
                    startAdornment: <InputAdornment position="start">{adornmentLabel}</InputAdornment>
                  }}
                  helperText={
                    Number.isFinite(spendingAmountNumber) && typeof spendingAmountSats === 'number' && Number.isFinite(spendingAmountSats)
                      ? (
                        <>
                          Spend up to <AmountDisplay showFiatAsInteger>{spendingAmountSats}</AmountDisplay> without additional confirmation
                        </>
                      )
                      : 'Enter a valid number'
                  }
                  error={spendingEnabled && (!Number.isFinite(spendingAmountNumber) || spendingAmountNumber < 0 || typeof spendingAmountSats !== 'number' || !Number.isFinite(spendingAmountSats))}
                />
              </Box>
            )}
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        <Button
          onClick={() => setShowDetails(s => !s)}
          variant='text'
          size='small'
          aria-label={showDetails ? 'Hide grouped permission details' : 'Show grouped permission details'}
          data-testid="group-permission-toggle-details"
          data-proofrun="group-permission-toggle-details"
        >
          {showDetails ? 'Hide details' : 'Show details'}
        </Button>

        {showDetails && (
          <Box sx={{ mt: 1 }}>
            {protocolPermissions.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant='subtitle2' gutterBottom>
                  Protocol Access ({protocolPermissions.length})
                </Typography>
                {protocolPermissions.map((x, i) => (
                  <Box key={i} sx={{ ml: 2, mb: 1 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={checkedProtocolKeys.has(protocolKey(x))}
                          inputProps={{
                            'aria-label': `Include protocol permission ${x.protocolID?.[1] ?? i + 1}`
                          }}
                          data-testid={`group-permission-protocol-${i}`}
                          data-proofrun={`group-permission-protocol-${i}`}
                          onChange={(e) => {
                            const key = protocolKey(x)
                            setCheckedProtocolKeys(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(key)
                              else next.delete(key)
                              return next
                            })
                          }}
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <ProtoChip
                            protocolID={x.protocolID[1]}
                            securityLevel={x.protocolID[0]}
                            counterparty={x.counterparty}
                            clickable={false}
                            canRevoke={false}
                            layout="compact"
                          />
                          {x.protocolID?.[0] === 2 && x.counterparty && (
                            <CounterpartyChip counterparty={x.counterparty} clickable={false} size={1.0} layout="compact" />
                          )}
                          {x.description && (
                            <Typography variant='caption' color='text.secondary'>
                              — {x.description}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  </Box>
                ))}
              </Box>
            )}

            {certificateAccess.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant='subtitle2' gutterBottom>
                  Certificate Access ({certificateAccess.length})
                </Typography>
                {certificateAccess.map((x, i) => (
                  <Box key={i} sx={{ ml: 2, mb: 1 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={checkedCertificateKeys.has(certificateKey(x))}
                          inputProps={{
                            'aria-label': `Include certificate access ${x.type ?? i + 1}`
                          }}
                          data-testid={`group-permission-certificate-${i}`}
                          data-proofrun={`group-permission-certificate-${i}`}
                          onChange={(e) => {
                            const key = certificateKey(x)
                            setCheckedCertificateKeys(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(key)
                              else next.delete(key)
                              return next
                            })
                          }}
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <CertificateChip
                            certType={x.type}
                            certVerifier={x.verifierPublicKey}
                            clickable={false}
                            canRevoke={false}
                          />
                          {x.verifierPublicKey && (
                            <CounterpartyChip counterparty={x.verifierPublicKey} clickable={false} size={1.0} layout="compact" />
                          )}
                          {x.description && (
                            <Typography variant='caption' color='text.secondary'>
                              — {x.description}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  </Box>
                ))}
              </Box>
            )}

            {basketAccess.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant='subtitle2' gutterBottom>
                  Basket Access ({basketAccess.length})
                </Typography>
                {basketAccess.map((x, i) => (
                  <Box key={i} sx={{ ml: 2, mb: 1 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={checkedBasketKeys.has(basketKey(x))}
                          inputProps={{
                            'aria-label': `Include basket access ${x.basket ?? i + 1}`
                          }}
                          data-testid={`group-permission-basket-${i}`}
                          data-proofrun={`group-permission-basket-${i}`}
                          onChange={(e) => {
                            const key = basketKey(x)
                            setCheckedBasketKeys(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(key)
                              else next.delete(key)
                              return next
                            })
                          }}
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <BasketChip basketId={x.basket} clickable={false} canRevoke={false} layout="compact" />
                          {x.description && (
                            <Typography variant='caption' color='text.secondary'>
                              — {x.description}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions
        style={{
          justifyContent: 'space-around',
          padding: '1em',
          flex: 'none'
        }}
      >
        <Button
          onClick={handleCancel}
          variant='outlined'
          disabled={isGranting}
          size='large'
          aria-label={isPeerGroupedRequest ? 'Deny peer trust request' : 'Deny grouped app permission request'}
          data-testid="group-permission-deny"
          data-proofrun="group-permission-deny"
        >
          Deny
        </Button>
        <Button
          variant='contained'
          color='primary'
          onClick={handleGrant}
          disabled={isGranting}
          startIcon={isGranting ? <CircularProgress size={16} color='inherit' /> : undefined}
          size='large'
          aria-label={isPeerGroupedRequest ? 'Trust peer' : 'Allow grouped app permissions'}
          data-testid="group-permission-allow"
          data-proofrun="group-permission-allow"
        >
          {isGranting ? 'Granting...' : isPeerGroupedRequest ? 'Trust Peer' : 'Allow Access'}
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default GroupPermissionHandler
