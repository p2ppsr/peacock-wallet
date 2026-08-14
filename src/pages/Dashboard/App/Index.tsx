/* ------------------------------------------------------------------
 * Apps.tsx — clean, performant version
 * ------------------------------------------------------------------ */

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Grid,
  Typography,
  IconButton,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { useLocation, useNavigate } from 'react-router-dom'

import { WalletContext } from '../../../WalletContext'
import { WalletAction } from '@bsv/sdk'
import { DEFAULT_APP_ICON } from '../../../constants/popularApps'
import PageHeader from '../../../components/PageHeader'
import RecentActions from '../../../components/RecentActions'
import AccessAtAGlance from '../../../components/AccessAtAGlance'
import fetchAndCacheAppData from '../../../utils/fetchAndCacheAppData'
import { openUrl } from '../../../utils/openUrl'

/* ------------------------------------------------------------------
 *  Constants & helpers
 * ------------------------------------------------------------------ */

const LIMIT = 10
const CACHE_VERSION = 2
const CACHE_CAPACITY = 25 // max # of apps kept in RAM

/** Simple LRU cache for per-app pages */
class LruCache<K, V> {
  private map = new Map<K, V>()

  constructor(private capacity = 50) { }

  get(key: K): V | undefined {
    const item = this.map.get(key)
    if (!item) return undefined
    // bump to most-recent
    this.map.delete(key)
    this.map.set(key, item)
    return item
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.capacity) {
      // delete least-recent
      const first = this.map.keys().next().value
      this.map.delete(first)
    }
  }
}
const APP_PAGE_CACHE = new LruCache<
  string,
  { actions: TransformedWalletAction[]; totalActions: number; version: number }
>(CACHE_CAPACITY)

const getCachedAppPage = (domain: string) => {
  const entry = APP_PAGE_CACHE.get(domain)
  if (!entry || entry.version !== CACHE_VERSION) return undefined
  return entry
}

/** Transform raw actions for UI */
interface TransformedWalletAction extends WalletAction {
  amount: number
  fees?: number
}
const transformActions = (actions: WalletAction[]): TransformedWalletAction[] =>
  actions.map(a => {
    const inputSum = (a.inputs ?? []).reduce(
      (s, i) => s + Number(i.sourceSatoshis),
      0,
    )
    const outputSum = (a.outputs ?? []).reduce(
      (s, o) => s + Number(o.satoshis),
      0,
    )

    return {
      ...a,
      amount: a.satoshis,
      fees: inputSum - outputSum || undefined,
    }
  })

/* ------------------------------------------------------------------
 *  Router state
 * ------------------------------------------------------------------ */
interface LocationState {
  domain?: string
  appName?: string
  iconImageUrl?: string
}

/* ------------------------------------------------------------------
 *  Component
 * ------------------------------------------------------------------ */
const App: React.FC = () => {
  /* ---------- Router & persisted params -------------------------- */
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LocationState | null
  const initialDomain =
    state?.domain || sessionStorage.getItem('lastAppDomain') || 'unknown.com'
  const initialName =
    state?.appName || sessionStorage.getItem('lastAppName') || initialDomain
  const initialIcon =
    state?.iconImageUrl ||
    sessionStorage.getItem('lastAppIcon') ||
    DEFAULT_APP_ICON

  /* ---------- Context ------------------------------------------- */
  const { managers, adminOriginator } = useContext(WalletContext)
  const permissionsManager = managers?.permissionsManager

  /* ---------- Local state --------------------------------------- */
  const initialCacheEntry = useMemo(() => {
    const entry = APP_PAGE_CACHE.get(initialDomain)
    return entry?.version === CACHE_VERSION ? entry : null
  }, [initialDomain])

  const [appDomain, setAppDomain] = useState(initialDomain)
  const [appName, setAppName] = useState(initialName)
  const [appIcon, setAppIcon] = useState(initialIcon)

  const [appActions, setAppActions] = useState<TransformedWalletAction[]>(
    () => initialCacheEntry?.actions ?? [],
  )
  const [page, setPage] = useState(0)
  const [isFetching, setIsFetching] = useState(false)
  const [allActionsShown, setAllActionsShown] = useState(
    () =>
      initialCacheEntry != null &&
      initialCacheEntry.actions.length >= initialCacheEntry.totalActions,
  )
  const [copied, setCopied] = useState(false)

  /* ---------- Refs to avoid stale closures ---------------------- */
  const abortRef = useRef<AbortController | null>(null)
  const totalActionsRef = useRef<number | null>(
    initialCacheEntry?.totalActions ?? null,
  )

  /* ---------- Derived values ------------------------------------ */
  const url = useMemo(
    () => (appDomain.startsWith('http') ? appDomain : `https://${appDomain}`),
    [appDomain],
  )

  const manageAppPath = useMemo(
    () => `/dashboard/manage-app/${encodeURIComponent(appDomain)}`,
    [appDomain],
  )

  const cacheKey = useMemo(() => `transactions_${appDomain}`, [appDomain])

  /* ---------- Cache hydration (localStorage) -------------------- */
  useEffect(() => {
    const cached = localStorage.getItem(cacheKey)
    if (!cached) return

    try {
      const parsed = JSON.parse(cached) as {
        version?: number
        totalTransactions: number
        transactions: TransformedWalletAction[]
      }

      if (parsed.version !== CACHE_VERSION) {
        localStorage.removeItem(cacheKey)
        return
      }

      totalActionsRef.current = parsed.totalTransactions
      setAppActions(parsed.transactions ?? [])
      setAllActionsShown(
        (parsed.transactions?.length ?? 0) >= parsed.totalTransactions,
      )
    } catch (err) {
      console.error('Local cache parse error', err)
    }
  }, [cacheKey])

  /* ---------- Persist router state ------------------------------ */
  useEffect(() => {
    sessionStorage.setItem('lastAppDomain', appDomain)
    sessionStorage.setItem('lastAppName', appName)
    sessionStorage.setItem('lastAppIcon', appIcon)
  }, [appDomain, appName, appIcon])

  /* ---------- Clipboard helper ---------------------------------- */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } finally {
      setTimeout(() => setCopied(false), 2_000)
    }
  }

  /* ---------- Core: fetch a page of actions --------------------- */
  const fetchPage = useCallback(
    async (pageToLoad = 0) => {
      if (!permissionsManager || !adminOriginator) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setIsFetching(true)

      try {
        const computeOffsetFromTotal = (total: number) =>
          Math.max(total - (pageToLoad + 1) * LIMIT, 0)

        const buildArgs = (offset: number) => ({
          labels: [`admin originator ${appDomain}`],
          labelQueryMode: 'any' as const,
          includeLabels: true as const,
          includeInputs: true as const,
          includeOutputs: true as const,
          limit: LIMIT,
          offset,
        })

        const knownTotal = totalActionsRef.current
        let offset =
          knownTotal != null ? computeOffsetFromTotal(knownTotal) : pageToLoad * LIMIT

        let result = await permissionsManager.listActions(
          buildArgs(offset),
          adminOriginator,
        )
        if (controller.signal.aborted) return

        totalActionsRef.current = result.totalActions
        let effectiveOffset = computeOffsetFromTotal(result.totalActions)

        if (effectiveOffset !== offset) {
          offset = effectiveOffset
          result = await permissionsManager.listActions(
            buildArgs(offset),
            adminOriginator,
          )
          if (controller.signal.aborted) return
          totalActionsRef.current = result.totalActions
          effectiveOffset = computeOffsetFromTotal(result.totalActions)
        }

        const { actions, totalActions: total } = result
        const transformedDescending = transformActions(actions).reverse()

        setAllActionsShown(effectiveOffset === 0)
        setAppActions(prev => {
          if (pageToLoad === 0) return transformedDescending
          const existingTxids = new Set(
            prev
              .map(action => action.txid)
              .filter((txid): txid is string => Boolean(txid)),
          )
          const deduped = transformedDescending.filter(action => {
            if (!action.txid) return true
            return !existingTxids.has(action.txid)
          })
          return [...prev, ...deduped]
        })

        /* Cache only first page (newest actions) in localStorage */
        if (pageToLoad === 0) {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              version: CACHE_VERSION,
              totalTransactions: total,
              transactions: transformedDescending,
            }),
          )
        }

        /* In-memory cache */
        const existingCache = getCachedAppPage(appDomain)
        const existingTxidsForCache = new Set(
          (existingCache?.actions ?? [])
            .map(action => action.txid)
            .filter((txid): txid is string => Boolean(txid)),
        )
        const cachedActions =
          pageToLoad === 0
            ? transformedDescending
            : [
                ...(existingCache?.actions ?? []),
                ...transformedDescending.filter(action => {
                  if (!action.txid) return true
                  return !existingTxidsForCache.has(action.txid)
                }),
              ]
        APP_PAGE_CACHE.set(appDomain, {
          actions: cachedActions,
          totalActions: total,
          version: CACHE_VERSION,
        })
      } catch (err) {
        if ((err as Error).name !== 'AbortError')
          console.error('listActions error', err)
      } finally {
        setIsFetching(false)
      }
    },
    [appDomain, adminOriginator, cacheKey, permissionsManager],
  )

  /* ---------- Initial load & page changes ----------------------- */
  useEffect(() => {
    /* If we already have cached data for this page, skip fetch */
    const cachedActionsLength =
      getCachedAppPage(appDomain)?.actions.length ?? 0
    const cachedPageCount = Math.ceil(cachedActionsLength / LIMIT) - 1
    if (page > cachedPageCount) fetchPage(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, appDomain]) // fetchPage excluded on purpose

  /* ---------- Handle domain change via router ------------------- */
  useEffect(() => {
    if (state?.domain && state.domain !== appDomain) {
      const nextDomain = state.domain
      setAppDomain(nextDomain)
      setAppName(state.appName || nextDomain)
      setAppIcon(state.iconImageUrl || DEFAULT_APP_ICON)
      setPage(0)
      const cached = getCachedAppPage(nextDomain)
      totalActionsRef.current = cached?.totalActions ?? null
      setAppActions(cached?.actions ?? [])
      setAllActionsShown(
        cached != null && cached.actions.length >= cached.totalActions,
      )
    }
  }, [state, appDomain])

  /* ---------- Load lightweight app metadata --------------------- */
  useEffect(() => {
    if (!state?.appName || !state?.iconImageUrl) {
      fetchAndCacheAppData(appDomain, setAppIcon, setAppName, DEFAULT_APP_ICON)
    }
  }, [appDomain, state])

  /* ---------- Cleanup pending requests on unmount --------------- */
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  /* ---------- UI props ------------------------------------------ */
  const recentActionProps = {
    loading: isFetching,
    appActions,
    displayLimit: LIMIT,
    setDisplayLimit: () => { },
    setRefresh: () => {
      if (isFetching || allActionsShown) return;
      const next = page + 1;
      setPage(next);
      fetchPage(next);
    },
    onRefresh: () => {
      if (isFetching) return
      setPage(0)
      void fetchPage(0)
    },
    allActionsShown,
  }

  /* ---------- Render -------------------------------------------- */
  return (
    <Grid container direction="column" spacing={3} sx={{ maxWidth: '100%' }}>
      {/* Header */}
      <Grid item xs={12}>
      <PageHeader
        title={appName}
          subheading={
            <Typography variant="caption" color="textSecondary">
              {url}
              <IconButton size="small" onClick={handleCopy} disabled={copied}>
                {copied ? (
                  <CheckIcon fontSize="small" />
                ) : (
                  <ContentCopyIcon fontSize="small" />
                )}
              </IconButton>
            </Typography>
          }
          icon={appIcon}
          buttonTitle="Launch"
          buttonIcon={<OpenInNewIcon />}
          onClick={() => void openUrl(url)}
          showSecondaryButton
          secondaryButtonTitle="Manage App"
          secondaryButtonVariant="text"
          secondaryButtonSize="medium"
          onSecondaryClick={() => navigate(manageAppPath)}
        />
      </Grid>

      {/* Body */}
      <Grid item xs={12}>
        <Grid container spacing={3}>
          {/* Recent actions */}
          <Grid item lg={6} md={6} xs={12}>
            <RecentActions {...recentActionProps} />
          </Grid>

          {/* Access at a Glance */}
          <Grid item lg={6} md={6} xs={12}>
          <AccessAtAGlance
            originator={appDomain}
          />
          </Grid>
        </Grid>
      </Grid>
    </Grid>
  )
}

export default App
