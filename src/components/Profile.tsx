import { useState, useEffect, useContext, useCallback, useRef } from 'react'
import AmountDisplay from './AmountDisplay'
import { Box, IconButton, Skeleton, Stack, Tooltip, Typography } from '@mui/material'
import { WalletContext } from '../WalletContext'
import { RefreshRounded, VisibilityOffRounded, VisibilityRounded } from '@mui/icons-material'

const Profile = () => {
  const { managers, adminOriginator } = useContext(WalletContext)
  const [accountBalance, setAccountBalance] = useState<number | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [balanceVisible, setBalanceVisible] = useState(true)

  const refreshBalance = useCallback(async () => {
    try {
      if (!managers?.permissionsManager) {
        return
      }
      // Only show loading state on initial load, not on refreshes
      if (isInitialLoad) {
        setBalanceLoading(true)
      }
      const limit = 10000
      let offset = 0
      let allOutputs = []

      // Fetch the first page
      const firstPage = await managers.permissionsManager.listOutputs({ basket: 'default', limit, offset }, adminOriginator)
      allOutputs = firstPage.outputs;
      const totalOutputs = firstPage.totalOutputs;

      // Fetch subsequent pages until we've retrieved all outputs
      while (allOutputs.length < totalOutputs) {
        offset += limit;
        const { outputs } = await managers.permissionsManager.listOutputs({ basket: 'default', limit, offset }, adminOriginator);
        allOutputs = allOutputs.concat(outputs);
      }

      const total = allOutputs.reduce((acc, output) => acc + output.satoshis, 0)
      setAccountBalance(total)
      if (isInitialLoad) {
        setBalanceLoading(false)
        setIsInitialLoad(false)
      }
    } catch (e) {
      if (isInitialLoad) {
        setBalanceLoading(false)
        setIsInitialLoad(false)
      }
    }
  }, [managers, adminOriginator, isInitialLoad])

  useEffect(() => {
    refreshBalance()
  }, [refreshBalance])

  // Keep a ref to the latest refreshBalance function
  const refreshBalanceRef = useRef(refreshBalance)

  useEffect(() => {
    refreshBalanceRef.current = refreshBalance
  }, [refreshBalance])

  // Refresh balance when window regains focus
  useEffect(() => {
    const handleFocus = () => {
      refreshBalanceRef.current()
    }

    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  return (
    <Stack alignItems="stretch" spacing={0.5} sx={{ px: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing="0.08em">
          Balance
        </Typography>
        <Box>
          <Tooltip title={balanceVisible ? 'Hide balance' : 'Show balance'}>
            <IconButton
              size="small"
              aria-label={balanceVisible ? 'Hide balance' : 'Show balance'}
              onClick={() => setBalanceVisible(visible => !visible)}
            >
              {balanceVisible ? <VisibilityOffRounded fontSize="small" /> : <VisibilityRounded fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Refresh balance">
            <IconButton size="small" aria-label="Refresh balance" onClick={() => void refreshBalance()}>
              <RefreshRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Stack>
      <Typography color="text.primary" variant="h5" fontWeight={750} aria-live="polite">
        {!managers?.permissionsManager || balanceLoading
          ? <Skeleton width={120} />
          : balanceVisible
            ? <AmountDisplay abbreviate>{accountBalance}</AmountDisplay>
            : '••••••'}
      </Typography>
    </Stack>
  )
}

export default Profile
