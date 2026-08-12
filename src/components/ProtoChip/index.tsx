import { useState, useEffect, useContext, useMemo, type MouseEvent } from 'react'
import { Chip, Avatar, Stack, Typography, Box } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import CloseIcon from '@mui/icons-material/Close'
import { useTheme } from '@mui/material/styles'
import { deterministicImage } from '../../utils/deterministicImage'
import CounterpartyChip from '../CounterpartyChip/index'
import { WalletContext } from '../../WalletContext'
import { SecurityLevel } from '@bsv/sdk'
import { getRegistryClient } from '../../utils/clientFactories'
import Img from '../UhrpImg'
import PlaceholderAvatar from '../PlaceholderAvatar'

interface ProtoChipProps {
  securityLevel: number
  protocolID: string
  counterparty?: string
  originator?: string
  clickable?: boolean
  size?: number
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
  expires?: string
  onCloseClick?: () => void
  canRevoke?: boolean
  description?: string
  iconURL?: string
  backgroundColor?: string
  layout?: 'default' | 'compact'
}

const ProtoChip = ({
  securityLevel,
  protocolID,
  counterparty,
  originator,
  clickable = false,
  size = 1.3,
  onClick,
  expires,
  onCloseClick,
  canRevoke = true,
  // description,
  // iconURL,
  backgroundColor = 'transparent',
  layout = 'default'
}: ProtoChipProps) => {
  const theme = useTheme()
  const navigate = useNavigate()

  const navToProtocolDocumentation = (e: MouseEvent<HTMLDivElement>) => {
    if (clickable) {
      if (typeof onClick === 'function') {
        onClick(e)
      } else {
        e.stopPropagation()
        // Pass protocol data forward to prevent re-fetching
        navigate(`/dashboard/protocol/${encodeURIComponent(protocolID)}/${encodeURIComponent(securityLevel)}`, {
          state: {
            protocolName,
            iconURL,
            description,
            documentationURL,
            previousAppDomain: originator
          }
        })
      }
    }
  }

  // Validate protocolID before hooks
  if (typeof protocolID !== 'string') {
    console.error('ProtoChip: protocolID must be a string. Received:', protocolID)
    // Don't return null here to avoid conditional hook calls
  }

  const [protocolName, setProtocolName] = useState(protocolID)
  const [iconURL, setIconURL] = useState(deterministicImage(protocolID))
  const [description, setDescription] = useState('Protocol description not found.')
  const [documentationURL, setDocumentationURL] = useState('https://docs.bsvblockchain.org')
  const [avatarError, setAvatarError] = useState(false)
  const { managers, settings, network } = useContext(WalletContext)
  const registrant = useMemo(
    () => getRegistryClient(managers?.permissionsManager, { networkPreset: network }),
    [managers?.permissionsManager, network]
  )

  useEffect(() => {
    if (!registrant || !settings?.trustSettings) {
      return undefined
    }

    let cancelled = false
    const cacheKey = `protocolInfo_${protocolID}_${securityLevel}`

    const fetchAndCacheData = async () => {
      // Try to load data from cache
      const cachedData = window.localStorage.getItem(cacheKey)
      if (cachedData) {
        try {
          const { name, iconURL, description, documentationURL } = JSON.parse(cachedData)
          if (!cancelled) {
            setProtocolName(name)
            setIconURL(iconURL || deterministicImage(protocolID))
            setDescription(description)
            setDocumentationURL(documentationURL)
          }
        } catch (error) {
          console.warn('Failed to parse cached protocol info', error)
        }
      }
      try {
        // Resolve a Protocol info from id and security level
        const certifiers = settings.trustSettings.trustedCertifiers.map(x => x.identityKey)
        const results = await registrant.resolve('protocol', {
          protocolID: [securityLevel as SecurityLevel, protocolID],
          registryOperators: certifiers
        })

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
        const trusted = results[mostTrustedIndex] || {
          name: protocolID,
          iconURL: deterministicImage(protocolID),
          description: 'Protocol description not found.',
          documentationURL: 'https://docs.bsvblockchain.org'
        }

        // Update state and cache the results
        if (!cancelled && trusted) {
          setProtocolName(trusted.name)
          setIconURL(trusted.iconURL)
          setDescription(trusted.description)
          setDocumentationURL(trusted.documentationURL)
        }

        // Store data in local storage
        window.localStorage.setItem(cacheKey, JSON.stringify({
          name: trusted.name,
          iconURL: trusted.iconURL,
          description: trusted.description,
          documentationURL: trusted.documentationURL
        }))
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to resolve protocol metadata:', error)
        }
      }
    }

    fetchAndCacheData()
    return () => {
      cancelled = true
    }
  }, [protocolID, securityLevel, registrant, settings?.trustSettings])

  useEffect(() => {
    if (typeof protocolID === 'string') {
      // Update state if props change
      setProtocolName(protocolID)
      setIconURL(prev => prev || deterministicImage(protocolID))
    }
  }, [protocolID])

  const securityLevelExplainer = (securityLevel: number) => {
    switch (securityLevel) {
      case 2:
        return 'only with this app and counterparty'
      case 1:
        return 'only with this app'
      case 0:
        return 'in general'
      default:
        return 'Unknown security level'
    }
  }

  // If protocolID is invalid, return null after hooks are defined
  if (typeof protocolID !== 'string') {
    return null
  }

  const chipNode = (
    <Chip
      style={theme.templates?.chip ? theme.templates.chip({ size, backgroundColor }) : {
        height: `${size * 32}px`,
        minHeight: `${size * 32}px`,
        backgroundColor: backgroundColor || 'transparent',
        borderRadius: '16px',
        padding: '8px',
        margin: '4px'
      }}
      icon={
        iconURL && !avatarError ? (
          <Avatar alt={protocolName} sx={{ width: '2.5em', height: '2.5em', flexShrink: 0 }}>
            <Box
              component={Img}
              src={iconURL}
              alt={protocolName}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={() => setAvatarError(true)}
              loading="lazy"
            />
          </Avatar>
        ) : (
          <PlaceholderAvatar
            name={protocolName}
            sx={{ width: '2.5em', height: '2.5em', flexShrink: 0 }}
          />
        )
      }
      label={
        <div style={{
          ...theme.templates?.chipLabel,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '260px'
        }}>
          <span style={{
            ...theme.templates?.chipLabelTitle ? theme.templates.chipLabelTitle({ size }) : {},
            fontSize: `${Math.max(size * 0.8, 0.8)}rem`,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {protocolName || protocolID}
          </span>
          <span style={{
            ...theme.templates?.chipLabelSubtitle,
            fontSize: '0.75rem',
            opacity: 0.7,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {protocolID}
          </span>
        </div>
      }
      onClick={navToProtocolDocumentation}
      onDelete={canRevoke ? onCloseClick : undefined}
      deleteIcon={canRevoke ? <CloseIcon /> : undefined}
      sx={{
        maxWidth: '100%',
        '& .MuiTouchRipple-root': { display: clickable ? 'block' : 'none' }
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
    <Stack spacing={1.25} sx={{ width: '100%', minWidth: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ width: '100%', minWidth: 0 }}
      >
        <Typography variant="body1" fontWeight="bold" sx={{ flexShrink: 0 }}>
          Protocol
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>{chipNode}</Box>
      </Stack>

      <Typography variant="body2" color="textSecondary">
        {description || 'Protocol description not found.'}
      </Typography>

      {(counterparty && securityLevel > 1) && (
        <CounterpartyChip counterparty={counterparty} layout="compact" />
      )}

      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
        <Typography variant="body1" fontWeight="bold" sx={{ flexShrink: 0 }}>
          Scope
        </Typography>
        <Typography variant="body1">
          {securityLevelExplainer(securityLevel)}
        </Typography>
      </Stack>

      {expires && (
        <Typography variant="caption" color="textSecondary">
          Expires {expires}
        </Typography>
      )}
    </Stack>
  )
}

export default ProtoChip
