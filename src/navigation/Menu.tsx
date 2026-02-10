import {
  Settings as SettingsIcon,
  Badge as IdentityIcon,
} from '@mui/icons-material'
import PaymentIcon from '@mui/icons-material/Payment';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import {
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Drawer,
  Box,
  Divider
} from '@mui/material'
import Profile from '../components/Profile'
import React, { useContext, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { UserContext } from '../UserContext'
import { useBreakpoint } from '../utils/useBreakpoints'
import HomeIcon from '@mui/icons-material/Home'
// Custom styling for menu items
const menuItemStyle = (isSelected: boolean) => ({
  borderRadius: '8px',
  margin: '4px 8px',
  transition: 'all 0.2s ease',
  '&:hover': {
    backgroundColor: 'rgba(25, 118, 210, 0.1)',
  },
  ...(isSelected && {
    backgroundColor: 'rgba(25, 118, 210, 0.12)',
    '&:hover': {
      backgroundColor: 'rgba(25, 118, 210, 0.2)',
    },
  }),
})

interface MenuProps {
  menuOpen: boolean
  setMenuOpen: (open: boolean) => void
  menuRef: React.RefObject<HTMLDivElement>
}


export default function Menu({ menuOpen, setMenuOpen, menuRef }: MenuProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const breakpoints = useBreakpoint()
  const { appName, appVersion } = useContext(UserContext)

  const pendingNavigationFrame = useRef<number | null>(null)
  const pendingNavigationPath = useRef<string | null>(null)

  // History.push wrapper
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && pendingNavigationFrame.current !== null) {
        window.cancelAnimationFrame(pendingNavigationFrame.current)
      }
      pendingNavigationFrame.current = null
      pendingNavigationPath.current = null
    }
  }, [])

  const navigation = useMemo(() => ({
    push: (path: string) => {
      if (!path) {
        return
      }

      const currentPath = location.pathname
      const { sm } = breakpoints as { sm: boolean }

      if (currentPath === path) {
        if (sm) {
          setMenuOpen(false)
        }
        return
      }

      if (typeof window === 'undefined') {
        if (sm) {
          setMenuOpen(false)
        }
        navigate(path)
        return
      }

      pendingNavigationPath.current = path

      if (pendingNavigationFrame.current !== null) {
        window.cancelAnimationFrame(pendingNavigationFrame.current)
      }

      pendingNavigationFrame.current = window.requestAnimationFrame(() => {
        pendingNavigationFrame.current = null
        const destination = pendingNavigationPath.current
        pendingNavigationPath.current = null

        if (sm) {
          setMenuOpen(false)
        }

        if (destination && location.pathname !== destination) {
          navigate(destination)
        }
      })
    }
  }), [navigate, breakpoints, setMenuOpen])

  // First useEffect to handle breakpoint changes
  useEffect(() => {
    // Explicitly cast breakpoints to avoid TypeScript error
    const { sm } = breakpoints as { sm: boolean }
    if (!sm) {
      setMenuOpen(true)
    } else {
      setMenuOpen(false)
    }
  }, [breakpoints])

  // Second useEffect to handle outside clicks
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    } else {
      document.removeEventListener('mousedown', handleClickOutside)
    }

    // Cleanup
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  const isPaymentsSelected = location.pathname === '/dashboard/payments' || location.pathname === '/dashboard/transfer'
  const isHomeSelected = location.pathname === '/dashboard/home' || location.pathname === '/dashboard' || location.pathname === '/dashboard/'

  return (
    <Drawer
      anchor='left'
      open={menuOpen}
      variant='persistent'
      onClose={() => setMenuOpen(false)}
      sx={(theme) => ({
        width: 320,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 320,
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: theme.palette.divider,
          boxShadow: 3,
          background: theme.palette.background.paper,
          overflowX: 'hidden',
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderTopRightRadius: theme.shape.borderRadius * 3,
          borderBottomRightRadius: theme.shape.borderRadius * 3,
        },
      })}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: 2
        }}
      >
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
          <Profile />
        </Box>

        <Divider sx={{ mb: 2 }} />

        <List component="nav" sx={{ mb: 2 }}>
          <ListItemButton
            onClick={() => navigation.push('/dashboard/home')}
            selected={isHomeSelected}
            sx={menuItemStyle(isHomeSelected)}
          >
            <ListItemIcon sx={{ minWidth: 40, color: isHomeSelected ? 'primary.main' : 'inherit' }}>
              <HomeIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={isHomeSelected ? 600 : 400}
                >
                  Home
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/identity')}
            selected={location.pathname === '/dashboard/identity'}
            sx={menuItemStyle(location.pathname === '/dashboard/identity')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: location.pathname === '/dashboard/identity' ? 'primary.main' : 'inherit' }}>
              <IdentityIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={location.pathname === '/dashboard/identity' ? 600 : 400}
                >
                  Identity
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/trust')}
            selected={location.pathname === '/dashboard/trust'}
            sx={menuItemStyle(location.pathname === '/dashboard/trust')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: location.pathname === '/dashboard/trust' ? 'primary.main' : 'inherit' }}>
              <VerifiedUserIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={location.pathname === '/dashboard/trust' ? 600 : 400}
                >
                  Trust
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/payments')}
            selected={isPaymentsSelected}
            sx={menuItemStyle(isPaymentsSelected)}
          >
            <ListItemIcon sx={{ minWidth: 40, color: isPaymentsSelected ? 'primary.main' : 'inherit' }}>
              <PaymentIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={isPaymentsSelected ? 600 : 400}
                >
                  Payments
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/settings')}
            selected={location.pathname === '/dashboard/settings'}
            sx={menuItemStyle(location.pathname === '/dashboard/settings')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: location.pathname === '/dashboard/settings' ? 'primary.main' : 'inherit' }}>
              <SettingsIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={location.pathname === '/dashboard/settings' ? 600 : 400}
                >
                  Settings
                </Typography>
              }
            />
          </ListItemButton>

        </List>


        <Box sx={{ mt: 'auto', mb: 2 }}>
          <Typography
            variant='caption'
            color='textSecondary'
            align='center'
            sx={{
              display: 'block',
              mt: 2,
              textAlign: 'center',
              width: '100%',
              opacity: 0.5,
            }}
          >
            {appName} v{appVersion}
            <br />
            <i>Made with love by the Babbage Team</i>
          </Typography>
        </Box>
      </Box>
    </Drawer>
  )
}
