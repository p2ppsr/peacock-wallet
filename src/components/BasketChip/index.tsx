import { useContext, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Chip, Badge, Avatar, Tooltip, Stack, Typography, Box } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { useNavigate } from 'react-router-dom'
import style from './style'
import { generateDefaultIcon } from '../../constants/popularApps'
import { useTheme } from '@mui/material/styles'
import ShoppingBasket from '@mui/icons-material/ShoppingBasket'
import { WalletContext } from '../../WalletContext'
import Img from '../UhrpImg'
import useSxStyles from '../../utils/useSxStyles'
import { getRegistryClient } from '../../utils/clientFactories'
import { openUrl } from '../../utils/openUrl'
import deterministicImage from '../../utils/deterministicImage'

interface BasketChipProps {
  basketId: string
  clickable?: boolean
  size?: number
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
  expires?: string
  onCloseClick?: () => void
  canRevoke?: boolean
  layout?: 'default' | 'compact'
}

const BasketChip = ({
  basketId,
  clickable = false,
  size = 1.3,
  onClick,
  expires,
  onCloseClick = () => { },
  canRevoke = false,
  layout = 'default'
}: BasketChipProps) => {
  const navigate = useNavigate()
  const {
    managers,
    settings,
    network,
  } = useContext(WalletContext)

  if (typeof basketId !== 'string') {
    throw new Error('BasketChip was initialized without a valid basketId')
  }
  const styles = useSxStyles(style)
  const theme = useTheme()

  // Initialize BasketMap
  const registrant = useMemo(
    () => getRegistryClient(managers?.permissionsManager, { networkPreset: network }),
    [managers?.permissionsManager, network]
  )

  const [basketName, setBasketName] = useState(basketId)
  const [iconURL, setIconURL] = useState(generateDefaultIcon(basketId))
  const [description, setDescription] = useState('Basket description not found.')
  const [documentationURL, setDocumentationURL] = useState('https://docs.bsvblockchain.org')

  useEffect(() => {
    if (!registrant || !settings?.trustSettings) {
      return undefined
    }

    let cancelled = false
    const cacheKey = `basketInfo_${basketId}`

    const fetchAndCacheData = async () => {
      // Try to load data from cache
      const cachedData = window.localStorage.getItem(cacheKey)
      if (cachedData) {
        const { name, iconURL, description, documentationURL } = JSON.parse(cachedData)
        if (!cancelled) {
          setBasketName(name)
          setIconURL(iconURL)
          setDescription(description)
          setDocumentationURL(documentationURL)
        }
      }
      try {
        // Fetch basket info by ID and trusted entities' public keys
        const trustedEntities = settings.trustSettings.trustedCertifiers.map(x => x.identityKey)
        const results = await registrant.resolve('basket', {
          basketID: basketId,
          registryOperators: trustedEntities
        })

        if (results && results.length > 0) {
          // Compute the most trusted of the results
          let mostTrustedIndex = 0
          let maxTrustPoints = 0
          for (let i = 0; i < results.length; i++) {
            const resultTrustLevel = settings.trustSettings.trustedCertifiers.find(x => x.identityKey === results[i].registryOperator)?.trust || 0
            if (resultTrustLevel > maxTrustPoints) {
              mostTrustedIndex = i
              maxTrustPoints = resultTrustLevel
            }
          }
          const basket = results[mostTrustedIndex] || {
            name: basketId,
            iconURL: deterministicImage(basketId),
            description: 'Basket description not found.',
            documentationURL: 'https://docs.bsvblockchain.org'
          }

          // Update state and cache the results
          if (!cancelled) {
            setBasketName(basket.name)
            setIconURL(basket.iconURL)
            setDescription(basket.description)
            setDocumentationURL(basket.documentationURL)
          }

          // Store data in local storage
          window.localStorage.setItem(cacheKey, JSON.stringify({
            name: basket.name,
            iconURL: basket.iconURL,
            description: basket.description,
            documentationURL: basket.documentationURL
          }))
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to resolve basket metadata:', error)
          setBasketName(prev => prev || basketId)
        }
      }
    }

    fetchAndCacheData()
    return () => {
      cancelled = true
    }
  }, [basketId, registrant, settings?.trustSettings])

  const chipElement = (
    <Chip
      style={theme.templates?.chip ? theme.templates.chip({ size }) : {
        height: `${size * 32}px`,
        minHeight: `${size * 32}px`,
        backgroundColor: 'transparent',
        borderRadius: '16px',
        padding: '8px',
        margin: '4px'
      }}
      onDelete={onCloseClick}
      deleteIcon={canRevoke ? <CloseIcon /> : undefined}
      sx={{
        maxWidth: '100%',
        '& .MuiChip-label': {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 0.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        },
        '& .MuiTouchRipple-root': { display: clickable ? 'block' : 'none' }
      }}
      label={
        <div style={theme.templates?.chipLabel || { display: 'flex', flexDirection: 'column' }}>
          <span style={theme.templates?.chipLabelTitle ? theme.templates.chipLabelTitle({ size }) : {
            fontSize: `${Math.max(size * 0.8, 0.8)}rem`,
            fontWeight: '500',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap'
          }}>
            {basketName}
          </span>
          <span style={theme.templates?.chipLabelSubtitle || {
            fontSize: '0.7rem',
            opacity: 0.7,
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap'
          }}>
            {basketId}
          </span>
        </div>
      }
      icon={
        <Badge
          overlap='circular'
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right'
          }}
          badgeContent={
            <Tooltip
              arrow
              title='Token Basket (click to learn more about baskets)'
              onClick={e => {
                e.stopPropagation()
                void openUrl('https://projectbabbage.com/docs/babbage-sdk/concepts/baskets')
              }}
            >
              <Avatar
                sx={{
                  backgroundColor: '#FFFFFF',
                  color: 'green',
                  width: 20,
                  height: 20,
                  borderRadius: '10px',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  fontSize: '1.2em',
                  marginRight: '0.25em',
                  marginBottom: '0.3em'
                }}
              >
                <ShoppingBasket style={{ width: 16, height: 16 }} />
              </Avatar>
            </Tooltip>
          }
        >
          <Avatar
            variant='square'
            sx={{
              width: '2.2em',
              height: '2.2em',
              borderRadius: '4px',
              backgroundColor: '#000000AF'
            }}
          >
            <Box
              component={Img}
              src={iconURL}
              sx={{ width: '75%', height: '75%', ...styles.table_picture }}
            />
          </Avatar>
        </Badge>
      }
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        if (!clickable) return
        if (typeof onClick === 'function') {
          onClick(e)
          return
        }
        e.stopPropagation()
        navigate(`/dashboard/basket/${encodeURIComponent(basketId)}`, {
          state: {
            id: basketId,
            name: basketName,
            description,
            iconURL,
            documentationURL,
          }
        })
      }}
    />
  )

  if (layout === 'compact') {
    return (
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ minWidth: 0, maxWidth: '100%' }}
      >
        {chipElement}
        {expires && (
          <Typography variant="caption" color="textSecondary" sx={{ flexShrink: 0 }}>
            {expires}
          </Typography>
        )}
      </Stack>
    )
  }

  return (
    <Stack spacing={0.75} alignItems="flex-start" sx={{ minWidth: 0, width: '100%' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ width: '100%', minWidth: 0 }}
      >
        <Typography variant="body1" fontWeight="bold" sx={{ flexShrink: 0 }}>
          Basket
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>{chipElement}</Box>
      </Stack>
      {expires && (
        <Typography variant="caption" color="textSecondary">
          Expires {expires}
        </Typography>
      )}
    </Stack>
  )
}

export default BasketChip
