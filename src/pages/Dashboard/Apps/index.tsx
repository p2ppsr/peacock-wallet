import { useContext, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  AppsRounded,
  OpenInNewRounded,
  PushPinOutlined,
  PushPinRounded,
  SearchRounded
} from '@mui/icons-material'
import {
  Box,
  Button,
  Container,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import Grid2 from '@mui/material/Grid2'
import { Utils } from '@bsv/sdk'
import Fuse from 'fuse.js'
import UserWalletApp from '../../../components/UserWalletApp'
import { WalletContext } from '../../../WalletContext'
import { openUrl } from '../../../utils/openUrl'
import { getRecentApps, type RecentApp, updateRecentApp } from './getApps'

const Apps = () => {
  const { managers, activeProfile, setActiveProfile } = useContext(WalletContext)
  const [apps, setApps] = useState<RecentApp[]>([])
  const [search, setSearch] = useState('')

  const profileId = activeProfile ? Utils.toBase64(activeProfile.id) : null

  useEffect(() => {
    if (profileId) setApps(getRecentApps(profileId))
  }, [profileId])

  useEffect(() => {
    const handleRecentAppsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ profileId: string }>).detail
      if (!activeProfile) {
        const walletManager = managers.walletManager as { listProfiles?: () => Array<{ active?: boolean }> }
        const resolved = walletManager?.listProfiles?.().find(profile => profile.active)
        if (resolved) setActiveProfile(resolved as never)
        return
      }
      if (detail?.profileId === profileId) setApps(getRecentApps(detail.profileId))
    }
    window.addEventListener('recentAppsUpdated', handleRecentAppsUpdate)
    return () => window.removeEventListener('recentAppsUpdated', handleRecentAppsUpdate)
  }, [activeProfile, managers.walletManager, profileId, setActiveProfile])

  const fuse = useMemo(() => new Fuse(apps, { threshold: 0.3, keys: ['name', 'domain'] }), [apps])
  const filteredApps = useMemo(() => {
    const query = search.trim()
    return query ? fuse.search(query).map(result => result.item) : apps
  }, [apps, fuse, search])
  const orderedApps = useMemo(
    () => [...filteredApps].sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned))),
    [filteredApps]
  )

  const togglePin = async (app: RecentApp) => {
    if (!profileId) return
    const updated = await updateRecentApp(profileId, { ...app, isPinned: !app.isPinned })
    setApps(updated)
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'flex-end' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography component="h1" variant="h2">Apps</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>
            Reopen apps you have used and review their wallet access.
          </Typography>
        </Box>
        <Button
          variant="contained"
          endIcon={<OpenInNewRounded />}
          onClick={() => void openUrl('https://metanetapps.com')}
        >
          Discover apps
        </Button>
      </Stack>

      <TextField
        fullWidth
        value={search}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
        label="Search your apps"
        placeholder="App name or domain"
        sx={{ maxWidth: 560, mb: 4 }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment> } }}
      />

      {orderedApps.length === 0 ? (
        <Box
          sx={{
            minHeight: 280,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 2,
            p: 4
          }}
        >
          <Stack alignItems="center" spacing={1.5}>
            <AppsRounded color="primary" sx={{ fontSize: 46 }} />
            <Typography variant="h5">{search ? 'No matching apps' : 'No recent apps yet'}</Typography>
            <Typography color="text.secondary" maxWidth={460}>
              {search
                ? 'Try a different name or domain.'
                : 'Apps appear here after they connect to Peacock. Browse the catalogue to get started.'}
            </Typography>
            {!search && (
              <Button variant="outlined" endIcon={<OpenInNewRounded />} onClick={() => void openUrl('https://metanetapps.com')}>
                Browse app catalogue
              </Button>
            )}
          </Stack>
        </Box>
      ) : (
        <Grid2 container spacing={2.5}>
          {orderedApps.map(app => (
            <Grid2 key={app.domain} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <Box sx={{ position: 'relative', height: '100%' }}>
                <UserWalletApp appName={app.name} domain={app.domain} iconImageUrl={app.iconImageUrl} />
                <Tooltip title={app.isPinned ? 'Unpin app' : 'Pin app'}>
                  <IconButton
                    aria-label={`${app.isPinned ? 'Unpin' : 'Pin'} ${app.name}`}
                    onClick={event => {
                      event.stopPropagation()
                      void togglePin(app)
                    }}
                    sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper' }}
                  >
                    {app.isPinned ? <PushPinRounded fontSize="small" /> : <PushPinOutlined fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </Box>
            </Grid2>
          ))}
        </Grid2>
      )}
    </Container>
  )
}

export default Apps
