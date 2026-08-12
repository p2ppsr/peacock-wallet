import { useContext, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { WalletContext } from '../WalletContext'
import {
  prepareWalletEnvironmentSwitch,
  resolveWalletEnvironment,
  type WalletEnvironmentName,
} from '../config'

type NetworkEnvironmentSelectorProps = {
  compact?: boolean
  disabled?: boolean
}

const ENVIRONMENT_OPTIONS: WalletEnvironmentName[] = ['mainnet', 'teratestnet']

const environmentLabel = (name: WalletEnvironmentName): string =>
  name === 'mainnet' ? 'Mainnet' : 'TerraTestNet'

export default function NetworkEnvironmentSelector({
  compact = false,
  disabled = false,
}: NetworkEnvironmentSelectorProps) {
  const { environment } = useContext(WalletContext)
  const [pendingEnvironment, setPendingEnvironment] = useState<WalletEnvironmentName | null>(null)
  const [switchError, setSwitchError] = useState('')
  const pending = useMemo(
    () => pendingEnvironment ? resolveWalletEnvironment(pendingEnvironment) : null,
    [pendingEnvironment]
  )

  const switchEnvironment = () => {
    if (!pendingEnvironment || pendingEnvironment === environment.name) {
      setPendingEnvironment(null)
      return
    }
    try {
      prepareWalletEnvironmentSwitch(pendingEnvironment)
      window.location.reload()
    } catch (error) {
      setPendingEnvironment(null)
      setSwitchError((error as Error)?.message || 'Unable to switch wallet environment.')
    }
  }

  return (
    <Box data-testid="wallet-environment-selector">
      <Typography variant={compact ? 'subtitle1' : 'h4'} sx={{ mb: 0.5 }}>
        Network & services
      </Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1.5 }}>
        Choose the Bitcoin network Peacock uses for Wallet Storage, Message Box,
        transaction broadcast, and overlay discovery.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        {ENVIRONMENT_OPTIONS.map(name => {
          const selected = environment.name === name
          return (
            <Button
              key={name}
              variant={selected ? 'contained' : 'outlined'}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => {
                if (!selected) setPendingEnvironment(name)
              }}
              fullWidth
            >
              {environmentLabel(name)}
            </Button>
          )
        })}
      </Stack>
      <Alert severity={environment.name === 'mainnet' ? 'info' : 'warning'} sx={{ mt: 1.5 }}>
        {environment.name === 'mainnet'
          ? 'Mainnet is active. Transactions can spend coins with real value.'
          : 'TerraTestNet is active. Peacock is using the isolated staging service stack and TTN coins have no mainnet value.'}
      </Alert>
      {switchError && <Alert severity="error" sx={{ mt: 1.5 }}>{switchError}</Alert>}

      <Dialog open={Boolean(pending)} onClose={() => setPendingEnvironment(null)} fullWidth maxWidth="sm">
        <DialogTitle>Switch to {pending ? environmentLabel(pending.name) : ''}?</DialogTitle>
        <DialogContent dividers>
          <Alert severity={pending?.name === 'mainnet' ? 'error' : 'warning'} sx={{ mb: 2 }}>
            {pending?.name === 'mainnet'
              ? 'Mainnet uses real funds. Confirm the selected network before approving payments.'
              : 'TerraTestNet is for testing only. TTN addresses, funds, transactions, and overlay records are separate from mainnet.'}
          </Alert>
          <Typography variant="body1">
            Peacock will reload and connect to {pending?.storageUrl}. Local unlock state is kept
            separately for each network, so you may need to unlock or create a wallet profile for
            the selected network.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            Cached wallet views and pending app connections will be cleared so data from the
            current network cannot appear after the switch.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingEnvironment(null)}>Cancel</Button>
          <Button variant="contained" color={pending?.name === 'mainnet' ? 'error' : 'primary'} onClick={switchEnvironment}>
            Switch to {pending ? environmentLabel(pending.name) : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
