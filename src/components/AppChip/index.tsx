import { useState, useEffect } from 'react'
import { Chip, Badge, Tooltip, Avatar, Stack, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import isImageUrl from '../../utils/isImageUrl'
import { useTheme, styled } from '@mui/material/styles'
import Img from '../UhrpImg'
import Memory from '@mui/icons-material/Memory'
import CloseIcon from '@mui/icons-material/Close'
import { generateDefaultIcon } from '../../constants/popularApps'
import PlaceholderAvatar from '../PlaceholderAvatar'
import { Box } from '@mui/material'
import { openUrl } from '../../utils/openUrl'
// Create styled components for elements that need specific styling
const ChipContainer = styled('div')(() => ({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
}))

const ExpiryText = styled('span')(({ theme }) => ({
  position: 'absolute',
  opacity: 0,
  transition: 'opacity 0.3s ease',
  bottom: '-20px',
  left: '50%',
  transform: 'translateX(-50%)',
  backgroundColor: theme.palette.background.paper,
  padding: '2px 6px',
  borderRadius: '4px',
  boxShadow: theme.shadows[1],
  fontSize: '0.75rem',
  [`${ChipContainer}:hover &`]: {
    opacity: 1
  }
}))

interface AppChipProps {
  label: string
  showDomain?: boolean
  clickable?: boolean
  size?: number
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  backgroundColor?: string
  expires?: string
  onCloseClick?: () => void
}

const AppChip: React.FC<AppChipProps> = ({
  label,
  showDomain = false,
  clickable = true,
  size = 1,
  onClick,
  backgroundColor = 'transparent',
  expires,
  onCloseClick
}) => {
  const navigate = useNavigate()
  const theme = useTheme()
  if (typeof label !== 'string') {
    throw new Error('Error in AppChip: label prop must be a string!')
  }
  let displayLabel = label
  if (displayLabel.startsWith('babbage_app_')) {
    displayLabel = displayLabel.substring(12)
  }
  if (displayLabel.startsWith('https://')) {
    displayLabel = displayLabel.substring(8)
  }
  if (displayLabel.startsWith('http://')) {
    displayLabel = displayLabel.substring(7)
  }
  const [parsedLabel, setParsedLabel] = useState(displayLabel)
  const [appIconImageUrl, setAppIconImageUrl] = useState(generateDefaultIcon(displayLabel))
  const [imageError, setImageError] = useState(false)

  // Reset state values when label changes to prevent stale data
  useEffect(() => {
    // When label changes, reset to default state first to avoid showing stale data
    setParsedLabel(displayLabel)
    setAppIconImageUrl(generateDefaultIcon(displayLabel))
    setImageError(false)
  }, [displayLabel])

  // Handle data fetching in a separate effect
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    const fetchAndCacheData = async () => {
      const faviconKey = `favicon_label_${displayLabel}`
      const manifestKey = `manifest_label_${displayLabel}`

      const cachedFavicon = window.localStorage.getItem(faviconKey)
      if (cachedFavicon && !cancelled) {
        setAppIconImageUrl(cachedFavicon)
      }

      const faviconUrl = `https://${displayLabel}/favicon.ico`
      try {
        if (!cancelled && await isImageUrl(faviconUrl)) {
          setAppIconImageUrl(faviconUrl)
          window.localStorage.setItem(faviconKey, faviconUrl)
        }
      } catch (error) {
        console.warn('Failed to resolve favicon for app', displayLabel, error)
      }

      const cachedManifest = window.localStorage.getItem(manifestKey)
      if (cachedManifest && !cancelled) {
        try {
          const manifest = JSON.parse(cachedManifest)
          if (manifest?.name) {
            setParsedLabel(manifest.name)
          }
        } catch (e) {
          console.error('Error parsing cached manifest:', e)
          window.localStorage.removeItem(manifestKey)
        }
      }

      try {
        const protocol = displayLabel.startsWith('localhost:') ? 'http' : 'https'
        const url = `${protocol}://${displayLabel}/manifest.json`
        const response = await fetch(url, { signal: controller.signal })

        if (!response.ok) {
          throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`)
        }

        const manifestResponse = await response.json()

        if (!cancelled && manifestResponse?.name) {
          setParsedLabel(manifestResponse.name)
          window.localStorage.setItem(manifestKey, JSON.stringify(manifestResponse))
        }
      } catch (error) {
        if ((error as any)?.name !== 'AbortError') {
          console.warn('Fetch error while loading app manifest:', error)
        }
      }
    }

    fetchAndCacheData()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [displayLabel])

  // Handle image loading events
  const handleImageLoad = () => {
    setImageError(false)
  }

  const handleImageError = () => {
    setImageError(true)
  }

  return (
    <Stack
      direction="row"
      spacing={2}
      alignItems="center"
      justifyContent="flex-start"
      sx={{
        minHeight: '60px',
        width: '100%',
        p: 1
      }}
    >
      <ChipContainer sx={{ width: '100%' }}>
        <Chip
          style={theme.templates?.chip ? theme.templates.chip({ size, backgroundColor }) : {
            height: '48px',
            minHeight: '48px',
            width: '255px',
            backgroundColor: backgroundColor || 'rgba(0, 0, 0, 0.04)',
            borderRadius: '12px',
            padding: '4px 12px',
            border: '1px solid rgba(0, 0, 0, 0.12)',
            justifyContent: 'flex-start'
          }}
          label={
            (showDomain && displayLabel !== parsedLabel)
              ? <Box sx={{ 
                  textAlign: 'left', 
                  py: 0.5,
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden'
                }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      lineHeight: 1.2,
                      mb: 0.25,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {parsedLabel}
                  </Typography>
                  <Tooltip title={displayLabel} arrow placement="bottom">
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: '0.75rem',
                        opacity: 0.7,
                        lineHeight: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block',
                        // cursor: 'help'
                      }}
                    >
                      {displayLabel}
                    </Typography>
                  </Tooltip>
                </Box>
              : <Tooltip title={parsedLabel} arrow placement="bottom">
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      // cursor: 'help'
                    }}
                  >
                    {parsedLabel}
                  </Typography>
                </Tooltip>
          }
          onDelete={onCloseClick}
          deleteIcon={typeof onCloseClick === 'function' ? <CloseIcon sx={{ fontSize: 18 }} /> : undefined}
          icon={(
            <Badge
              overlap='circular'
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right'
              }}
              badgeContent={
                <Tooltip
                  arrow
                  title='App (click to learn more about apps)'
                  onClick={e => {
                    e.stopPropagation()
                    void openUrl('https://projectbabbage.com/docs/babbage-sdk/concepts/apps')
                  }}
                >
                  <Avatar
                    sx={{
                      backgroundColor: 'primary.main',
                      color: 'primary.contrastText',
                      width: 18,
                      height: 18,
                      borderRadius: '9px',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginRight: '0.2em',
                      marginBottom: '0.2em',
                      border: '2px solid white'
                    }}
                  >
                    <Memory sx={{ fontSize: 12 }} />
                  </Avatar>
                </Tooltip>
              }
            >
              {!imageError ? (
                <Avatar
                  variant='rounded'
                  sx={{
                    width: 36,
                    height: 36,
                    backgroundColor: theme.palette.action.hover,
                    marginRight: '12px',
                    flexShrink: 0
                  }}
                >
                  <Img
                    src={appIconImageUrl}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                    alt={`${parsedLabel} app icon`}
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                  />
                </Avatar>
              ) : (
                <PlaceholderAvatar
                  name={parsedLabel || displayLabel}
                  variant="rounded"
                  size={36}
                  sx={{ 
                    marginRight: '12px',
                    flexShrink: 0
                  }}
                />
              )}
            </Badge>
          )}
          onClick={(e: any) => {
            if (clickable) {
              if (typeof onClick === 'function') {
                onClick(e)
              } else {
                e.stopPropagation()
                navigate(`/dashboard/app/${encodeURIComponent(displayLabel)}`)
              }
            }
          }}
          sx={{
            '& .MuiChip-label': {
              flex: 1,
              overflow: 'hidden',
              padding: '0 8px'
            }
          }}
        />
        {expires && <ExpiryText>{expires}</ExpiryText>}
      </ChipContainer>
    </Stack>
  )
}

export default AppChip
