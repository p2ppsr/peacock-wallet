import {
  AppsRounded,
  BadgeRounded,
  HomeRounded,
  PaymentsRounded,
  SettingsRounded,
  VerifiedUserRounded
} from '@mui/icons-material'
import {
  Box,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography
} from '@mui/material'
import React, { useContext, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Profile from '../components/Profile'
import { UserContext } from '../UserContext'
import { useBreakpoint } from '../utils/useBreakpoints'

export const WALLET_NAV_WIDTH = 264

interface MenuProps {
  menuOpen: boolean
  setMenuOpen: (open: boolean) => void
  menuRef: React.RefObject<HTMLDivElement>
}

const navItems = [
  { label: 'Overview', path: '/dashboard/home', icon: HomeRounded, testId: 'wallet-nav-home', matches: ['/dashboard', '/dashboard/home'] },
  { label: 'Apps', path: '/dashboard/apps', icon: AppsRounded, testId: 'wallet-nav-apps', matches: ['/dashboard/apps', '/dashboard/recent-apps', '/dashboard/app-catalog', '/dashboard/app/'] },
  { label: 'Payments', path: '/dashboard/payments', icon: PaymentsRounded, testId: 'wallet-nav-payments', matches: ['/dashboard/payments', '/dashboard/transfer'] },
  { label: 'Identity', path: '/dashboard/identity', icon: BadgeRounded, testId: 'wallet-nav-identity', matches: ['/dashboard/identity', '/dashboard/certificate/'] },
  { label: 'Trusted entities', path: '/dashboard/trust', icon: VerifiedUserRounded, testId: 'wallet-nav-trust', matches: ['/dashboard/trust', '/dashboard/counterparty/'] },
  { label: 'Settings', path: '/dashboard/settings', icon: SettingsRounded, testId: 'wallet-nav-settings', matches: ['/dashboard/settings'] }
]

export default function Menu({ menuOpen, setMenuOpen, menuRef }: MenuProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const breakpoints = useBreakpoint()
  const { appVersion } = useContext(UserContext)
  const pendingNavigationFrame = useRef<number | null>(null)
  const isCompact = (breakpoints as { sm: boolean }).sm

  const navigation = useMemo(() => ({
    push: (path: string) => {
      if (location.pathname === path) {
        if (isCompact) setMenuOpen(false)
        return
      }

      if (pendingNavigationFrame.current !== null) {
        window.cancelAnimationFrame(pendingNavigationFrame.current)
      }
      pendingNavigationFrame.current = window.requestAnimationFrame(() => {
        navigate(path)
        if (isCompact) setMenuOpen(false)
        pendingNavigationFrame.current = null
      })
    }
  }), [isCompact, location.pathname, navigate, setMenuOpen])

  useEffect(() => {
    setMenuOpen(!isCompact)
  }, [isCompact, setMenuOpen])

  useEffect(() => () => {
    if (pendingNavigationFrame.current !== null) {
      window.cancelAnimationFrame(pendingNavigationFrame.current)
    }
  }, [])

  return (
    <Drawer
      anchor="left"
      open={menuOpen}
      variant={isCompact ? 'temporary' : 'persistent'}
      onClose={() => setMenuOpen(false)}
      ModalProps={{ keepMounted: true }}
      sx={(theme) => ({
        width: WALLET_NAV_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: WALLET_NAV_WIDTH,
          boxSizing: 'border-box',
          borderRight: `1px solid ${theme.palette.divider}`,
          borderRadius: 0,
          background: theme.palette.background.paper,
          overflowX: 'hidden'
        }
      })}
    >
      <Box ref={menuRef} sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: 1, py: 1.25 }}>
          <Box sx={{ width: 38, height: 38, color: 'primary.main', flexShrink: 0 }}>
            <Logo title="Peacock Wallet" />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={750} lineHeight={1.15}>Peacock</Typography>
            <Typography variant="caption" color="text.secondary">Identity &amp; payments</Typography>
          </Box>
        </Stack>

        <Box sx={{ my: 2 }}><Profile /></Box>
        <Divider sx={{ mb: 1.5 }} />

        <List component="nav" aria-label="Peacock navigation" sx={{ p: 0 }}>
          {navItems.map(({ label, path, icon: Icon, testId, matches }) => {
            const selected = matches.some(match => match === '/dashboard'
              ? location.pathname === match || location.pathname === '/dashboard/'
              : location.pathname === match || location.pathname.startsWith(match))

            return (
              <ListItemButton
                key={path}
                aria-label={label}
                data-testid={testId}
                data-proofrun={testId}
                onClick={() => navigation.push(path)}
                selected={selected}
                sx={(theme) => ({
                  borderRadius: 1.5,
                  minHeight: 46,
                  mb: 0.5,
                  px: 1.25,
                  color: selected ? 'text.primary' : 'text.secondary',
                  '&.Mui-selected': {
                    bgcolor: theme.palette.mode === 'light' ? 'rgba(8,111,104,0.11)' : 'rgba(99,230,208,0.12)'
                  },
                  '&.Mui-selected:hover': {
                    bgcolor: theme.palette.mode === 'light' ? 'rgba(8,111,104,0.16)' : 'rgba(99,230,208,0.18)'
                  }
                })}
              >
                <ListItemIcon sx={{ minWidth: 38, color: selected ? 'primary.main' : 'inherit' }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={label} primaryTypographyProps={{ fontWeight: selected ? 700 : 520 }} />
              </ListItemButton>
            )
          })}
        </List>

        <Box sx={{ mt: 'auto', px: 1, pt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Peacock Wallet v{appVersion}
          </Typography>
        </Box>
      </Box>
    </Drawer>
  )
}
