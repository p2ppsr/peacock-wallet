import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AppsRounded,
  ArrowForwardRounded,
  CallReceivedRounded,
  CodeRounded,
  ForumRounded,
  OpenInNewRounded,
  SendRounded,
  ShoppingBagRounded
} from '@mui/icons-material'
import {
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Container,
  Grid,
  Stack,
  Typography
} from '@mui/material'
import { openUrl } from '../../utils/openUrl'

type QuickActionProps = {
  title: string
  description: string
  icon: ReactNode
  onClick: () => void
}

const QuickAction = ({ title, description, icon, onClick }: QuickActionProps) => (
  <Card elevation={0} sx={{ height: '100%' }}>
    <CardActionArea
      onClick={onClick}
      sx={{ height: '100%', p: 2.5, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start' }}
    >
      <Stack spacing={2} width="100%">
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'action.hover',
              color: 'primary.main'
            }}
          >
            {icon}
          </Box>
          <ArrowForwardRounded color="action" fontSize="small" />
        </Stack>
        <Box>
          <Typography variant="h6" fontWeight={750}>{title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{description}</Typography>
        </Box>
      </Stack>
    </CardActionArea>
  </Card>
)

export default function Home() {
  const navigate = useNavigate()
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={1} sx={{ mb: 4 }}>
        <Chip label="Wallet ready" color="success" size="small" sx={{ alignSelf: 'flex-start' }} />
        <Typography component="h1" variant="h2">Overview</Typography>
        <Typography color="text.secondary">
          Send and receive payments, open apps, and stay in control of what they can access.
        </Typography>
      </Stack>

      <Typography variant="h5" sx={{ mb: 2 }}>Quick actions</Typography>
      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <QuickAction
            title="Send"
            description="Pay a verified identity."
            icon={<SendRounded />}
            onClick={() => navigate('/dashboard/payments?tab=send')}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <QuickAction
            title="Receive"
            description="Show your payment request."
            icon={<CallReceivedRounded />}
            onClick={() => navigate('/dashboard/payments?tab=receive')}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <QuickAction
            title="Buy sats"
            description="Add funds with Satoshi Shop."
            icon={<ShoppingBagRounded />}
            onClick={() => navigate('/dashboard/payments?tab=buy')}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <Card elevation={0} sx={{ height: '100%', p: { xs: 2.5, md: 3.5 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
              <Box
                sx={{
                  width: 72,
                  height: 72,
                  borderRadius: 2.5,
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  color: 'primary.main',
                  bgcolor: 'action.hover'
                }}
              >
                <AppsRounded sx={{ fontSize: 36 }} />
              </Box>
              <Box flex={1}>
                <Typography variant="h4">Your apps</Typography>
                <Typography color="text.secondary" sx={{ mt: 0.75, mb: 2 }}>
                  Reopen recent apps and review the permissions each app can use.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <Button variant="contained" endIcon={<ArrowForwardRounded />} onClick={() => navigate('/dashboard/apps')}>
                    Open apps
                  </Button>
                  <Button variant="outlined" endIcon={<OpenInNewRounded />} onClick={() => void openUrl('https://metanetapps.com')}>
                    Discover apps
                  </Button>
                </Stack>
              </Box>
            </Stack>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card elevation={0} sx={{ height: '100%', p: { xs: 2.5, md: 3.5 } }}>
            <Typography variant="h5">Resources</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75, mb: 2.5 }}>
              Learn how Peacock works or meet other builders.
            </Typography>
            <Stack spacing={1}>
              <Button
                color="inherit"
                startIcon={<CodeRounded />}
                endIcon={<OpenInNewRounded />}
                onClick={() => void openUrl('https://metanetacademy.com')}
                sx={{ justifyContent: 'flex-start' }}
              >
                Developer resources
              </Button>
              <Button
                color="inherit"
                startIcon={<ForumRounded />}
                endIcon={<OpenInNewRounded />}
                onClick={() => void openUrl('https://join.bsv.chat')}
                sx={{ justifyContent: 'flex-start' }}
              >
                Community
              </Button>
            </Stack>
          </Card>
        </Grid>
      </Grid>

    </Container>
  )
}
