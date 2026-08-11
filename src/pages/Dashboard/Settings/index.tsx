import { useState, useContext, useEffect, useMemo, useCallback } from 'react'
import {
  Typography,
  LinearProgress,
  Box,
  Paper,
  Button,
  Checkbox,
  FormControlLabel,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Stack
} from '@mui/material'
import Grid2 from '@mui/material/Grid2'
import { WalletContext } from '../../../WalletContext'
import DarkModeImage from '../../../images/darkMode'
import LightModeImage from '../../../images/lightMode'
import ComputerIcon from '@mui/icons-material/Computer'
import { UserContext } from '../../../UserContext'
import PageLoading from '../../../components/PageLoading'
import { toast } from 'react-toastify'
import { useNavigate } from 'react-router-dom'
import { reconcileStoredKeyMaterial } from '../../../utils/keyMaterial'
import {
  DIAGNOSTICS_PREFERENCE_EVENT,
  getDiagnosticsEnabled,
  setDiagnosticsEnabled
} from '../../../diagnostics'

const Settings: React.FC = () => {
  const { settings, updateSettings } = useContext(WalletContext)
  const { pageLoaded, appVersion } = useContext(UserContext)
  const theme = useTheme()
  const navigate = useNavigate()
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [diagnosticsEnabled, setDiagnosticsPreference] = useState(getDiagnosticsEnabled)
  const isDarkMode = theme.palette.mode === 'dark'
  const [privateKeyHex, setPrivateKeyHex] = useState('')
  const [savedMnemonic, setSavedMnemonic] = useState('')
  const [warningOpen, setWarningOpen] = useState(false)
  const [revealType, setRevealType] = useState<'mnemonic' | 'hex' | 'both' | null>(null)
  const [showSecrets, setShowSecrets] = useState(false)

  const [selectedTheme, setSelectedTheme] = useState<string>(settings?.theme?.mode || 'system')
  const phraseWordCount = useMemo(
    () => (savedMnemonic.trim() ? savedMnemonic.trim().split(/\s+/).length : 0),
    [savedMnemonic]
  )

  useEffect(() => {
    if (settings?.theme?.mode) {
      setSelectedTheme(settings.theme.mode)
    }
  }, [settings])

  useEffect(() => {
    const syncPreference = () => setDiagnosticsPreference(getDiagnosticsEnabled())
    window.addEventListener(DIAGNOSTICS_PREFERENCE_EVENT, syncPreference)
    return () => window.removeEventListener(DIAGNOSTICS_PREFERENCE_EVENT, syncPreference)
  }, [])

  const loadStoredKeys = useCallback(() => {
    if (typeof window === 'undefined') return
    const { keyHex, mnemonic } = reconcileStoredKeyMaterial()
    setPrivateKeyHex(keyHex)
    setSavedMnemonic(mnemonic)
  }, [])

  useEffect(() => {
    loadStoredKeys()
  }, [loadStoredKeys])

  const handleThemeChange = async (themeOption: string) => {
    if (selectedTheme === themeOption) return

    try {
      setSettingsLoading(true)

      await updateSettings({
        ...settings,
        theme: {
          mode: themeOption
        }
      })

      setSelectedTheme(themeOption)

      toast.success('Theme updated!')
    } catch (e) {
      toast.error(e.message)
      setSelectedTheme(settings?.theme?.mode || 'system')
    } finally {
      setSettingsLoading(false)
    }
  }

  const handleReveal = (type: 'mnemonic' | 'hex' | 'both') => {
    setRevealType(type)
    setWarningOpen(true)
    setShowSecrets(false)
  }

  const handleCloseWarning = () => {
    setWarningOpen(false)
    setRevealType(null)
    setShowSecrets(false)
  }


  const renderThemeIcon = (themeType: string) => {
    switch (themeType) {
      case 'light':
        return <LightModeImage />
      case 'dark':
        return <DarkModeImage />
      case 'system':
        return <ComputerIcon sx={{ fontSize: 40 }} />
      default:
        return null
    }
  }

  const getThemeButtonStyles = (themeType: string) => {
    switch (themeType) {
      case 'light':
        return {
          color: 'text.primary',
          backgroundColor: 'background.paper'
        }
      case 'dark':
        return {
          color: 'common.white',
          backgroundColor: 'grey.800'
        }
      case 'system':
        return {
          color: theme.palette.mode === 'dark' ? 'common.white' : 'text.primary',
          backgroundColor: theme.palette.mode === 'dark' ? 'grey.800' : 'background.paper',
          backgroundImage: theme.palette.mode === 'dark'
            ? 'linear-gradient(135deg, #474747 0%, #111111 100%)'
            : 'linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%)',
        }
      default:
        return {}
    }
  }

  const getSelectedButtonStyle = (isSelected: boolean) => {
    if (!isSelected) return {}

    return isDarkMode
      ? {
        borderColor: 'common.white',
        borderWidth: '2px',
        outline: '1px solid rgba(255, 255, 255, 0.5)',
        boxShadow: 'none'
      }
      : {
        borderColor: 'primary.main',
        borderWidth: '2px',
        boxShadow: 3
      }
  }

  const hasMnemonic = !!savedMnemonic.trim()
  const hasHex = !!privateKeyHex.trim()
  const selectionLabel = useMemo(() => {
    if (revealType === 'both') return 'your recovery phrase and hex key'
    if (revealType === 'mnemonic') return 'your recovery phrase'
    if (revealType === 'hex') return 'your hex key'
    return 'your key material'
  }, [revealType])

  if (!pageLoaded) {
    return <PageLoading />
  }

  return (
    <Box
      sx={{
        maxWidth: 800,
        mx: 'auto',
        px: { xs: 2, md: 3 },
        py: 3
      }}
    >
      <Typography variant="h1" color="textPrimary" sx={{ mb: 2 }}>
        Settings
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
        Control Peacock's appearance, privacy, recovery material, and advanced behavior.
      </Typography>

      {settingsLoading && (
        <Box sx={{ width: '100%', mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 1 }}>
          Privacy & diagnostics
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 1 }}>
          Help us find startup, update, wallet connection, and unexpected app failures.
        </Typography>
        <FormControlLabel
          control={(
            <Checkbox
              checked={diagnosticsEnabled}
              onChange={event => {
                const enabled = event.target.checked
                setDiagnosticsEnabled(enabled)
                setDiagnosticsPreference(enabled)
                toast.success(enabled
                  ? 'Anonymous diagnostics enabled.'
                  : 'Diagnostics disabled and queued reports removed.')
              }}
            />
          )}
          label="Send anonymous diagnostics and crash reports"
        />
        <Typography variant="body2" color="textSecondary">
          Reports include the app version, operating-system class, failure category, and redacted
          error details. They never include keys, recovery phrases, wallet identity, transaction
          data, certificates, or message contents. Uncheck this box to opt out at any time.
        </Typography>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Appearance
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          Select a theme that's comfortable for your eyes.
        </Typography>

        <Grid2 container spacing={3} justifyContent="center">
          {(['light', 'dark', 'system'] as const).map(themeOption => {
            const isSelected = selectedTheme === themeOption
            return (
              <Grid2 key={themeOption}>
                <Button
                  aria-pressed={isSelected}
                  onClick={() => handleThemeChange(themeOption)}
                  disabled={settingsLoading}
                  sx={{
                    width: 130,
                    height: 130,
                    borderRadius: 3,
                    border: '2px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease-in-out',
                    ...getThemeButtonStyles(themeOption),
                    ...(isSelected && getSelectedButtonStyle(true))
                  }}
                >
                  {renderThemeIcon(themeOption)}
                  <Typography variant="body2" sx={{ mt: 1, fontWeight: isSelected ? 'bold' : 'normal' }}>
                    {themeOption.charAt(0).toUpperCase() + themeOption.slice(1)}
                  </Typography>
                </Button>
              </Grid2>
            )
          })}
        </Grid2>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', mb: 4, mt: 4 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Private Key Management
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
          Export the key material saved during sign-in. Only reveal this information when you are sure nobody else can see your screen.
        </Typography>
        <Alert severity="warning" sx={{ mb: 3 }}>
          Anyone with these words or your hex key can move your funds and impersonate you. Keep them offline and out of sight.
        </Alert>
        <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }}>
          <Button
            variant="outlined"
            disabled={!hasMnemonic}
            onClick={() => handleReveal('mnemonic')}
            sx={{ textTransform: 'none', flex: 1 }}
          >
            Reveal recovery phrase
          </Button>
          <Button
            variant="outlined"
            disabled={!hasHex}
            onClick={() => handleReveal('hex')}
            sx={{ textTransform: 'none', flex: 1 }}
          >
            Reveal hex key
          </Button>
          <Button
            variant="contained"
            disabled={!hasMnemonic && !hasHex}
            onClick={() => handleReveal('both')}
            sx={{ textTransform: 'none', flex: 1 }}
          >
            Reveal both
          </Button>
        </Stack>
        <Button
          onClick={loadStoredKeys}
          size="small"
          sx={{ mt: 2, textTransform: 'none' }}
        >
          Refresh saved keys
        </Button>
        {!hasMnemonic && !hasHex && (
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
            No keys available yet. Unlock your wallet through the greeter to save your phrase or hex key locally.
          </Typography>
        )}
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 1 }}>
          Advanced
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
          Manage currency, wallet sessions, storage, and developer-oriented controls.
        </Typography>
        <Button
          variant="outlined"
          disabled={settingsLoading}
          onClick={() => navigate('/dashboard/settings/advanced')}
        >
          Open advanced settings
        </Button>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 1 }}>About Peacock</Typography>
        <Typography variant="body1" color="textSecondary">
          Peacock Wallet v{appVersion}. Your identity and payments wallet for BRC-100 apps.
        </Typography>
      </Paper>

      <Dialog
        open={warningOpen}
        onClose={handleCloseWarning}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Keep your keys private</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Make sure no one is watching your screen or recording it before you proceed.
          </Alert>
          <Typography variant="body1">
            You are about to reveal {selectionLabel}. Treat it like cash—anyone who sees it can take your funds.
          </Typography>

          {showSecrets && (
            <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
              {revealType !== 'hex' && (
                <Box>
                  <Typography variant="subtitle1" sx={{ mb: 1 }}>
                    Recovery phrase{phraseWordCount ? ` (${phraseWordCount} words)` : ''}
                  </Typography>
                  {hasMnemonic ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {savedMnemonic.trim().split(/\s+/).map((word, idx) => (
                        <Box
                          key={`${word}-${idx}`}
                          sx={{
                            px: 1.1,
                            py: 0.6,
                            borderRadius: 1,
                            bgcolor: 'action.hover',
                            fontSize: '0.9rem'
                          }}
                        >
                          {idx + 1}. {word}
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="textSecondary">
                      No phrase saved on this device.
                    </Typography>
                  )}
                </Box>
              )}

              {revealType !== 'mnemonic' && (
                <Box>
                  <Typography variant="subtitle1" sx={{ mb: 1 }}>
                    Hex key
                  </Typography>
                  {hasHex ? (
                    <Box
                      sx={{
                        fontFamily: 'monospace',
                        p: 2,
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                        wordBreak: 'break-all'
                      }}
                    >
                      {privateKeyHex}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="textSecondary">
                      No hex key saved on this device.
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseWarning}>Close</Button>
          {!showSecrets && (
            <Button variant="contained" onClick={() => setShowSecrets(true)}>
              Reveal now
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default Settings
