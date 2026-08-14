// src/routes/PeerPayRoute.tsx
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AlertTitle,
  Autocomplete,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import { QRCodeSVG } from 'qrcode.react'
import { PeerPayClient, IncomingPayment } from '@bsv/message-box-client'
import type { IdentityClient, WalletInterface } from '@bsv/sdk'
import { WalletContext } from '../../../WalletContext'
import { toast } from 'react-toastify'
import { CurrencyConverter } from 'amountinator'
import { useLocation, useNavigate } from 'react-router-dom'
import useAsyncEffect from 'use-async-effect'
import { ExchangeRateContext } from '../../../components/AmountDisplay/ExchangeRateContextProvider'
import { showSatoshiShopFundingModal, showSatoshiShopPendingTransactionsModal } from '../../Shop/shopModal'
import {
  assertPeerPayAcceptanceSucceeded,
  PEER_PAY_ACCEPTANCE_ERROR_MESSAGE
} from './peerPayAcceptance'

export type PeerPayRouteProps = {
  defaultRecipient?: string
}

type PaymentFormProps = {
  peerPay: PeerPayClient | null
  messageBoxHost: string
  onSent?: () => void
  defaultRecipient?: string
  identityClient: IdentityClient | null
}

type ResolvedIdentity = {
  identityKey: string
  name?: string
  badgeLabel?: string
  avatarURL?: string
}

function PaymentForm({ peerPay, messageBoxHost, onSent, defaultRecipient, identityClient }: PaymentFormProps) {
  const [searchValue, setSearchValue] = useState(defaultRecipient ?? '')
  const [options, setOptions] = useState<ResolvedIdentity[]>([])
  const [amount, setAmount] = useState<number>(0)
  const [amountInput, setAmountInput] = useState('')
  const [selectedCurrency, setSelectedCurrency] = useState<'SATS' | 'USD' | 'GBP' | 'EUR' | 'BSV'>('SATS')
  const [sending, setSending] = useState(false)
  const currencyConverter = useMemo(() => new CurrencyConverter(), [])
  const [converterReady, setConverterReady] = useState(false)
  const [resolvedIdentity, setResolvedIdentity] = useState<ResolvedIdentity | null>(defaultRecipient ? { identityKey: defaultRecipient } : null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState<{ identity: ResolvedIdentity; amount: number } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)

  const identityKeyPattern = /^[0-9a-f]{20,}$/i

  useAsyncEffect(async () => {
    await currencyConverter.initialize()
    setConverterReady(true)
  }, [])

  const shortKey = (value: string) => value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
  const formatAmount = (value: number) => `${value.toLocaleString()} sats`

  const convertToSats = useCallback((value: string, currency: string) => {
    const raw = value.replace(/[^0-9.]/g, '')
    const [whole = '', ...rest] = raw.split('.')
    const normalized = rest.length > 0 ? `${whole}.${rest.join('')}` : whole
    setAmountInput(normalized)
    if (!normalized || normalized === '.') {
      setAmount(0)
      return
    }
    const numeric = Number(normalized)
    if (Number.isNaN(numeric) || !converterReady) {
      setAmount(0)
      return
    }
    try {
      const sats = currencyConverter.convertCurrency(numeric, currency, 'SATS')
      setAmount(Math.max(0, Math.floor(sats ?? 0)))
      setSendError(null)
    } catch (error) {
      setAmount(0)
      setSendError((error as Error)?.message ?? 'Unable to calculate amount')
    }
  }, [converterReady, currencyConverter])

  useEffect(() => {
    convertToSats(amountInput, selectedCurrency)
  }, [amountInput, selectedCurrency, convertToSats])

  useEffect(() => {
    if (converterReady) {
      convertToSats(amountInput, selectedCurrency)
    }
  }, [converterReady, amountInput, selectedCurrency, convertToSats])

  const fetchIdentities = useCallback(async (query: string) => {
    if (!identityClient) return
    const trimmed = query.trim()
    if (!trimmed || trimmed.length < 2) {
      setOptions([])
      return
    }
    setSearchLoading(true)
    try {
      const isKey = identityKeyPattern.test(trimmed)
      const results = isKey
        ? await identityClient.resolveByIdentityKey({ identityKey: trimmed })
        : await identityClient.resolveByAttributes({ attributes: { any: trimmed } })
      const mapped = (results ?? []).map((item) => ({
        identityKey: item.identityKey ?? '',
        name: item.name,
        badgeLabel: item.badgeLabel,
        avatarURL: item.avatarURL
      }))

      setOptions(mapped)
    } catch (error) {
      setOptions([])
    } finally {
      setSearchLoading(false)
    }
  }, [identityClient])

  const handleSearchChange = useCallback((_: unknown, value: string) => {
    setSearchValue(value)
    const trimmed = value.trim()

    if (!trimmed) {
      setResolvedIdentity(null)
      setOptions([])
      return
    }
    fetchIdentities(trimmed)
  }, [fetchIdentities])

  const handleSelectIdentity = useCallback((_: unknown, value: ResolvedIdentity | string | null) => {
    if (value === null) {
      setSearchValue('')
      setResolvedIdentity(null)
      return
    }
    if (typeof value === 'string') {
      setSearchValue(value)
      setResolvedIdentity(null)
      fetchIdentities(value)
      return
    }
    if (!value.identityKey) {
      setResolvedIdentity(null)
      return
    }
    setResolvedIdentity(value)
    setSearchValue(value.identityKey)
  }, [fetchIdentities])

  const handleRecipientKeyDown = useCallback((event: any) => {
    if (event.key === 'Backspace' && resolvedIdentity) {
      // When a resolved identity is selected, treat Backspace as a full clear
      // (same behavior as clicking the clear/X button) to avoid repeatedly
      // re-querying for the same identity and freezing the UI.
      event.preventDefault()
      setResolvedIdentity(null)
      setSearchValue('')
      setOptions([])
    }
  }, [resolvedIdentity])

  const effectiveRecipient = (resolvedIdentity?.identityKey ?? searchValue).trim()
  const hasRecipient = effectiveRecipient.length > 0
  const isRecipientLikelyValid = resolvedIdentity
    ? !!resolvedIdentity.identityKey
    : identityKeyPattern.test(effectiveRecipient)

  const identityError = !hasRecipient
    ? null
    : resolvedIdentity
      ? null
      : isRecipientLikelyValid
        ? null
        : 'Identity keys are hex values. Paste a full key or search above.'

  const canSend = peerPay !== null && hasRecipient && isRecipientLikelyValid && amount > 0 && !sending

  const performSend = async () => {
    if (!peerPay) return
    try {
      setSending(true)
      setSendError(null)
      await peerPay.sendLivePayment({
        recipient: effectiveRecipient,
        amount
      }, messageBoxHost)
      onSent?.()
      toast.success('Payment sent')
      setLastSent({ identity: resolvedIdentity ?? { identityKey: effectiveRecipient }, amount })
      setAmountInput('')
      setAmount(0)
      setSearchValue('')
      setResolvedIdentity(null)
    } catch (e) {
      const message = (e as Error)?.message ?? 'Failed to send payment'
      setSendError(message)
      toast.error(message)
    } finally {
      setSending(false)
      setConfirmOpen(false)
    }
  }

  return (
    <Stack spacing={2.5}>
      {lastSent && (
        <Alert
          severity="success"
          onClose={() => setLastSent(null)}
          sx={{ borderRadius: 2 }}
        >
          <AlertTitle>Payment sent</AlertTitle>
          Sent {formatAmount(lastSent.amount)} to {lastSent.identity.name ?? shortKey(lastSent.identity.identityKey)}
        </Alert>
      )}

      <Stack spacing={1}>
        <Typography variant="subtitle2" color="text.secondary">
          Look up by name or paste an identity key.
        </Typography>
        <Autocomplete<ResolvedIdentity, false, false, true>
          freeSolo
          fullWidth
          options={options}
          loading={searchLoading}
          value={resolvedIdentity ?? searchValue}
          inputValue={searchValue}
          onInputChange={handleSearchChange}
          onChange={handleSelectIdentity}
          isOptionEqualToValue={(option, value) => {
            if (typeof value === 'string') return option.identityKey === value
            return option.identityKey === value.identityKey
          }}
          getOptionLabel={(option) => {
            if (typeof option === 'string') return option
            return option.name || option.identityKey || ''
          }}
          renderOption={(props, option) => (
            <li {...props} key={option.identityKey}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Avatar src={option.avatarURL} sx={{ width: 28, height: 28 }}>
                  {(option.name ?? option.identityKey ?? '?').slice(0, 1)}
                </Avatar>
                <Box> 
                  <Typography variant="body2" fontWeight={600}>{option.name ?? 'Unknown identity'}</Typography>
                  <Typography variant="caption" color="text.secondary">{shortKey(option.identityKey)}</Typography>
                </Box>
              </Stack>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Recipient"
              placeholder="Search by name or paste identity key"
              helperText="We only send to BRC100 identities, NOT old-style type-1."
              onKeyDown={handleRecipientKeyDown}
            />
          )}
        />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minHeight: 32 }}>
          {resolvedIdentity && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Avatar
                src={resolvedIdentity.avatarURL}
                sx={{ width: 28, height: 28 }}
              >
                {(resolvedIdentity.name ?? resolvedIdentity.identityKey ?? '?').slice(0, 1)}
              </Avatar>
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {resolvedIdentity.name ?? 'Unknown identity'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {shortKey(resolvedIdentity.identityKey)}
                </Typography>
              </Box>
            </Stack>
          )}
          {identityError && (
            <Typography variant="caption" color="error">
              {identityError}
            </Typography>
          )}
        </Stack>
      </Stack>

      <Grid container spacing={1} alignItems="flex-start">
        <Grid item xs={12} sm={4}>
          <TextField
            select
            label="Currency"
            value={selectedCurrency}
            onChange={(e) => setSelectedCurrency(e.target.value as any)}
            fullWidth
          >
            {['SATS', 'USD', 'GBP', 'EUR', 'BSV'].map((code) => (
              <MenuItem key={code} value={code}>{code}</MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12} sm={8}>
          <TextField
            label={`Amount (${selectedCurrency})`}
            variant="outlined"
            value={amountInput}
            onChange={(e) => convertToSats(e.target.value, selectedCurrency)}
            helperText={converterReady ? `Will send ${formatAmount(amount)}` : 'Loading rates…'}
            fullWidth
            inputMode="decimal"
          />
        </Grid>
      </Grid>

      {sendError && (
        <Alert severity="error" onClose={() => setSendError(null)} sx={{ borderRadius: 2 }}>
          {sendError}
        </Alert>
      )}

      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          disabled={!canSend}
          onClick={() => setConfirmOpen(true)}
          startIcon={sending ? <CircularProgress size={18} sx={{ color: 'black' }} /> : null}
          fullWidth
        >
          {sending ? 'Sending…' : 'Review and send'}
        </Button>
      </Stack>

      <Dialog open={confirmOpen} onClose={() => !sending && setConfirmOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Confirm payment</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Box>
              <Typography variant="overline" color="text.secondary">Recipient</Typography>
              <Typography variant="body1" fontWeight={600}>
                {resolvedIdentity?.name ?? 'Unknown identity'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {shortKey(effectiveRecipient)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="overline" color="text.secondary">Amount</Typography>
              <Typography variant="h6">{formatAmount(amount)}</Typography>
              <Typography variant="caption" color="text.secondary">From {selectedCurrency} {amountInput || '0'}</Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={performSend}
            disabled={!canSend || sending}
            startIcon={sending ? <CircularProgress size={16} sx={{ color: 'black' }} /> : null}
          >
            {sending ? 'Sending…' : 'Send now'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

type PaymentListProps = {
  payments: IncomingPayment[]
  onRefresh: () => void
  peerPay: PeerPayClient | null
  loading: boolean
  identityClient: IdentityClient | null
  messageBoxHost: string
}

function PaymentList({ payments, onRefresh, peerPay, loading, identityClient, messageBoxHost }: PaymentListProps) {
  const [loadingById, setLoadingById] = useState<Record<string, 'accept' | 'return'>>({})
  const [senderDetails, setSenderDetails] = useState<Record<string, ResolvedIdentity>>({})

  const setLoadingFor = (id: string, action?: 'accept' | 'return') => {
    setLoadingById(prev => {
      if (action) return { ...prev, [id]: action }
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  useEffect(() => {
    if (!identityClient) return undefined
    const missingKeys = Array.from(new Set(payments.map((p) => p.sender))).filter((key) => !senderDetails[key])
    if (missingKeys.length === 0) return undefined

    let cancelled = false
    ;(async () => {
      for (const key of missingKeys) {
        try {
          const results = await identityClient.resolveByIdentityKey({ identityKey: key })
          if (cancelled) return
          const match = results?.[0]
          setSenderDetails(prev => ({
            ...prev,
            [key]: {
              identityKey: key,
              name: match?.name,
              badgeLabel: match?.badgeLabel,
              avatarURL: match?.avatarURL
            }
          }))
        } catch (error) {
          if (cancelled) return
          setSenderDetails(prev => ({
            ...prev,
            [key]: { identityKey: key }
          }))
        }
      }
    })()

    return () => { cancelled = true }
  }, [payments, identityClient, senderDetails])

  const acceptWithRetry = async (p: IncomingPayment) => {
    if (!peerPay) return false
    const id = String(p.messageId)
    setLoadingFor(id, 'accept')
    try {
      const result = await peerPay.acceptPayment(p)
      assertPeerPayAcceptanceSucceeded(result)
      return true
    } catch (firstError) {
      console.warn('[Payments] Payment acceptance failed; retrying refreshed message', firstError)
      try {
        const list = await peerPay.listIncomingPayments(messageBoxHost)
        const fresh = list.find(x => String(x.messageId) === id)
        if (!fresh) throw new Error('Payment not found on refresh')
        const result = await peerPay.acceptPayment(fresh)
        assertPeerPayAcceptanceSucceeded(result)
        return true
      } catch (retryError) {
        console.error('[Payments] Payment acceptance retry failed', retryError)
        return false
      }
    } finally {
      setLoadingFor(id)
    }
  }

  const accept = async (p: IncomingPayment) => {
    if (!peerPay) return
    const ok = await acceptWithRetry(p)
    if (!ok) toast.error(PEER_PAY_ACCEPTANCE_ERROR_MESSAGE)
    onRefresh()
  }

  const returnToSender = async (p: IncomingPayment) => {
    if (!peerPay) return
    const id = String(p.messageId)
    setLoadingFor(id, 'return')
    try {
      await peerPay.rejectPayment(p)
      toast.success('Payment returned')
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Failed to return payment')
    } finally {
      setLoadingFor(id)
      onRefresh()
    }
  }

  const shortKey = (value: string) => value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value

  return (
    <Paper elevation={2} sx={{ p: 2, width: '100%' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="h6">Incoming payments</Typography>
        <Button onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </Box>

      {loading && <LinearProgress sx={{ mb: 1 }} />}

      {payments.length === 0 ? (
        <Alert severity="info" sx={{ mt: 1, borderRadius: 2 }}>No incoming payments yet.</Alert>
      ) : (
        <Stack spacing={1.5} mt={1}>
          {payments.map((p) => {
            const id = String(p.messageId)
            const isAccepting = loadingById[id] === 'accept'
            const isReturning = loadingById[id] === 'return'
            const disableActions = !peerPay || isAccepting || isReturning
            const sender = senderDetails[p.sender] ?? { identityKey: p.sender }

            return (
              <Box
                key={id}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  p: 2,
                  bgcolor: 'background.paper'
                }}
              >
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle2" color="text.secondary">From</Typography>
                    <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
                      <Avatar src={sender.avatarURL} sx={{ width: 36, height: 36 }}>
                        {(sender.name ?? sender.identityKey).slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Box>
                        <Typography variant="body1" fontWeight={600}>{sender.name ?? 'Unverified sender'}</Typography>
                        <Tooltip title={sender.identityKey}>
                          <Typography variant="body2" color="text.secondary">
                            {shortKey(sender.identityKey)}
                          </Typography>
                        </Tooltip>
                      </Box>
                    </Stack>
                  </Grid>

                  <Grid item xs={12} md={3}>
                    <Typography variant="subtitle2" color="text.secondary">Amount</Typography>
                    <Typography variant="h6">{p.token.amount.toLocaleString()} sats</Typography>
                    <Typography variant="caption" color="text.secondary">Message {shortKey(id)}</Typography>
                  </Grid>

                  <Grid item xs={12} md={3}>
                    <Stack direction="row" spacing={1} justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={
                          isAccepting ? <CircularProgress size={16} sx={{ color: 'black' }} /> : null
                        }
                        disabled={disableActions}
                        onClick={() => accept(p)}
                      >
                        {isAccepting ? 'Receiving…' : 'Accept'}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={disableActions}
                        startIcon={
                          isReturning ? <CircularProgress size={16} sx={{ color: 'text.primary' }} /> : null
                        }
                        onClick={() => returnToSender(p)}
                      >
                        {isReturning ? 'Returning…' : 'Return'}
                      </Button>
                    </Stack>
                  </Grid>
                </Grid>
              </Box>
            )
          })}
        </Stack>
      )}
    </Paper>
  )
}

type ReceivePanelProps = {
  identityKey: string
  onCopy: () => void
  copied: boolean
}

function ReceivePanel({ identityKey, onCopy, copied }: ReceivePanelProps) {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Share your identity key to receive payments.
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography
            variant="body2"
            sx={{
              fontFamily: 'monospace',
              bgcolor: 'action.hover',
              py: 1,
              px: 2,
              flexGrow: 1,
              overflow: 'hidden'
            }}
          >
            {identityKey || 'Loading identity key…'}
          </Typography>
          <IconButton
            size='small'
            onClick={onCopy}
            disabled={!identityKey}
            color={copied ? 'success' : 'default'}
          >
            {copied ? <CheckIcon fontSize='small' /> : <ContentCopyIcon fontSize='small' />}
          </IconButton>
        </Box>
      </Box>

      <Box sx={{ textAlign: 'center' }}>
        {identityKey ? (
          <QRCodeSVG value={identityKey} size={180} includeMargin />
        ) : (
          <Typography color="text.secondary">QR code available once your identity key loads.</Typography>
        )}
      </Box>
    </Stack>
  )
}

type BuyPanelProps = {
  wallet: WalletInterface | null
  satoshisPerUSD?: number
}

function BuyPanel({ wallet, satoshisPerUSD }: BuyPanelProps) {
  const [funding, setFunding] = useState(false)

  const openPurchase = async (pending = false) => {
    if (!wallet) return
    setFunding(true)
    try {
      const options = {
        title: 'Buy sats',
        introText: 'Use your card to add sats to Peacock.',
        postPurchaseText: 'Your balance will update when the purchase arrives.',
        cancelText: 'Close',
        marketSatoshisPerUSD: satoshisPerUSD
      }
      if (pending) {
        await showSatoshiShopPendingTransactionsModal(wallet, options)
      } else {
        await showSatoshiShopFundingModal(wallet, 0, options)
      }
    } finally {
      setFunding(false)
    }
  }

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5">Add sats with a card</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75 }}>
          Purchases are handled by Satoshi Shop. Peacock will refresh your balance after the payment arrives.
        </Typography>
      </Box>
      {!wallet && <Alert severity="info">The wallet is still starting. Try again in a moment.</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
        <Button variant="contained" disabled={!wallet || funding} onClick={() => void openPurchase()}>
          {funding ? 'Opening…' : 'Continue to purchase'}
        </Button>
        <Button variant="outlined" disabled={!wallet || funding} onClick={() => void openPurchase(true)}>
          Check pending purchases
        </Button>
      </Stack>
      <Alert severity="info" variant="outlined">Selling is not available yet, so Peacock does not advertise a sell action.</Alert>
    </Stack>
  )
}

export default function PeerPayRoute({ defaultRecipient }: PeerPayRouteProps) {
  const { managers, adminOriginator, clients, environment } = useContext(WalletContext)
  const location = useLocation()
  const navigate = useNavigate()
  const rates = useContext(ExchangeRateContext)

  const identityClient = clients.identityClient

  const walletClientForPeerPay = useMemo<WalletInterface | null>(() => {
    const pm = managers?.permissionsManager as any
    const underlying = pm?.underlying as WalletInterface | undefined
    return underlying ?? null
  }, [managers?.permissionsManager])

  const peerPay = useMemo(() => {
    if (!walletClientForPeerPay) return null
    return new PeerPayClient({
      walletClient: walletClientForPeerPay,
      messageBoxHost: environment.messageBoxHost,
      enableLogging: true,
      originator: adminOriginator
    })
  }, [walletClientForPeerPay, adminOriginator, environment.messageBoxHost])

  const [payments, setPayments] = useState<IncomingPayment[]>([])
  const [loading, setLoading] = useState(false)
  const [snack, setSnack] = useState<{ open: boolean; msg: string; severity: 'success' | 'info' | 'warning' | 'error' }>({
    open: false,
    msg: '',
    severity: 'info',
  })
  const [identityKey, setIdentityKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'send' | 'receive' | 'buy'>(() => {
    const tabParam = new URLSearchParams(location.search).get('tab')
    return tabParam === 'receive' || tabParam === 'buy' ? tabParam : 'send'
  })

  const syncTabToUrl = useCallback((nextTab: 'send' | 'receive' | 'buy') => {
    const params = new URLSearchParams(location.search)
    params.set('tab', nextTab)
    navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: true })
  }, [location.pathname, location.search, navigate])

  useEffect(() => {
    const tabParam = new URLSearchParams(location.search).get('tab')
    const nextTab = tabParam === 'receive' || tabParam === 'buy' ? tabParam : 'send'
    if (nextTab !== activeTab) {
      setActiveTab(nextTab)
    }
  }, [location.search, activeTab])

  const fetchPayments = useCallback(async () => {
    if (!peerPay) return
    setLoading(true)
    try {
      const list = await peerPay.listIncomingPayments(environment.messageBoxHost)
      setPayments(list)
    } catch (e) {
      setSnack({ open: true, msg: (e as Error)?.message ?? 'Failed to load payments', severity: 'error' })
    } finally {
      setLoading(false)
    }
  }, [peerPay, environment.messageBoxHost])

  useEffect(() => {
    fetchPayments()
  }, [fetchPayments])

  useEffect(() => {
    let mounted = true
    if (!peerPay) return undefined

    ; (async () => {
      try {
        await peerPay.initializeConnection()
        await peerPay.listenForLivePayments({
          overrideHost: environment.messageBoxHost,
          onPayment: (payment) => {
            if (!mounted) return
            setPayments((prev) => [...prev, payment])
            setSnack({ open: true, msg: 'New incoming payment', severity: 'success' })
          },
        })
      } catch (e) {
        toast.error((e as Error)?.message ?? 'Failed to start live payments')
      }
    })()

    return () => {
      mounted = false
      peerPay.disconnectWebSocket?.().catch(() => { /* ignore */ })
    }
  }, [peerPay, environment.messageBoxHost])

  useEffect(() => {
    if (!walletClientForPeerPay || !adminOriginator) return undefined

    let mounted = true
    walletClientForPeerPay.getPublicKey({ identityKey: true }, adminOriginator)
      .then(({ publicKey }) => {
        if (mounted) setIdentityKey(publicKey)
      })
      .catch(() => {
        if (mounted) setIdentityKey('')
      })

    return () => { mounted = false }
  }, [walletClientForPeerPay, adminOriginator])

  const handleCopyIdentityKey = useCallback(() => {
    if (!identityKey) return
    navigator.clipboard.writeText(identityKey).catch(() => { /* ignore */ })
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [identityKey])

  return (
    <Container maxWidth="md">
      <Box sx={{ minHeight: '100vh', py: 5 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          Payments
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Send to an identity, receive pending payments, or add sats.
        </Typography>

        <Paper elevation={2} sx={{ mb: 3 }}>
          <Tabs
            aria-label="Payment actions"
            value={activeTab}
            onChange={(_, value) => {
              const nextTab = value as 'send' | 'receive' | 'buy'
              setActiveTab(nextTab)
              syncTabToUrl(nextTab)
            }}
            indicatorColor="primary"
            textColor="primary"
            variant="fullWidth"
          >
            <Tab label="Send" value="send" />
            <Tab label="Receive" value="receive" />
            <Tab label="Buy sats" value="buy" />
          </Tabs>

          <Box sx={{ p: 3 }}>
            {activeTab === 'send' ? (
              <PaymentForm
                peerPay={peerPay}
                messageBoxHost={environment.messageBoxHost}
                onSent={fetchPayments}
                defaultRecipient={defaultRecipient}
                identityClient={identityClient}
              />
            ) : activeTab === 'receive' ? (
              <ReceivePanel identityKey={identityKey} onCopy={handleCopyIdentityKey} copied={copied} />
            ) : (
              <BuyPanel wallet={walletClientForPeerPay} satoshisPerUSD={rates?.satoshisPerUSD} />
            )}
          </Box>
        </Paper>

        {activeTab === 'receive' && (
          <PaymentList
            payments={payments}
            onRefresh={fetchPayments}
            peerPay={peerPay}
            messageBoxHost={environment.messageBoxHost}
            loading={loading}
            identityClient={identityClient}
          />
        )}

        <Snackbar
          open={snack.open}
          autoHideDuration={3500}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled" sx={{ width: '100%' }}>
            {snack.msg}
          </Alert>
        </Snackbar>
      </Box>
    </Container>
  )
}
