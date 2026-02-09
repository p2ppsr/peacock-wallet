import { useCallback, useContext, useEffect, useState } from 'react'
import {
  Typography,
  List,
  ListSubheader,
  Box,
  Alert,
} from '@mui/material'
import BasketChip from './BasketChip'
import CertificateAccessList from './CertificateAccessList'
import ProtocolPermissionList from './ProtocolPermissionList'
import { WalletContext } from '../WalletContext'
import AppLogo from './AppLogo'
 

/* ------------------------------------------------------------------ */
/*  Type helpers                                                      */
/* ------------------------------------------------------------------ */

interface ActionOutput {
  basket?: string
}

interface Action {
  outputs?: ActionOutput[]
}

interface AccessAtAGlanceProps {
  originator: string
}

/* ------------------------------------------------------------------ */
/*  Caching utilities                                                 */
/* ------------------------------------------------------------------ */

interface BasketAccessCache {
  data: string[]
  timestamp: number
  originator: string
}

const CACHE_KEY_PREFIX = 'basket_access_cache_'
const CACHE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes

const getCacheKey = (originator: string) => `${CACHE_KEY_PREFIX}${originator}`

const getCachedBasketAccess = (originator: string): string[] | null => {
  try {
    const cached = localStorage.getItem(getCacheKey(originator))
    if (!cached) return null

    const parsedCache: BasketAccessCache = JSON.parse(cached)
    const now = Date.now()
    
    // Check if cache is expired
    if (now - parsedCache.timestamp > CACHE_EXPIRY_MS) {
      localStorage.removeItem(getCacheKey(originator))
      return null
    }

    // Verify originator matches (extra safety)
    if (parsedCache.originator !== originator) {
      localStorage.removeItem(getCacheKey(originator))
      return null
    }

    return parsedCache.data
  } catch (error) {
    console.warn('Error reading basket access cache:', error)
    return null
  }
}

const setCachedBasketAccess = (originator: string, data: string[]) => {
  try {
    const cacheData: BasketAccessCache = {
      data,
      timestamp: Date.now(),
      originator
    }
    localStorage.setItem(getCacheKey(originator), JSON.stringify(cacheData))
  } catch (error) {
    console.warn('Error saving basket access cache:', error)
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

const AccessAtAGlance = ({ originator }: AccessAtAGlanceProps) => {
  /* ------------- Context / state ---------------------------------- */
  const { managers, adminOriginator } = useContext(WalletContext)
  const permissionsManager = managers.permissionsManager

  if (!permissionsManager) {
    return (
      <Alert severity="warning">
        Permissions manager is not available. Please try again after initialization completes.
      </Alert>
    )
  }

  const [recentBasketAccess, setRecentBasketAccess] = useState<string[]>([])
  const [protocolIsEmpty, setProtocolIsEmpty] = useState(false)
  const [certificateIsEmpty, setCertificateIsEmpty] = useState(false)
  const [isLoadingBaskets, setIsLoadingBaskets] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  /* ------------- Helpers ------------------------------------------ */

  /** Process actions in small chunks to keep the main thread responsive */
  const processActionsInChunks = useCallback(
    async (actions: Action[], signal: AbortSignal): Promise<string[]> => {
      const baskets = new Set<string>()
      const chunkSize = 5

      for (let i = 0; i < actions.length && !signal.aborted; i += chunkSize) {
        const chunk = actions.slice(i, i + chunkSize)

        chunk.forEach(action => {
          action.outputs?.forEach(output => {
            if (output.basket && output.basket !== 'default')
              baskets.add(output.basket)
          })
        })

        // Yield back to the event loop after each chunk
        if (i + chunkSize < actions.length)
          await new Promise(r => setTimeout(r, 0))
      }

      return Array.from(baskets)
    },
    [],
  )

  /* ------------- Effect: load cached data immediately ------------- */
  useEffect(() => {
    if (!originator) return undefined

    // Load cached data immediately for instant feedback
    const cachedData = getCachedBasketAccess(originator)
    if (cachedData) {
      setRecentBasketAccess(cachedData)
    }
  }, [originator])

  /* ------------- Effect: load fresh basket access ----------------- */
  useEffect(() => {
    if (!originator) return undefined

    const controller = new AbortController()

    // Use setTimeout to yield control back to main thread immediately
    setTimeout(async () => {
      if (controller.signal.aborted) return
      
      setIsLoadingBaskets(true)
      setLoadError(null)

      try {
        const { actions } = await permissionsManager.listActions(
          {
            labels: [`admin originator ${originator}`],
            labelQueryMode: 'any',
            includeOutputs: true,
          },
          adminOriginator
        )

        const filteredResults = await processActionsInChunks(
          actions,
          controller.signal
        )
        
        if (!controller.signal.aborted) {
          setRecentBasketAccess(filteredResults)
          setLoadError(null)
          // Cache the fresh data
          setCachedBasketAccess(originator, filteredResults)
        }
      } catch (err: unknown) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Error loading basket access:', err)
          const message =
            err instanceof Error
              ? err.message
              : 'Unable to load recent basket activity.'
          setLoadError(message)
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingBaskets(false)
      }
    }, 0)

    return () => controller.abort()
  }, [originator, adminOriginator, permissionsManager, processActionsInChunks])

  /* ------------- Render ------------------------------------------- */

  return (
    <div style={{ paddingTop: '1em' }}>
      <Typography
        variant="h3"
        color="textPrimary"
        gutterBottom
        style={{ paddingBottom: '0.2em' }}
      >
        Access At A Glance
      </Typography>

      {loadError && (
        <Box pb={2}>
          <Alert severity="warning">{loadError}</Alert>
        </Box>
      )}

      {/* ---------------------- Basket + Protocol list ---------------- */}
      <List
        sx={{
          bgcolor: 'background.paper',
          borderRadius: '0.25em',
          p: '1em',
          minHeight: '13em',
          position: 'relative',
        }}
      >
        {!isLoadingBaskets && recentBasketAccess.length !== 0 && (
          <>
            <ListSubheader>Most Recent Basket</ListSubheader>
            {recentBasketAccess.map(basket => (
              <BasketChip key={basket} basketId={basket} clickable />
            ))}
          </>
        )}

        <ProtocolPermissionList
          app={originator}
          limit={1}
          canRevoke={false}
          clickable
          displayCount={false}
          listHeaderTitle="Most Recent Protocol"
          onEmptyList={() => setProtocolIsEmpty(true)}
        />
      </List>

      {/* ---------------------- Certificate list ---------------------- */}
      <Box
        sx={{
          bgcolor: 'background.paper',
          borderRadius: '0.25em',
          minHeight: '13em',
        }}
      >
        <CertificateAccessList
          app={originator}
          itemsDisplayed="certificates"
          counterparty=""
          limit={1}
          type="certificate"
          canRevoke={false}
          displayCount={false}
          listHeaderTitle="Most Recent Certificate"
          onEmptyList={() => setCertificateIsEmpty(true)}
        />


        {isLoadingBaskets && <Box p={3} display="flex" justifyContent="center" alignItems="center"><AppLogo rotate size={50} /></Box>}

        {recentBasketAccess.length === 0 &&
          certificateIsEmpty &&
          protocolIsEmpty && (
            <Typography
              color="textSecondary"
              align="center"
              sx={{ pt: '5em' }}
            >
              No recent access
            </Typography>
          )}
      </Box>

    </div>
  )
}

export default AccessAtAGlance
