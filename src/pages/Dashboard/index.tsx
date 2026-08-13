import { useState, useContext, useRef, useCallback, useMemo, useEffect } from 'react';
import { useBreakpoint } from '../../utils/useBreakpoints';
import { Routes, Route, Navigate } from 'react-router-dom';
import style from '../../navigation/style';
import {
  Typography,
  IconButton,
  Toolbar,
  Button,
  DialogActions,
  Dialog,
  DialogContent,
  DialogTitle,
  Box,
  Alert,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PageLoading from '../../components/PageLoading';
import Menu, { WALLET_NAV_WIDTH } from '../../navigation/Menu';
import { Menu as MenuIcon } from '@mui/icons-material';
import MyIdentity from './MyIdentity'; // Assuming index.tsx or similar
import Trust from './Trust'; // Assuming index.tsx or similar
import Apps from './Apps';
import App from './App/Index'; // Assuming index.tsx or similar
import Settings from './Settings'; // Assuming index.tsx or similar
import { UserContext } from '../../UserContext';
import Home from './Home';
import Transfer from './Transfer';
// Import the components for the new routes
// Note: These might still be .jsx files and need refactoring later
import AppAccess from './AppAccess'; // Assuming index.jsx or similar
import BasketAccess from './BasketAccess'; // Assuming index.jsx or similar
import ProtocolAccess from './ProtocolAccess'; // Assuming index.jsx or similar
import CounterpartyAccess from './CounterpartyAccess'; // Assuming index.jsx or similar
import CertificateAccess from './CertificateAccess'; // Assuming index.jsx or similar
import AdvancedSettings from './Settings/Advanced'
import { WalletContext } from '../../WalletContext';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'react-toastify';
/**
 * Renders the Dashboard layout with routing for sub-pages.
 */
export default function Dashboard() {
  const { pageLoaded } = useContext(UserContext);
  const { activeProfile, environment } = useContext(WalletContext)
  const breakpoints = useBreakpoint();
  const theme = useTheme();
  const styles = useMemo(() => style(theme, { breakpoints }), [theme, breakpoints]);
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(true);
  // TODO: Fetch actual identity key instead of hardcoding 'self'
  const profileKey = String(activeProfile?.id ?? activeProfile?.name ?? 'none')
  const [myIdentityKey] = useState('self');
  const [redirectOpen, setRedirectOpen] = useState(false)
  type RedirectAppInfo = { name: string; Originator: string; custom_message?: string }
  const [redirectApp, setRedirectApp] = useState<RedirectAppInfo | null>(null)
  const redirectDomain = useMemo(() => {
    if (!redirectApp?.Originator) return ''
    try {
      return new URL(redirectApp.Originator).host
    } catch {
      return redirectApp.Originator
    }
  }, [redirectApp])

  useEffect(() => {
    try {
      const appinfo = sessionStorage.getItem('appinfo')
      if (!appinfo) return
      const parsed = JSON.parse(appinfo)
      setRedirectApp(parsed)
      setRedirectOpen(true)
    } catch {
      // ignore JSON/DOM exceptions when session storage not available
    } finally {
      sessionStorage.removeItem('appinfo')
    }
  }, [])

  const handleRedirectContinue = useCallback(() => {
    const url = redirectApp?.Originator
    // Close any open modals/dialogs immediately
    setRedirectOpen(false)
    if (!url) return

    // Defer opening the URL until after the dialog has unmounted to avoid any overlay/focus issues
    setTimeout(() => {
      try {
        openUrl(url)
      } catch {
        toast.error('Failed to open app')
      }
    }, 0)
  }, [redirectApp])

  const getMargin = () => {
    if (menuOpen && !breakpoints.sm) {
      // Adjust margin based on Menu width if needed
      return `${WALLET_NAV_WIDTH}px`;
    }
    return '0px';
  };

  if (!pageLoaded) {
    return <PageLoading />;
  }

  return (
    <Box key={profileKey} sx={{ ...styles.content_wrap, marginLeft: getMargin(), transition: 'margin 0.3s ease' }}>
      <div style={{
        marginLeft: 0,
        width: menuOpen ? `calc(100vw - ${getMargin()})` : '100vw',
        transition: 'width 0.3s ease, margin 0.3s ease'
      }}>
        {environment.name !== 'mainnet' && (
          <Alert severity="warning" variant="filled" sx={{ borderRadius: 0 }}>
            {environment.name === 'teratestnet' ? 'TerraTestNet' : 'Testnet'} wallet — funds have no mainnet value.
          </Alert>
        )}
        {redirectOpen && (
        <Dialog
          open
          onClose={() => {
            try {
              sessionStorage.removeItem('appinfo')
            } catch (error) {
              console.debug('Failed to clear appinfo:', error)
            }
            setRedirectOpen(false)
          }}
          fullWidth
          maxWidth="sm"
          disableEnforceFocus
          disableScrollLock
        >
          <DialogTitle sx={{ fontWeight: 700 }}>
            Continue to {redirectApp?.name}?
          </DialogTitle>

          <DialogContent dividers>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1 }}>
              {/* Optional: show the app tile if you want */}
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: 2,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'action.hover',
                  flexShrink: 0,
                }}
              >
              {redirectDomain ? (
                <img
                  src={`https://${redirectDomain}/favicon.ico`}
                  alt={`${redirectApp?.name} icon`}
                  style={{ maxWidth: '100%', maxHeight: '100%' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : null}
            </Box>

            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  fontWeight: 700,
                  fontSize: '1.1rem',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {redirectApp?.name}
              </Typography>

              {redirectApp?.custom_message && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    mt: 0.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {redirectApp.custom_message}
                </Typography>
              )}

              {redirectDomain && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  {redirectDomain}
                </Typography>
              )}
            </Box>
          </Box>
          </DialogContent>

          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button
              onClick={() => {
                try {
                  sessionStorage.removeItem('appinfo')
                } catch (error) {
                  console.debug('Failed to clear appinfo:', error)
                }
                setRedirectOpen(false)
              }}
              color="inherit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRedirectContinue}
              variant="contained"
              endIcon={<OpenInNewIcon />}
            >
              Continue
            </Button>
          </DialogActions>
        </Dialog>
              )}
        {breakpoints.sm &&
          <div style={{ padding: '0.5em 0 0 0.5em' }} ref={menuRef}>
            <Toolbar>
              <IconButton
                edge='start'
                onClick={() => setMenuOpen(menuOpen => !menuOpen)}
                aria-label='menu'
                sx={{
                  color: 'primary.main',
                  '&:hover': {
                    backgroundColor: 'rgba(25, 118, 210, 0.1)',
                  }
                }}
              >
                <MenuIcon />
              </IconButton>
            </Toolbar>
          </div>}
      </div>
      <Menu menuOpen={menuOpen} setMenuOpen={setMenuOpen} menuRef={menuRef} />
      <Box sx={styles.page_container}>
        <Routes>
          <Route
            path='counterparty/self'
            element={<Navigate to={`/dashboard/counterparty/${myIdentityKey}`} replace />}
          />
          <Route
            path='counterparty/anyone'
            element={<Navigate to='/dashboard/counterparty/0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' replace />}
          />

          <Route path='settings' element={<Settings />} />
          <Route path='settings/advanced' element={<AdvancedSettings />} />
          <Route path='transfer' element={<Navigate to='/dashboard/payments' replace />} />
          <Route path='payments' element={<Transfer />} />
          <Route path='home' element={<Home />} />
          <Route path='' element={<Navigate to='/dashboard/home' replace />} />
          <Route path='identity' element={<MyIdentity />} />
          <Route path='trust' element={<Trust />} />
          <Route path='apps' element={<Apps />} />
          <Route path='app-catalog' element={<Apps />} />
          <Route path='recent-apps' element={<Apps />} />
          <Route path='app/*' element={<App />} />
          <Route path='manage-app/:originator' element={<AppAccess />} />
          <Route path='basket/:basketId' element={<BasketAccess />} />
          <Route path='protocol/:protocolId/:securityLevel' element={<ProtocolAccess />} />
          <Route path='counterparty/:counterparty' element={<CounterpartyAccess />} />
          <Route path='certificate/:certType' element={<CertificateAccess />} />

          <Route
            path='*'
            element={(
              <Navigate to='/dashboard/home' replace />
            )}
          />
        </Routes>
      </Box>
    </Box>
  );
}
