import { useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Box,
  Button,
  Chip,
  FormControlLabel,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Radio,
  RadioGroup,
  Typography
} from '@mui/material'
import Grid2 from '@mui/material/Grid2'
import { WalletContext } from '../../../WalletContext'
import { toast } from 'react-toastify'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../../components/PageHeader'
import { DEFAULT_APP_ICON } from '../../../constants/popularApps'
import {
  SUPPORTED_FIAT_CURRENCIES,
  getCurrencyDisplayName,
  isSupportedFiatCurrency
} from '../../../utils/currency'
import { localChaintracksManager, type ChaintracksMode } from '../../../chaintracks/localChaintracks'

const AdvancedSettings: React.FC = () => {
  const { settings, updateSettings, logout } = useContext(WalletContext)
  const navigate = useNavigate()

  const [settingsLoading, setSettingsLoading] = useState(false)
  const [chainAction, setChainAction] = useState<string>()
  const chainStatus = useSyncExternalStore(
    localChaintracksManager.subscribe,
    localChaintracksManager.getSnapshot,
    localChaintracksManager.getSnapshot
  )
  const selectedCurrency = useMemo(() => (settings?.currency || 'USD').toString().toUpperCase(), [settings?.currency])

  const handleCurrencyChange = useCallback(
    async (currency: string) => {
      const next = currency.toUpperCase()
      if (selectedCurrency === next) return

      try {
        setSettingsLoading(true)
        await updateSettings({
          ...settings,
          currency: next
        })
        toast.success('Currency updated!')
      } catch (e: any) {
        toast.error(e.message)
      } finally {
        setSettingsLoading(false)
      }
    },
    [selectedCurrency, settings, updateSettings]
  )

  const fiatEntries = useMemo(() => {
    const locale = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || undefined

    const entries = SUPPORTED_FIAT_CURRENCIES.map(code => {
      const name = getCurrencyDisplayName(code, locale)
      return { code, name }
    })

    return entries.sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  const isSelectedFiat = isSupportedFiatCurrency(selectedCurrency)

  const runChainAction = useCallback(async (name: string, action: () => Promise<void>) => {
    setChainAction(name)
    try {
      await action()
      toast.success(`Chain verification ${name} completed.`)
    } catch (error: any) {
      toast.error(error?.message || `Chain verification ${name} failed.`)
    } finally {
      setChainAction(undefined)
    }
  }, [])

  const formatBytes = (bytes?: number) =>
    bytes == null ? 'Not measured' : `${(bytes / (1024 * 1024)).toFixed(1)} MiB (device total)`
  return (
    <Box
      sx={{
        width: '100%',
        px: { xs: 2, md: 3 },
        py: 3
      }}
    >
      <PageHeader
        title='Advanced Settings'
        subheading='Session settings and display preferences.'
        icon={DEFAULT_APP_ICON}
        buttonTitle=''
        onClick={() => void 0}
        showButton={false}
        showBackButton
        onBackClick={() => navigate('/dashboard/settings')}
      />

      {settingsLoading && (
        <Box sx={{ width: '100%', mt: 2, mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', mt: 3 }}>
        <Typography variant='h4' sx={{ mb: 1 }}>
          Fiat Currency
        </Typography>
        <Typography variant='body1' color='textSecondary' sx={{ mb: 2 }}>
          Choose which fiat currency you prefer for displaying balances.
        </Typography>

        <List dense disablePadding>
          {fiatEntries.map(({ code, name }) => {
            const isSelected = selectedCurrency === code
            return (
              <ListItemButton
                key={code}
                disabled={settingsLoading}
                selected={isSelected}
                onClick={() => handleCurrencyChange(code)}
                sx={{
                  borderRadius: 2,
                  mb: 0.5,
                  border: '1px solid',
                  borderColor: isSelected ? 'primary.main' : 'divider'
                }}
              >
                <ListItemText
                  primary={name}
                  secondary={code}
                  primaryTypographyProps={{ fontWeight: isSelected ? 700 : 500 }}
                />
              </ListItemButton>
            )
          })}
        </List>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', mt: 3 }}>
        <Typography variant='h4' sx={{ mb: 1 }}>
          Sats / BSV
        </Typography>
        <Typography variant='body1' color='textSecondary' sx={{ mb: 2 }}>
          Switch between Bitcoin units.
        </Typography>

        <Grid2 container spacing={2} justifyContent='center' sx={{ overflowX: 'auto' }}>
          {(
            [
              { currency: 'BSV', sample: '0.033' },
              { currency: 'SATS', sample: '3,333,333' }
            ] as const
          ).map(({ currency, sample }) => {
            const isSelected = !isSelectedFiat && selectedCurrency === currency
            return (
              <Grid2 key={currency}>
                <Button
                  variant='outlined'
                  disabled={settingsLoading}
                  onClick={() => handleCurrencyChange(currency)}
                  sx={{
                    width: 110,
                    height: 88,
                    m: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease-in-out',
                    borderRadius: 2,
                    bgcolor: isSelected ? 'action.selected' : 'transparent',
                    borderColor: isSelected ? 'primary.main' : 'divider',
                    borderWidth: isSelected ? '2px' : '1px'
                  }}
                >
                  <Typography variant='body1' fontWeight='bold'>
                    {currency}
                  </Typography>
                  <Typography variant='body2' color='textSecondary'>
                    {sample}
                  </Typography>
                </Button>
              </Grid2>
            )
          })}
        </Grid2>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', mt: 3 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
          <Typography variant="h4">Device Chain Verification</Typography>
          <Chip
            size="small"
            color={
              chainStatus.phase === 'ready' && chainStatus.consistency !== 'diverged'
                ? 'success'
                : 'warning'
            }
            label={`${chainStatus.phase} · ${chainStatus.consistency}`}
          />
        </Box>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
          Verify proof of work against a persistent chain held on this device. A packaged checkpoint
          through height {chainStatus.checkpointHeight.toLocaleString()} seeds the first run; new
          headers remain synchronized in the background. Independent network references are used
          only for consistency checks and exceptional fallback.
        </Typography>

        <RadioGroup
          row
          value={chainStatus.mode}
          onChange={(event) =>
            void runChainAction('mode change', () =>
              localChaintracksManager.setMode(event.target.value as ChaintracksMode)
            )
          }
        >
          <FormControlLabel
            value="local-primary"
            control={<Radio />}
            label="Local first (recommended)"
          />
          <FormControlLabel
            value="remote-only"
            control={<Radio />}
            label="Remote compatibility mode"
          />
        </RadioGroup>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 1,
            my: 2
          }}
        >
          <Typography variant="body2">Network: {chainStatus.chain}</Typography>
          <Typography variant="body2">Active source: {chainStatus.activeSource}</Typography>
          <Typography variant="body2">
            Local height: {chainStatus.localHeight?.toLocaleString() ?? 'Bootstrapping'}
          </Typography>
          <Typography variant="body2">
            Reference height: {chainStatus.referenceHeight?.toLocaleString() ?? 'Not checked'}
          </Typography>
          <Typography variant="body2">
            Height lag: {chainStatus.heightLag ?? 'Not checked'}
          </Typography>
          <Typography variant="body2">Storage: {formatBytes(chainStatus.storageBytes)}</Typography>
          <Typography
            variant="body2"
            sx={{ gridColumn: { sm: '1 / -1' }, overflowWrap: 'anywhere' }}
          >
            Local tip: {chainStatus.localTipHash ?? 'Not available'}
          </Typography>
          <Typography variant="body2" sx={{ gridColumn: { sm: '1 / -1' } }}>
            Last check:{' '}
            {chainStatus.checkedAt
              ? new Date(chainStatus.checkedAt).toLocaleString()
              : 'Not checked'}
          </Typography>
        </Box>

        {chainStatus.lastError && (
          <Typography variant="body2" color="error" sx={{ mb: 2, overflowWrap: 'anywhere' }}>
            {chainStatus.lastError}
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            disabled={chainAction != null}
            onClick={() => void runChainAction('sync', () => localChaintracksManager.syncNow())}
          >
            Sync now
          </Button>
          <Button
            variant="outlined"
            disabled={chainAction != null}
            onClick={() =>
              void runChainAction('consistency check', () =>
                localChaintracksManager.checkConsistency()
              )
            }
          >
            Check local tip
          </Button>
          <Button
            variant="outlined"
            color="warning"
            disabled={chainAction != null}
            onClick={() => {
              if (
                window.confirm(
                  'Clear downloaded headers and rebuild local chain state from the packaged checkpoint? Wallet keys and transaction data are not affected.'
                )
              ) {
                void runChainAction('reset', () => localChaintracksManager.clearLocalData())
              }
            }}
          >
            Clear and rebuild headers
          </Button>
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', mt: 3 }}>
        <Typography variant='h4' sx={{ mb: 1 }}>
          Session
        </Typography>
        <Typography variant='body1' color='textSecondary' sx={{ mb: 2 }}>
          Sign out of this wallet on this device.
        </Typography>
        <Button
          variant='outlined'
          color='error'
          disabled={settingsLoading}
          onClick={() => {
            logout()
            navigate('/')
          }}
          sx={{ textTransform: 'none' }}
        >
          Log out
        </Button>
      </Paper>
    </Box>
  )
}

export default AdvancedSettings
