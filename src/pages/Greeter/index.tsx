import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Container,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import {
  CloseRounded,
  ExpandLessRounded,
  ExpandMoreRounded,
  VisibilityOffRounded,
  VisibilityRounded
} from '@mui/icons-material'
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { PrivateKey, Utils } from '@bsv/sdk'
import { Mnemonic } from '@bsv/sdk/compat'
import { PrivilegedKeyManager } from '@bsv/wallet-toolbox-client'
import AppLogo from '../../components/AppLogo'
import NetworkEnvironmentSelector from '../../components/NetworkEnvironmentSelector'
import PageLoading from '../../components/PageLoading'
import { UserContext } from '../../UserContext'
import { WalletContext } from '../../WalletContext'
import {
  deriveKeyMaterialFromMnemonic,
  persistKeyMaterial,
  reconcileStoredKeyMaterial
} from '../../utils/keyMaterial'
import {
  getWalletEnvironmentStorageItem,
  setWalletEnvironmentStorageItem,
} from '../../config'

type PendingApp = {
  name?: string
  Originator?: string
  redirected_from?: string
  message?: string
  custom_message?: string
}

const Greeter = () => {
  const { environment, managers, snapshotLoaded } = useContext(WalletContext)
  const { appName, pageLoaded } = useContext(UserContext)
  const navigate = useNavigate()
  const walletManager = managers?.walletManager

  const [appInfo, setAppInfo] = useState<PendingApp | null>(null)
  const [mode, setMode] = useState<'private' | 'mnemonic'>('mnemonic')
  const [privateKey, setPrivateKey] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [showKeyMaterial, setShowKeyMaterial] = useState(false)
  const [loading, setLoading] = useState(false)
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false)
  const [persistedKeyLoaded, setPersistedKeyLoaded] = useState(false)
  const keyFieldRef = useRef<HTMLInputElement | null>(null)

  const appOrigin = useMemo(() => {
    const source = appInfo?.Originator ?? appInfo?.redirected_from ?? ''
    if (!source) return ''
    try { return new URL(source).host } catch { return source }
  }, [appInfo])

  const syncAppInfo = useCallback(() => {
    try {
      const stored = sessionStorage.getItem('appinfo')
      setAppInfo(stored ? JSON.parse(stored) as PendingApp : null)
    } catch {
      setAppInfo(null)
    }
  }, [])

  useEffect(() => {
    syncAppInfo()
    window.addEventListener('focus', syncAppInfo)
    const handleVisibility = () => { if (!document.hidden) syncAppInfo() }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', syncAppInfo)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [syncAppInfo])

  useEffect(() => {
    if (persistedKeyLoaded) return
    const stored = reconcileStoredKeyMaterial()
    if (stored.mnemonic) {
      setMnemonic(stored.mnemonic)
      setPrivateKey(stored.keyHex)
      setMode('mnemonic')
    } else if (stored.keyHex) {
      setPrivateKey(stored.keyHex)
      setMode('private')
    }
    setPersistedKeyLoaded(true)
  }, [persistedKeyLoaded])

  useEffect(() => {
    if (pageLoaded && mode === 'private') keyFieldRef.current?.focus()
  }, [mode, pageLoaded])

  useEffect(() => {
    if (walletManager?.authenticated) navigate('/dashboard/home', { replace: true })
  }, [navigate, walletManager?.authenticated])

  const createDisabledPrivilegedManager = useCallback(
    () => new PrivilegedKeyManager(async () => {
      throw new Error('Privileged operations are not supported with this wallet.')
    }),
    []
  )

  const handleGenerateKey = () => {
    try {
      const generated = PrivateKey.fromRandom().toHex()
      const phrase = persistKeyMaterial(generated)
      setPrivateKey(generated)
      setMnemonic(phrase)
      setMode('private')
      setShowKeyMaterial(true)
      toast.success('New key created and saved to this device profile.')
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to generate key')
    }
  }

  const handleGenerateMnemonic = () => {
    try {
      const generated = Mnemonic.fromRandom(128).toString()
      const derived = deriveKeyMaterialFromMnemonic(generated)
      persistKeyMaterial(derived.keyHex, derived.mnemonic)
      setMnemonic(derived.mnemonic)
      setPrivateKey(derived.keyHex)
      setMode('mnemonic')
      setShowKeyMaterial(true)
      toast.success('New recovery phrase created and saved to this device profile.')
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to generate phrase')
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!walletManager) {
      toast.error('Peacock is still starting. Try again in a moment.')
      return
    }

    try {
      setLoading(true)
      let keyBytes: number[]
      let keyHex: string
      let normalizedMnemonic = ''

      if (mode === 'mnemonic') {
        if (!mnemonic.trim()) throw new Error('Enter your recovery phrase.')
        const derived = deriveKeyMaterialFromMnemonic(mnemonic)
        keyBytes = derived.keyBytes
        keyHex = derived.keyHex
        normalizedMnemonic = derived.mnemonic
      } else {
        keyHex = privateKey.trim()
        keyBytes = Utils.toArray(keyHex, 'hex')
        if (keyBytes.length !== 32) throw new Error('Private key must be 64 hexadecimal characters.')
      }

      await walletManager.providePrimaryKey(keyBytes)
      await walletManager.providePrivilegedKeyManager(createDisabledPrivilegedManager())
      if (!walletManager.authenticated) throw new Error('Peacock could not unlock with that key material.')

      setWalletEnvironmentStorageItem('snap', Utils.toBase64(walletManager.saveSnapshot()))
      const savedMnemonic = persistKeyMaterial(keyHex, normalizedMnemonic || undefined)
      setMnemonic(savedMnemonic)
      setPrivateKey(keyHex)
      toast.success('Peacock unlocked')
      navigate('/dashboard/home')
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to unlock Peacock')
    } finally {
      setLoading(false)
    }
  }

  const clearPendingApp = () => {
    try { sessionStorage.removeItem('appinfo') } catch { /* best effort */ }
    setAppInfo(null)
  }

  const awaitingAutoLogin = typeof window !== 'undefined' && Boolean(getWalletEnvironmentStorageItem('snap')) && !snapshotLoaded
  if (!pageLoaded || !persistedKeyLoaded || awaitingAutoLogin) return <PageLoading />

  const materialPresent = mode === 'private' ? Boolean(privateKey.trim()) : Boolean(mnemonic.trim())

  return (
    <Container
      maxWidth="sm"
      sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', py: 4 }}
    >
      <Paper elevation={0} sx={{ width: '100%', p: { xs: 3, sm: 4 } }}>
        <Stack spacing={3}>
          <Stack alignItems="center" textAlign="center" spacing={1}>
            <Box sx={{ width: 86, height: 86, color: 'primary.main' }}>
              <AppLogo rotate={false} size={86} />
            </Box>
            <Typography component="h1" variant="h3">
              {appInfo?.name ? `Unlock to continue to ${appInfo.name}` : appName}
            </Typography>
            <Typography color="text.secondary">
              Your identity and payments wallet.
            </Typography>
          </Stack>

          {appInfo && (
            <Alert
              severity="info"
              action={<IconButton aria-label="Cancel app connection" size="small" onClick={clearPendingApp}><CloseRounded /></IconButton>}
            >
              <Typography fontWeight={700}>{appInfo.name ?? 'An app'} wants to connect</Typography>
              {appOrigin && <Typography variant="body2">Origin: {appOrigin}</Typography>}
              {(appInfo.custom_message ?? appInfo.message) && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>{appInfo.custom_message ?? appInfo.message}</Typography>
              )}
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                Unlocking does not grant access. You will review the request next.
              </Typography>
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1}>
                <Button
                  variant={mode === 'mnemonic' ? 'contained' : 'outlined'}
                  onClick={() => setMode('mnemonic')}
                  disabled={loading}
                  fullWidth
                >
                  Recovery phrase
                </Button>
                <Button
                  variant={mode === 'private' ? 'contained' : 'outlined'}
                  onClick={() => setMode('private')}
                  disabled={loading}
                  fullWidth
                >
                  Hex key
                </Button>
              </Stack>

              {mode === 'mnemonic' ? (
                <TextField
                  label="Recovery phrase"
                  placeholder="Enter words separated by spaces"
                  value={mnemonic}
                  onChange={event => setMnemonic(event.target.value)}
                  fullWidth
                  multiline
                  minRows={3}
                  autoComplete="off"
                  helperText="Use the exact phrase and word order from your backup."
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton aria-label={showKeyMaterial ? 'Hide recovery phrase' : 'Show recovery phrase'} onClick={() => setShowKeyMaterial(value => !value)}>
                            {showKeyMaterial ? <VisibilityOffRounded /> : <VisibilityRounded />}
                          </IconButton>
                        </InputAdornment>
                      )
                    },
                    htmlInput: { style: showKeyMaterial ? undefined : { WebkitTextSecurity: 'disc' } }
                  }}
                />
              ) : (
                <TextField
                  label="Private key"
                  placeholder="64 hexadecimal characters"
                  value={privateKey}
                  inputRef={keyFieldRef}
                  onChange={event => setPrivateKey(event.target.value)}
                  fullWidth
                  type={showKeyMaterial ? 'text' : 'password'}
                  autoComplete="off"
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton aria-label={showKeyMaterial ? 'Hide private key' : 'Show private key'} onClick={() => setShowKeyMaterial(value => !value)}>
                            {showKeyMaterial ? <VisibilityOffRounded /> : <VisibilityRounded />}
                          </IconButton>
                        </InputAdornment>
                      )
                    }
                  }}
                />
              )}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="outlined" disabled={loading} onClick={mode === 'mnemonic' ? handleGenerateMnemonic : handleGenerateKey} fullWidth>
                  Create new {mode === 'mnemonic' ? 'phrase' : 'key'}
                </Button>
                <Button variant="contained" type="submit" disabled={loading || !materialPresent} fullWidth>
                  {loading ? <CircularProgress size={22} color="inherit" /> : 'Unlock Peacock'}
                </Button>
              </Stack>
            </Stack>
          </Box>

          <Alert severity="warning" variant="outlined">
            Peacock currently saves this key material in this device profile so it can reopen your wallet. Anyone who can access the profile may be able to read it. Keep an offline backup and never share it.
          </Alert>

          <Button
            variant="text"
            size="small"
            disabled={loading}
            aria-expanded={advancedOptionsOpen}
            aria-controls="greeter-advanced-options"
            endIcon={advancedOptionsOpen ? <ExpandLessRounded /> : <ExpandMoreRounded />}
            onClick={() => setAdvancedOptionsOpen(open => !open)}
            sx={{
              alignSelf: 'center',
              color: environment.name === 'teratestnet' ? 'warning.main' : 'text.secondary',
              textTransform: 'none'
            }}
          >
            {environment.name === 'teratestnet'
              ? 'TerraTestNet active · Network options'
              : 'Advanced options'}
          </Button>

          <Collapse in={advancedOptionsOpen} unmountOnExit>
            <Box
              id="greeter-advanced-options"
              sx={{ pt: 2, borderTop: '1px solid', borderColor: 'divider' }}
            >
              <NetworkEnvironmentSelector disabled={loading} compact />
            </Box>
          </Collapse>
        </Stack>
      </Paper>
    </Container>
  )
}

export default Greeter
