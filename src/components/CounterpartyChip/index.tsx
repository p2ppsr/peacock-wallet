import { useContext, useEffect, useState, useRef } from 'react'
import { Avatar, Chip, Stack, Typography, Box, IconButton, Tooltip } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import { useTheme } from '@mui/material/styles'
import style from './style'
import PlaceholderAvatar from '../PlaceholderAvatar'
import deterministicImage from '../../utils/deterministicImage'
import { WalletContext } from '../../WalletContext'
import Img from '../UhrpImg'
import useSxStyles from '../../utils/useSxStyles'

interface CounterpartyChipProps {
  counterparty: string
  clickable?: boolean
  size?: number
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  expires?: string
  onCloseClick?: () => void
  canRevoke?: boolean
  label?: string
  layout?: 'default' | 'compact'
}

const CounterpartyChip: React.FC<CounterpartyChipProps> = ({
  counterparty,
  clickable = false,
  size = 1.3,
  onClick,
  expires,
  onCloseClick = () => { },
  canRevoke = false,
  label = 'Counterparty',
  layout = 'default'
}) => {
  const navigate = useNavigate()
  const theme = useTheme()
  const styles = useSxStyles(style)
  const [identity, setIdentity] = useState({
    name: 'Unknown',
    badgeLabel: 'Unknown',
    abbreviatedKey: counterparty.substring(0, 10),
    badgeIconURL: 'https://bsvblockchain.org/favicon.ico',
    avatarURL: deterministicImage(counterparty)
  })
  const [resolvedCounterparty, setResolvedCounterparty] = useState(counterparty)

  const [avatarError, setAvatarError] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<number | null>(null)

  const { managers, adminOriginator, clients } = useContext(WalletContext)
  const identityClient = clients.identityClient

  // Handle image loading errors
  const handleAvatarError = () => {
    setAvatarError(true)
  }


  useEffect(() => {
    if (!managers?.permissionsManager || !identityClient) {
      return undefined
    }

    let cancelled = false

    // Function to load and potentially update identity for a specific counterparty
    const loadIdentity = async (counterpartyKey: string) => {
      let actualCounterpartyKey = counterpartyKey // Store the actual key
      
      // Initial load from local storage for a specific counterparty
      const cachedIdentity = window.localStorage.getItem(`identity_${counterpartyKey}`)
      if (cachedIdentity) {
        try {
          const parsed = JSON.parse(cachedIdentity)
          if (!cancelled) setIdentity(parsed)
        } catch (error) {
          console.warn('Failed to parse cached identity payload', error)
        }
      }

      try {
        // Resolve the counterparty key for 'self' or 'anyone'
        if (counterpartyKey === 'self') {
          const { publicKey } = await managers.permissionsManager.getPublicKey({ identityKey: true }, adminOriginator)
          actualCounterpartyKey = publicKey
          if (!cancelled) setResolvedCounterparty(actualCounterpartyKey)
        } else if (counterpartyKey === 'anyone') {
          actualCounterpartyKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
          if (!cancelled) setResolvedCounterparty(actualCounterpartyKey)
        } else {
          if (!cancelled) setResolvedCounterparty(counterpartyKey)
        }

        // Fetch the latest identity info from the server
        const results = await identityClient.resolveByIdentityKey({ identityKey: actualCounterpartyKey })
        if (!cancelled && Array.isArray(results) && results.length > 0) {
          setIdentity(results[0])
          // Update component state and cache in local storage
          window.localStorage.setItem(`identity_${actualCounterpartyKey}`, JSON.stringify(results[0]))
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('Failed to resolve counterparty identity:', e)
        }
      }
    }

    // Execute the loading function with the initial counterparty
    loadIdentity(counterparty)
    return () => {
      cancelled = true
    }
  }, [counterparty, managers.permissionsManager, adminOriginator, identityClient])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current)
        copyTimeoutRef.current = null
      }
    }
  }, [])

  const handleCopyPublicKey = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!resolvedCounterparty) return

    const text = resolvedCounterparty

    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current)
    }

    const triggerCopied = () => {
      setCopied(true)
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false)
        copyTimeoutRef.current = null
      }, 2000) as any
    }

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(triggerCopied)
        .catch(triggerCopied)
    } else {
      triggerCopied()
    }
  }

  const chipNode = (
    <Chip
      style={theme.templates?.chip ? theme.templates.chip({ size }) : {
        height: `${size * 32}px`,
        minHeight: `${size * 32}px`,
        backgroundColor: 'transparent',
        borderRadius: '16px',
        padding: '8px',
        margin: '4px'
      }}
      onDelete={canRevoke ? onCloseClick : undefined}
      deleteIcon={canRevoke ? <CloseIcon /> : undefined}
      sx={{
        maxWidth: '100%',
        '& .MuiChip-label': {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          lineHeight: 1.1,
          gap: 0.25,
          overflow: 'hidden'
        },
        '& .MuiTouchRipple-root': { display: clickable ? 'block' : 'none' }
      }}
      icon={
        identity.avatarURL && !avatarError ? (
          <Avatar alt={identity.name} sx={{ width: '2.5em', height: '2.5em' }}>
            <Box
              component={Img}
              src={identity.avatarURL}
              alt={identity.name}
              sx={styles.table_picture}
              onError={handleAvatarError}
              loading="lazy"
            />
          </Avatar>
        ) : (
          <PlaceholderAvatar
            name={identity.name}
            sx={{ width: '2.5em', height: '2.5em' }}
          />
        )
      }
      label={
        <div style={theme.templates?.chipLabel || { display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={theme.templates?.chipLabelTitle ? theme.templates.chipLabelTitle({ size }) : {
                fontSize: `${Math.max(size * 0.8, 0.8)}rem`,
                fontWeight: '500',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'nowrap'
              }}>
                {counterparty === 'self' ? 'Self' : identity.name}
              </span>
              <span style={theme.templates?.chipLabelSubtitle || {
                fontSize: '0.7rem',
                opacity: 0.7,
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'nowrap'
              }}>
                {counterparty === 'self' ? '' : (identity.abbreviatedKey || `${counterparty.substring(0, 10)}...`)}
              </span>
            </Box>
            <Tooltip title={copied ? 'Copied' : 'Copy'}>
              <span>
                <IconButton
                  size="small"
                  onClick={handleCopyPublicKey}
                  disabled={copied}
                  disableRipple
                  sx={(theme) => ({
                    p: 0,
                    color: copied ? 'inherit' : theme.palette.action.active,
                    '&:hover': {
                      backgroundColor: 'transparent'
                    }
                  })}
                >
                  {copied ? <CheckIcon fontSize="inherit" /> : <ContentCopyIcon fontSize="inherit" />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </div>
      }
      onClick={e => {
        if (!clickable) return
        if (typeof onClick === 'function') {
          onClick(e)
          return
        }
        e.stopPropagation()
        navigate(`/dashboard/counterparty/${encodeURIComponent(resolvedCounterparty)}`)
      }}
    />
  )

  if (layout === 'compact') {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, maxWidth: '100%' }}>
        {chipNode}
        {expires && (
          <Typography variant="caption" color="textSecondary" sx={{ flexShrink: 0 }}>
            {expires}
          </Typography>
        )}
      </Stack>
    )
  }

  return (
    <Stack spacing={0.75} sx={{ width: '100%', minWidth: 0 }} alignItems="flex-start">
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ width: '100%', minWidth: 0 }}
      >
        <Typography variant="body1" fontWeight="bold" sx={{ flexShrink: 0 }}>
          {label}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>{chipNode}</Box>
      </Stack>
      {expires && (
        <Typography variant="caption" color="textSecondary">
          Expires {expires}
        </Typography>
      )}
    </Stack>
  )
}

export default CounterpartyChip
