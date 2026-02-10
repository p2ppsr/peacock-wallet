import { useContext, useMemo, useState, type JSX } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Card,
  CardActionArea,
  Container,
  Grid,
  Stack,
  Typography,
  useTheme,
  alpha
} from '@mui/material'
import type { WalletInterface } from '@bsv/sdk'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import CallReceivedRoundedIcon from '@mui/icons-material/CallReceivedRounded'
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import { openUrl } from '../../utils/openUrl'
import CustomDialog from '../../components/CustomDialog'
import { WalletContext } from '../../WalletContext'
import { ExchangeRateContext } from '../../components/AmountDisplay/ExchangeRateContextProvider'
import { showSatoshiShopFundingModal, showSatoshiShopPendingTransactionsModal } from '../Shop/shopModal'

// --- Animations ---
const hoverLift = {
  transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease',
  '&:hover': {
    transform: 'translateY(-6px)',
    boxShadow: (theme: any) => `0 12px 24px -10px ${alpha(theme.palette.primary.main, 0.4)}`
  }
}

const pulseAnimation = {
  '@keyframes pulse': {
    '0%': { boxShadow: '0 0 0 0 currentColor' },
    '70%': { boxShadow: '0 0 0 15px rgba(0, 0, 0, 0)' },
    '100%': { boxShadow: '0 0 0 0 rgba(0, 0, 0, 0)' }
  }
}

type HomeAction = {
  key: string
  title: string
  description: string
  icon: JSX.Element
  onClick: () => void
  highlight?: boolean // Prop to identify standard high-vis items
}

export default function Home() {
  const navigate = useNavigate()
  const theme = useTheme()

  const { managers } = useContext(WalletContext)
  const rates = useContext<any>(ExchangeRateContext)
  const [buySellOpen, setBuySellOpen] = useState(false)
  const [isFunding, setIsFunding] = useState(false)

  const walletClientForFunding = useMemo<WalletInterface | null>(() => {
    const pm = managers?.permissionsManager as any
    const underlying = pm?.underlying as WalletInterface | undefined
    return underlying ?? null
  }, [managers?.permissionsManager])

  const isLight = theme.palette.mode === 'light'

  // 1. We separate the "Hero" action (Use Apps) from the others
  const heroAction = useMemo<HomeAction>(() => ({
    key: 'use-apps',
    title: 'Launch Apps',
    description: 'Enter the ecosystem. Browse and launch apps built for your identity.',
    icon: <AppsRoundedIcon sx={{ fontSize: 48 }} />, // Larger Icon
    onClick: () => { void openUrl('https://metanetapps.com') }
  }), [navigate])

  // 2. The remaining "Control Panel" actions
  const secondaryActions = useMemo<HomeAction[]>(() => ([
    {
      key: 'send',
      title: 'Send',
      description: 'Pay instantly.',
      icon: <SendRoundedIcon />,
      onClick: () => navigate('/dashboard/payments?tab=send')
    },
    {
      key: 'receive',
      title: 'Receive',
      description: 'Get paid.',
      icon: <CallReceivedRoundedIcon />,
      onClick: () => navigate('/dashboard/payments?tab=receive')
    },
    {
      key: 'buy',
      title: 'Buy / Sell',
      description: 'Manage coins.',
      icon: <ShoppingBagRoundedIcon />,
      onClick: () => { setBuySellOpen(true) }
    },
    {
      key: 'build-apps',
      title: 'Build',
      description: 'Dev resources.',
      icon: <CodeRoundedIcon />,
      onClick: () => { void openUrl('https://metanetacademy.com') }
    },
    {
      key: 'questions',
      title: 'Community',
      description: 'Join BSV Chat.',
      icon: <ChatBubbleOutlineRoundedIcon />,
      onClick: () => { void openUrl('https://join.bsv.chat') }
    }
  ]), [navigate])

  const handleBuy = async () => {
    const wallet = walletClientForFunding
    if (!wallet) {
      setBuySellOpen(false)
      return
    }

    try {
      setIsFunding(true)
      await showSatoshiShopFundingModal(wallet, 0, {
        title: 'Buy BSV Satoshis',
        introText: 'Use your card to top up your BSV wallet.',
        postPurchaseText: 'Once your sats arrive, you can spend them from your wallet.',
        cancelText: 'Close',
        marketSatoshisPerUSD: rates?.satoshisPerUSD
      })
    } finally {
      setIsFunding(false)
      setBuySellOpen(false)
    }
  }

  const handlePendingTransactions = async () => {
    const wallet = walletClientForFunding
    if (!wallet) {
      setBuySellOpen(false)
      return
    }

    try {
      setIsFunding(true)
      await showSatoshiShopPendingTransactionsModal(wallet, {
        title: 'Buy BSV Satoshis',
        introText: 'Use your card to top up your BSV wallet.',
        postPurchaseText: 'Once your sats arrive, you can spend them from your wallet.',
        cancelText: 'Close',
        marketSatoshisPerUSD: rates?.satoshisPerUSD
      })
    } finally {
      setIsFunding(false)
      setBuySellOpen(false)
    }
  }

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 8 } }}>
      
      {/* Header Section */}
      <Stack spacing={1} sx={{ mb: 5, textAlign: 'center' }}>
        <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: '-0.02em' }}>
          Command Center
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your digital life from one place.
        </Typography>
      </Stack>

      {/* Main Grid Layout */}
      <Grid container spacing={3}>
        
        {/* HERO CARD: "Use Apps" */}
        {/* Spans full width on small screens, full width on top of grid */}
        <Grid item xs={12}>
          <Card
            elevation={0}
            sx={{
              position: 'relative',
              overflow: 'visible', // allow glow to spill out
              borderRadius: 5,
              background: isLight
                ? 'linear-gradient(145deg, rgba(255,255,255,0.95), rgba(242,245,255,0.96))'
                : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)}, ${alpha(theme.palette.secondary.main, 0.2)})`,
              color: theme.palette.text.primary,
              border: `1px solid ${alpha(theme.palette.primary.main, isLight ? 0.15 : 0.25)}`,
              boxShadow: isLight
                ? '0 12px 35px rgba(64, 75, 105, 0.15)'
                : '0 16px 38px rgba(0,0,0,0.35)',
              ...pulseAnimation,
              animation: 'pulse 3s infinite',
              transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
              '&:hover': {
                transform: 'scale(1.02)',
                zIndex: 10,
              }
            }}
          >
            <CardActionArea 
              onClick={heroAction.onClick}
              sx={{ p: { xs: 4, md: 6 }, height: '100%' }}
            >
              <Stack direction={{ xs: 'column', sm: 'row' }} alignItems="center" spacing={4} justifyContent="center">
                {/* Icon Circle */}
                <Box
                  sx={{
                    width: 100,
                    height: 100,
                    borderRadius: '50%',
                    bgcolor: isLight
                      ? alpha(theme.palette.primary.main, 0.1)
                      : alpha(theme.palette.common.white, 0.15),
                    backdropFilter: 'blur(10px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: isLight
                      ? '0 10px 24px rgba(64, 75, 105, 0.18)'
                      : '0 8px 32px rgba(0,0,0,0.25)',
                    border: `1px solid ${alpha(isLight ? theme.palette.primary.main : theme.palette.common.white, 0.25)}`,
                    color: theme.palette.primary.main
                  }}
                >
                  {heroAction.icon}
                </Box>

                {/* Text Content */}
                <Stack spacing={1} alignItems={{ xs: 'center', sm: 'flex-start' }} textAlign={{ xs: 'center', sm: 'left' }}>
                  <Typography variant="h4" fontWeight={800}>
                    {heroAction.title}
                  </Typography>
                  <Typography variant="h6" sx={{ opacity: 0.9, fontWeight: 400, maxWidth: 400 }}>
                    {heroAction.description}
                  </Typography>
                  
                  {/* Fake "Button" for visual affordance */}
                  <Stack direction="row" spacing={1.25} sx={{ mt: 2, alignItems: 'center' }}>
                    <Box
                      sx={{
                        py: 1,
                        px: 3,
                        background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                        color: theme.palette.common.white,
                        borderRadius: 50,
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        textTransform: 'uppercase',
                        fontSize: '0.85rem',
                        letterSpacing: '0.05em'
                      }}
                    >
                      Open Portal <LaunchRoundedIcon fontSize="small" />
                    </Box>

                    <Box
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        navigate('/dashboard/recent-apps')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          navigate('/dashboard/recent-apps')
                        }
                      }}
                      sx={{
                        py: 1,
                        px: 2.25,
                        borderRadius: 50,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        textTransform: 'uppercase',
                        fontSize: '0.85rem',
                        letterSpacing: '0.05em',
                        border: `1px solid ${alpha(theme.palette.primary.main, isLight ? 0.25 : 0.45)}`,
                        backgroundColor: alpha(theme.palette.background.paper, isLight ? 0.7 : 0.08),
                        color: theme.palette.text.primary,
                        cursor: 'pointer',
                        userSelect: 'none',
                        '&:hover': {
                          backgroundColor: alpha(theme.palette.primary.main, isLight ? 0.08 : 0.18)
                        },
                        '&:focus-visible': {
                          outline: `2px solid ${theme.palette.primary.main}`,
                          outlineOffset: 2
                        }
                      }}
                    >
                      Recent Apps <HistoryRoundedIcon fontSize="small" />
                    </Box>
                  </Stack>
                </Stack>
              </Stack>
            </CardActionArea>
          </Card>
        </Grid>

        {/* SECONDARY ACTIONS */}
        {/* A tighter grid for the utilitarian items */}
        {secondaryActions.map((action, index) => (
          // Logic: First 3 items (Financial) take 4 columns each (3 per row).
          // Last 2 items (Info/Comm) take 6 columns each (2 per row) for visual balance.
          <Grid item xs={12} sm={6} md={index < 3 ? 4 : 6} key={action.key}>
            <Card
              elevation={0}
              sx={{
                height: '100%',
                borderRadius: 4,
                border: `1px solid ${theme.palette.divider}`,
                bgcolor: theme.palette.background.paper,
                ...hoverLift
              }}
            >
              <CardActionArea
                onClick={action.onClick}
                sx={{
                  height: '100%',
                  p: 3,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 2
                }}
              >
                <Stack direction="row" justifyContent="space-between" width="100%">
                   <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 3,
                      bgcolor: alpha(theme.palette.primary.main, 0.08),
                      color: 'primary.main',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {action.icon}
                  </Box>
                  {/* Subtle arrow to indicate action */}
                  <LaunchRoundedIcon sx={{ color: 'text.disabled', fontSize: 20 }} />
                </Stack>
               
                <Box>
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    {action.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                    {action.description}
                  </Typography>
                </Box>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      <CustomDialog
        open={buySellOpen}
        onClose={isFunding ? undefined : () => setBuySellOpen(false)}
        title="Buy / Sell BSV"
      >
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Typography variant="body1">
            Choose how you want to manage your BSV satoshis.
          </Typography>

          <Stack direction="column" spacing={2}>
            <Box
              sx={{
                flex: 1,
                p: 2,
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'divider'
              }}
            >
              <Typography variant="h6" gutterBottom>
                Buy
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Purchase BSV satoshis with your card via Satoshi Shop.
              </Typography>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                disabled={isFunding}
                onClick={handleBuy}
              >
                {isFunding ? 'Opening Buy Flow…' : 'Buy Sats'}
              </Button>

              <Box sx={{ mt: 1.25, display: 'flex', justifyContent: 'center' }}>
                <Button
                  variant="text"
                  color="inherit"
                  size="small"
                  disabled={isFunding}
                  onClick={handlePendingTransactions}
                  sx={{ textTransform: 'none', opacity: 0.9 }}
                >
                  {isFunding ? 'Opening…' : 'Pending Transactions'}
                </Button>
              </Box>
            </Box>

            <Box
              sx={{
                flex: 1,
                p: 2,
                borderRadius: 3,
                border: '1px dashed',
                borderColor: 'divider',
                opacity: 0.7
              }}
            >
              <Typography variant="h6" gutterBottom>
                Sell
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Coming Soon
              </Typography>
              <Button
                variant="outlined"
                color="inherit"
                fullWidth
                disabled
              >
                Sell (Coming Soon)
              </Button>
            </Box>
          </Stack>
        </Stack>
      </CustomDialog>
    </Container>
  )
}
