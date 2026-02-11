import { useCallback, useContext, useMemo, useState } from 'react'
import {
  Box,
  Button,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
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

const AdvancedSettings: React.FC = () => {
  const { settings, updateSettings, logout } = useContext(WalletContext)
  const navigate = useNavigate()

  const [settingsLoading, setSettingsLoading] = useState(false)
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
