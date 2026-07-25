import {
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type FormEvent
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  TextField,
  Skeleton,
  CircularProgress,
  IconButton,
  Paper,
  Box,
  Container,
  useTheme,
} from '@mui/material'
import {
  ChevronLeft,
  ChevronRight,
  Close as CloseIcon,
} from '@mui/icons-material'
import AppLogo from '../../components/AppLogo'
import { toast } from 'react-toastify'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'
import PageLoading from '../../components/PageLoading'
import { Utils, PrivateKey } from '@bsv/sdk'
import { Mnemonic } from '@bsv/sdk/compat'
import { getAppCatalogApps } from '../../utils/appCatalogCache'
import type { PublishedApp } from '../../utils/appCatalogCache'
import UserWalletApp from '../../components/UserWalletApp'
import { PrivilegedKeyManager } from '@bsv/wallet-toolbox-client'
import {
  deriveKeyMaterialFromMnemonic,
  persistKeyMaterial,
  reconcileStoredKeyMaterial
} from '../../utils/keyMaterial'

const APPINFO_STORAGE_KEY = 'appinfo'

const watchSessionStorageKey = (key: string, onChange: () => void): () => void => {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const storage = window.sessionStorage
  const originalSetItem = storage.setItem.bind(storage)
  const originalRemoveItem = storage.removeItem.bind(storage)
  const originalClear = storage.clear.bind(storage)

  storage.setItem = ((k: string, value: string) => {
    originalSetItem(k, value)
    if (k === key) onChange()
  }) as typeof storage.setItem

  storage.removeItem = ((k: string) => {
    const existed = storage.getItem(k) !== null
    originalRemoveItem(k)
    if (k === key && existed) onChange()
  }) as typeof storage.removeItem

  storage.clear = (() => {
    const existed = storage.getItem(key) !== null
    originalClear()
    if (existed) onChange()
  }) as typeof storage.clear

  return () => {
    storage.setItem = originalSetItem
    storage.removeItem = originalRemoveItem
    storage.clear = originalClear
  }
}


// Main Greeter component with reduced complexity
const Greeter: React.FC = () => {
  const { managers, snapshotLoaded } = useContext(WalletContext)
  const { appName, pageLoaded } = useContext(UserContext)
  const theme = useTheme()
  const navigate = useNavigate()

  // Banner/new user state
  const [appInfo, setAppinfo] = useState<any | null>(null)
  const [recommendedApps, setRecommendedApps] = useState<PublishedApp[]>([])
  const [recommendedLoading, setRecommendedLoading] = useState<boolean>(false)

  // --- Slider refs/state (auto-rotate + controls) ---
  const railRef = useRef<HTMLDivElement | null>(null)
  const pausedRef = useRef(false)
  const setPausedBoth = useCallback((v: boolean) => { pausedRef.current = v }, [])
  const BELT_SPEED_PX_PER_SEC = 100; // belt speed
  const segWidthRef = useRef(0);
  const rAFRef = useRef<number | null>(null);
  const scrollByAmount = useCallback((dir: 'left' | 'right') => {
    const el = railRef.current
    if (!el) return
    const first = el.firstElementChild as HTMLElement | null
    const tile = first?.offsetWidth ?? 110
    const gap = 16
    const step = tile + gap
    el.scrollBy({ left: dir === 'left' ? -step : step, behavior: 'smooth' })
  }, [])
  const beltItems = useMemo(() => {
    if (!recommendedApps?.length) return [];
    return [...recommendedApps, ...recommendedApps];
  }, [recommendedApps]);
  
  useEffect(() => {
    if (appInfo) {
      return undefined; // only run on explore view
    }

    const el = railRef.current;
    if (!el) {
      return undefined;
    }

  // measure one segment (the width of the first half = original list)
  const measure = () => {
    const children = Array.from(el.children) as HTMLElement[];
    const half = Math.floor(children.length / 2);
    if (!half) return;
    const first = children[0];
    const last = children[half - 1];
    segWidthRef.current = (last.offsetLeft + last.offsetWidth) - first.offsetLeft;
  };

  // measure once the DOM is ready
  const id = requestAnimationFrame(measure);

  let last = performance.now();
  const step = (ts: number) => {
    if (!railRef.current) return;
    const dt = Math.min(0.05, (ts - last) / 1000); // clamp dt for stability
    last = ts;

    if (!pausedRef.current && segWidthRef.current > 0) {
      el.scrollLeft += BELT_SPEED_PX_PER_SEC * dt;

      // wrap seamlessly when we pass one segment
      const seg = segWidthRef.current;
      if (el.scrollLeft >= seg) {
        // jump back by exactly one segment with no animation
        const prev = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto';
        el.scrollLeft -= seg;
        el.style.scrollBehavior = prev || '';
      }
    }
    rAFRef.current = requestAnimationFrame(step);
  };

  rAFRef.current = requestAnimationFrame(step);

  // keep wrapping when user drags/scrolls manually too
  const onScroll = () => {
    const seg = segWidthRef.current;
    if (!seg) return;
    if (el.scrollLeft >= seg) {
      const prev = el.style.scrollBehavior;
      el.style.scrollBehavior = 'auto';
      el.scrollLeft -= seg;
      el.style.scrollBehavior = prev || '';
    } else if (el.scrollLeft < 0) {
      const prev = el.style.scrollBehavior;
      el.style.scrollBehavior = 'auto';
      el.scrollLeft += seg;
      el.style.scrollBehavior = prev || '';
    }
  };
  el.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(id);
      if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
      rAFRef.current = null;
      el.removeEventListener('scroll', onScroll);
    };
  }, [appInfo, beltItems.length]);

  // Check sessionStorage for 'appinfo' once on mount
  const loadRecommendedApps = useCallback(async () => {
    try {
      setRecommendedLoading(true)
      const apps = await getAppCatalogApps()
      setRecommendedApps(apps) // let the slider overflow naturally
    } catch (err) {
      // ignore errors quietly for greeter suggestions
    } finally {
      setRecommendedLoading(false)
    }
  }, [])

  useEffect(() => {
    const syncAppInfo = () => {
      try {
        const appinfo = sessionStorage.getItem('appinfo')
        if (appinfo) {
          setAppinfo(JSON.parse(appinfo))
        } else {
          setAppinfo(null)
          loadRecommendedApps()
        }
      } catch (err) {
        setAppinfo(null)
        loadRecommendedApps()
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea === sessionStorage && event.key === 'appinfo') {
        syncAppInfo()
      }
    }

    const handleVisibility = () => {
      if (!document.hidden) {
        syncAppInfo()
      }
    }

    const cleanupStoragePatch = watchSessionStorageKey(APPINFO_STORAGE_KEY, syncAppInfo)

    syncAppInfo()
    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', syncAppInfo)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', syncAppInfo)
      document.removeEventListener('visibilitychange', handleVisibility)
      cleanupStoragePatch()
    }
  }, [loadRecommendedApps])

  // Derive selected app display info (domain, icon) for header
  const selectedApp = useMemo(() => {
    const src = (appInfo as any)?.Originator || (appInfo as any)?.redirected_from
    let domain = ''
    if (typeof src === 'string') {
      try { domain = new URL(src).host } catch { domain = '' }
    }
    const name = (appInfo as any)?.name || domain
    const icon = typeof src === 'string' ? src.replace(/\/$/, '') + '/favicon.ico' : undefined
    return { domain: domain || name || '', name, icon }
  }, [appInfo])

  const [mode, setMode] = useState<'private' | 'mnemonic'>('mnemonic')
  const [privateKey, setPrivateKey] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [loading, setLoading] = useState(false)
  const keyFieldRef = useRef<HTMLInputElement | null>(null)
  const [persistedKeyLoaded, setPersistedKeyLoaded] = useState(false)
  const createDisabledPrivilegedManager = useCallback(
    () =>
      new PrivilegedKeyManager(async () => {
        throw new Error('Privileged operations are not supported with this wallet.')
      }),
    []
  )

  const walletManager = managers?.walletManager

  useEffect(() => {
    if (pageLoaded && keyFieldRef.current) {
      keyFieldRef.current.focus()
    }
  }, [pageLoaded])

  useEffect(() => {
    if (persistedKeyLoaded) return
    const { keyHex, mnemonic: storedMnemonic } = reconcileStoredKeyMaterial()

    if (storedMnemonic) {
      setMnemonic(storedMnemonic)
      setPrivateKey(keyHex)
      setMode('mnemonic')
    } else if (keyHex) {
      setPrivateKey(keyHex)
      setMnemonic('')
      setMode('private')
    }

    setPersistedKeyLoaded(true)
  }, [persistedKeyLoaded])

  const handleGenerateKey = useCallback(() => {
    try {
      const generated = PrivateKey.fromRandom().toHex()
      const phrase = persistKeyMaterial(generated)
      setPrivateKey(generated)
      setMnemonic(phrase)
      setMode('private')
      toast.success('Generated a new private key and saved it locally.')
      if (keyFieldRef.current) {
        keyFieldRef.current.focus()
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || 'Failed to generate key')
    }
  }, [])

  const handleGenerateMnemonic = useCallback(() => {
    try {
      const generated = Mnemonic.fromRandom(128).toString()
      const derived = deriveKeyMaterialFromMnemonic(generated)
      setMnemonic(derived.mnemonic)
      setPrivateKey(derived.keyHex)
      persistKeyMaterial(derived.keyHex, derived.mnemonic)
      setMode('mnemonic')
      toast.success('Generated a new 12-word phrase and saved it locally.')
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || 'Failed to generate phrase')
    }
  }, [])

  const handleSubmit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!walletManager) {
      toast.error('Wallet Manager not ready yet.')
      return
    }

    try {
      setLoading(true)
      let keyBytes: number[] = []
      let keyHex = ''
      let normalizedMnemonic = ''
      if (mode === 'mnemonic') {
        const phrase = mnemonic.trim()
        if (!phrase) {
          throw new Error('Enter your 12-word phrase.')
        }
        const derived = deriveKeyMaterialFromMnemonic(phrase)
        keyBytes = derived.keyBytes
        keyHex = derived.keyHex
        normalizedMnemonic = derived.mnemonic
      } else {
        const trimmed = privateKey.trim()
        keyBytes = Utils.toArray(trimmed, 'hex')
        if (keyBytes.length !== 32) {
          throw new Error('Private key must be 32 bytes (64 hex characters).')
        }
        keyHex = trimmed
        normalizedMnemonic = ''
      }

      const privilegedManager = createDisabledPrivilegedManager()
      await walletManager.providePrimaryKey(keyBytes)
      await walletManager.providePrivilegedKeyManager(privilegedManager)

      if (!walletManager.authenticated) {
        throw new Error('Failed to unlock wallet with that key.')
      }

      localStorage.setItem('snap', Utils.toBase64(walletManager.saveSnapshot()))
      const persistedMnemonic = persistKeyMaterial(keyHex, normalizedMnemonic || undefined)
      if (persistedMnemonic) {
        normalizedMnemonic = persistedMnemonic
      }
      setMnemonic(normalizedMnemonic)
      setPrivateKey(keyHex)
      toast.success('Wallet unlocked')
      navigate('/dashboard/home')
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || 'Failed to unlock wallet')
    } finally {
      setLoading(false)
    }
  }, [walletManager, navigate, privateKey, mode, mnemonic, createDisabledPrivilegedManager])

  useEffect(() => {
    if (managers?.walletManager?.authenticated) {
      navigate('/dashboard/home', { replace: true })
    }
  }, [managers?.walletManager?.authenticated, navigate])

  const awaitingAutoLogin = typeof window !== 'undefined' && !!localStorage.getItem('snap') && !snapshotLoaded

  if (!pageLoaded || !persistedKeyLoaded || awaitingAutoLogin) {
    return <PageLoading />
  }

  // Common tile size based on the 15vh banner height (prevents vertical overflow)
  const tileSize = 'min(1000px, calc(15vh - 16px))'

  return (
    <>
      {/* === APP BAR with auto-rotating movie slider (no overlap with right side) === */}
      <AppBar position="fixed" color="primary" elevation={0} sx={{ height: '15vh', m: 0, borderRadius: '0 0 20px 20px' }}>
        <Toolbar disableGutters sx={{ height: '15vh', px: 2, overflow: 'hidden', '--banner-h': '15vh', }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '10fr auto', // main content | right button
              alignItems: 'center',
              columnGap: 5,
              width: '100%',
              height: '100%',
              minWidth: 0
            }}
          >
            {/* MAIN CONTENT */}
            {appInfo ? (
              // appInfo exists: single tile + title/message (LEFT-ALIGNED, VERT-CENTERED)
              <Box
                sx={{
                  display: 'grid',
                  gridAutoFlow: 'column',
                  gridAutoColumns: 'auto 1fr',
                  alignItems: 'center',
                  columnGap: 2,
                  minWidth: 0,
                  height: '100%',
                }}
              >
                {/* Tile to match explore vibe */}
                <Box
                  sx={{
                    width: tileSize,
                    height: tileSize,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 2,
                    overflow: 'hidden',
                    '& img, & svg': { display: 'block', maxHeight: '100%', width: 'auto', objectFit: 'contain' }
                  }}
                >
                  <UserWalletApp
                    appName={''}
                    domain={''}
                    iconImageUrl={selectedApp.icon || (selectedApp.domain ? `https://${selectedApp.domain}/favicon.ico` : undefined)}
                    clickable={false}
                  />
                </Box>

                {/* Title + message */}
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                  variant="h4"
                  sx={{
                    color: 'inherit',
                    fontWeight: 700,
                    // min 1.1rem, fluid center = 18% of banner height, max 1.9rem
                    fontSize: 'clamp(1.1rem, calc(var(--banner-h) * 0.18), 1.9rem)',
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'left',
                  }}
                  >
                  {appInfo?.name}
                  </Typography>

                  {(appInfo?.message || (appInfo as any)?.custom_message) && (
                    <Typography
                      variant="body1"
                      sx={{
                        color: 'inherit',
                        opacity: 0.9,
                        // min 0.9rem, fluid center = 12% of banner height, max 1.2rem
                        fontSize: 'clamp(0.9rem, calc(var(--banner-h) * 0.12), 1.2rem)',
                        lineHeight: 1.35,
                        display: '-webkit-box',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 3, // show up to 3 lines in the 15vh banner
                        overflow: 'hidden',
                        textAlign: 'left',
                      }}
                    >
                      {appInfo?.message || (appInfo as any)?.custom_message}
                    </Typography>
                  )}
                </Box>
              </Box>
            ) : (
              // no appInfo: MOVIE SLIDER (scroll-snap, auto-rotate, touch/trackpad friendly)
              <Box
              sx={{
                height: '100%',
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0,1fr) auto', // [left btn] [rail] [right btn]
                alignItems: 'center',
                columnGap: 1,
                minWidth: 0,
                zIndex: 0,
              }}
              onMouseEnter={() => setPausedBoth?.(true)}
              onMouseLeave={() => setPausedBoth?.(false)}
              onTouchStart={() => setPausedBoth?.(true)}
              onTouchEnd={() => setTimeout(() => setPausedBoth?.(false), 800)}
              onFocusCapture={() => setPausedBoth?.(true)}
              onBlurCapture={() => setPausedBoth?.(false)}
            >
              {/* LEFT chevron (outside the rail) */}
              <IconButton
                size="small"
                onClick={() => scrollByAmount('left')}
                sx={{
                  justifySelf: 'start',
                  ml: -0.5,                       // optional outward nudge; remove if you want flush
                  background: 'rgba(0,0,0,0.15)',
                }}
              >
                <ChevronLeft />
              </IconButton>

              {/* Scrollable rail */}
              <Box
                  ref={railRef}
                  sx={{
                    width: '100%',
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                    display: 'grid',
                    gridAutoFlow: 'column',
                    gridAutoColumns: tileSize,
                    columnGap: 10,          // 16px
                    alignItems: 'center',
                    px: 4,
                    height: '100%',
                    // IMPORTANT: no scrollSnapType for continuous belt
                  }}
                >
                  {recommendedLoading
                    ? Array.from({ length: Math.max(10, beltItems.length) }).map((_, i) => (
                        <Skeleton
                          key={`s-${i}`}
                          variant="rounded"
                          sx={{
                            width: tileSize,
                            height: tileSize,
                            bgcolor: 'rgba(255,255,255,0.15)',
                            borderRadius: 2,
                          }}
                        />
                      ))
                    : beltItems.map((ra, idx) => (
                        <Box key={`${ra.token?.txid ?? ra.metadata?.name}-${idx}`}>
                          <UserWalletApp
                            appName={ra.metadata.name}
                            domain={ra.metadata.domain || ra.metadata.name}
                            iconImageUrl={ra.metadata.icon || (ra.metadata.domain ? `https://${ra.metadata.domain}/favicon.ico` : undefined)}
                            clickable
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const name = ra.metadata.name;
                              const domain = ra.metadata.domain;
                              const origin = domain ? `https://${domain}` : undefined;
                              const sim = {
                                name,
                                ...(origin ? { Originator: origin } : {}),
                                custom_message: `${ra.metadata.description}`
                              } as any;
                              try {
                                sessionStorage.removeItem('appinfo_handled')
                                sessionStorage.setItem('appinfo', JSON.stringify(sim))
                              } catch (error) {
                                console.debug('Failed to queue app info:', error)
                              }
                              setAppinfo(sim);
                            }}
                          />
                        </Box>
                      ))}
                </Box>
              {/* RIGHT chevron (outside the rail) */}
              <IconButton
                size="small"
                onClick={() => scrollByAmount('right')}
                sx={{
                  justifySelf: 'end',
                  mr: -0.5,                       // symmetric outward nudge
                  background: 'rgba(0,0,0,0.15)',
                }}
              >
                <ChevronRight />
              </IconButton>
            </Box>
            )}

            {/* RIGHT COLUMN: Clear (X) button when an app is selected */}
            {appInfo ? (
              <Box sx={{ justifySelf: 'end' }}>
                <IconButton
                  aria-label="Clear selected app"
                  color="inherit"
                  size="small"
                  onClick={() => {
                    try {
                      sessionStorage.removeItem('appinfo')
                    } catch (error) {
                      console.debug('Failed to clear selected app:', error)
                    }
                    setAppinfo(null)
                    setPausedBoth(false)
                    loadRecommendedApps()
                  }}
                >
                  <CloseIcon />
                </IconButton>
              </Box>
            ) : (
              <Box />
            )}

          </Box>
        </Toolbar>
      </AppBar>
      {/* === END APP BAR === */}

      <Container maxWidth="sm" sx={{ minHeight: 'calc(100vh - 15vh)', mt: '15vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Paper elevation={4} sx={{ p: 4, borderRadius: 2, bgcolor: 'background.paper', boxShadow: theme.shadows[3] }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
            <Box sx={{ mb: 2, width: '100px', height: '100px' }}>
              <AppLogo rotate size="100px" color="#FF0000" />
            </Box>
            <Typography
              variant='h6'
              fontWeight={700}
              textAlign='center'
              sx={{
                mb: 0.5,
                letterSpacing: 0.5,
                textTransform: 'uppercase'
              }}
            >
              {appInfo?.name ? `Continue to ${appInfo.name}` : `${appName}`}
            </Typography>
          </Box>

          <Box
            component='form'
            onSubmit={handleSubmit}
            sx={{ display: 'grid', gap: 2 }}
          >
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
              <Button
                variant={mode === 'mnemonic' ? 'contained' : 'outlined'}
                onClick={() => setMode('mnemonic')}
                disabled={loading}
                sx={{ textTransform: 'none', flex: 1 }}
              >
                12-word phrase
              </Button>
              <Button
                variant={mode === 'private' ? 'contained' : 'outlined'}
                onClick={() => setMode('private')}
                disabled={loading}
                sx={{ textTransform: 'none', flex: 1 }}
              >
                Hex key
              </Button>
            </Box>

            {mode === 'mnemonic' ? (
              <>
                <Button
                  variant='outlined'
                  onClick={handleGenerateMnemonic}
                  disabled={loading}
                  sx={{ textTransform: 'none' }}
                >
                  New 12-word phrase
                </Button>
                <TextField
                  placeholder="Enter words separated by spaces"
                  value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)}
                  fullWidth
                  multiline
                  minRows={2}
                />
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {mnemonic.trim().split(/\s+/).filter(Boolean).map((word, idx) => (
                    <Box
                      key={`${word}-${idx}`}
                      sx={{
                        px: 1.2,
                        py: 0.6,
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                        fontSize: '0.85rem',
                        letterSpacing: 0.2
                      }}
                    >
                      {idx + 1}. {word}
                    </Box>
                  ))}
                </Box>
              </>
            ) : (
              <>
                <Button
                  variant='outlined'
                  onClick={handleGenerateKey}
                  disabled={loading}
                  sx={{ textTransform: 'none' }}
                >
                  New key
                </Button>
                <TextField
                  placeholder="64-char private key"
                  value={privateKey}
                  inputRef={keyFieldRef}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  fullWidth
                  autoComplete='off'
                />
              </>
            )}
            <Button
              variant='contained'
              type='submit'
              disabled={loading || (mode === 'private' ? !privateKey.trim() : !mnemonic.trim())}
              fullWidth
              sx={{ textTransform: 'none', py: 1.2 }}
            >
              {loading ? <CircularProgress size={24} /> : 'Enter'}
            </Button>
          </Box>

          <Typography
            variant='caption'
            color='textSecondary'
            align='center'
            sx={{ display: 'block', mt: 2, mb: 1, fontSize: '0.75rem', opacity: 0.7 }}
            >
              Key stays on this device. Keep it safe! We don't store it.
            </Typography>
        </Paper>
      </Container>
    </>
  )
}

export default Greeter
