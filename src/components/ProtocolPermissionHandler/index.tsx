import { useContext, useEffect, useMemo, useState } from 'react'
import { DialogContent, DialogActions, Button, Stack, Typography } from '@mui/material'
import CustomDialog from '../CustomDialog/index'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import CodeIcon from '@mui/icons-material/Code'
import CachedIcon from '@mui/icons-material/Cached'
import ShoppingBasketIcon from '@mui/icons-material/ShoppingBasket'
import { InfoRow, PermissionHeader, RequestCard, Surface } from '../permissions/PermissionScaffold'
import { getRegistryClient } from '../../utils/clientFactories'
import CounterpartyChip from '../CounterpartyChip'

// Permission type documents
const permissionTypeDocs = {
  identity: {
    title: 'Trusted Entities Access Request',
    description: 'An app is requesting access to lookup identity information using the entities you trust.',
    icon: <VerifiedUserIcon fontSize="medium" />
  },
  renewal: {
    title: 'Protocol Access Renewal',
    description: 'An app is requesting to renew its previous access to a protocol.',
    icon: <CachedIcon fontSize="medium" />
  },
  basket: {
    title: 'Basket Access Request',
    description: 'An app wants to view your tokens within a specific basket.',
    icon: <ShoppingBasketIcon fontSize="medium" />
  },
  protocol: {
    title: 'Protocol Access Request',
    description: 'An app is requesting to call a protocol using your wallet permissions.',
    icon: <CodeIcon fontSize="medium" />
  }
};

const ProtocolPermissionHandler = () => {
  const { protocolRequests, advanceProtocolQueue, managers, settings, network } = useContext(WalletContext)
  const { protocolAccessModalOpen } = useContext(UserContext)
  const [protocolName, setProtocolName] = useState<string | null>(null)
  const [protocolDescription, setProtocolDescription] = useState<string | null>(null)

  const registry = useMemo(
    () => getRegistryClient(managers?.permissionsManager, { networkPreset: network }),
    [managers?.permissionsManager, network]
  )

  // Handle denying the top request in the queue
  const handleDeny = () => {
    if (protocolRequests.length > 0) {
      managers.permissionsManager?.denyPermission(protocolRequests[0].requestID)
    }
    advanceProtocolQueue()
  }

  // Handle granting the top request in the queue
  const handleGrant = () => {
    if (protocolRequests.length > 0) {
      managers.permissionsManager?.grantPermission({
        requestID: protocolRequests[0].requestID
      })
    }
    advanceProtocolQueue()
  }

  const currentPerm = protocolRequests[0]
  // Get permission type document
  const getPermissionTypeDoc = () => {
    // Default to protocol if type is undefined
    const type = currentPerm?.type || 'protocol';
    return permissionTypeDocs[type];
  };

  const protocolLabel = Array.isArray(currentPerm?.protocolID)
    ? `${currentPerm.protocolID[1]}`
    : currentPerm?.protocolID
  const securityLabel = Array.isArray(currentPerm?.protocolSecurityLevel)
    ? currentPerm.protocolSecurityLevel.join(' • ')
    : currentPerm?.protocolSecurityLevel
  const protocolSecurity = Array.isArray(currentPerm?.protocolSecurityLevel)
    ? currentPerm.protocolSecurityLevel[0]
    : currentPerm?.protocolSecurityLevel

  useEffect(() => {
    let cancelled = false
    const fetchProtocolInfo = async () => {
      if (!registry || !settings?.trustSettings || !protocolLabel || protocolSecurity === undefined || protocolSecurity === null || !currentPerm) {
        return
      }
      try {
        const certifiers = settings.trustSettings.trustedCertifiers.map(x => x.identityKey)
        const results = await registry.resolve('protocol', {
          protocolID: [protocolSecurity as any, protocolLabel],
          registryOperators: certifiers
        })
        if (!results || !results.length) return
        let mostTrustedIndex = 0
        let maxTrustPoints = 0
        for (let i = 0; i < results.length; i++) {
          const trust = settings.trustSettings.trustedCertifiers.find(x => x.identityKey === results[i].registryOperator)?.trust || 0
          if (trust > maxTrustPoints) {
            mostTrustedIndex = i
            maxTrustPoints = trust
          }
        }
        const trusted = results[mostTrustedIndex]
        if (!cancelled && trusted) {
          setProtocolName(trusted.name || null)
          setProtocolDescription(trusted.description || null)
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to resolve protocol metadata:', err)
        }
      }
    }
    fetchProtocolInfo()
    return () => {
      cancelled = true
    }
  }, [registry, settings?.trustSettings, protocolLabel, protocolSecurity])

  if (!protocolAccessModalOpen || !currentPerm) return null

  return (
    <CustomDialog
      open={protocolAccessModalOpen}
      title="Permission needed"
      icon={getPermissionTypeDoc().icon}
      onClose={handleDeny} // If the user closes via the X, treat as "deny"
    >
      <DialogContent sx={{ pt: 0 }}>
        <Stack spacing={2}>
          <PermissionHeader
            appDomain={currentPerm.originator || 'Unknown app'}
            contextLine="wants to use your wallet"
          />

          <RequestCard
            title={getPermissionTypeDoc().title}
            body={
              currentPerm.description ||
              protocolDescription ||
              getPermissionTypeDoc().description ||
              'This app is asking to access a protocol through your wallet.'
            }
          />

          <Surface sx={{ background: 'radial-gradient(circle at 20% 20%, rgba(103,99,255,0.08), transparent 50%), linear-gradient(145deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))' }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
              What this allows
            </Typography>
            <Stack spacing={1}>
              <InfoRow label="Protocol" value={protocolName || protocolLabel || 'Not specified'} />
              <InfoRow label="Security level" value={securityLabel || 'Not specified'} />
              {currentPerm.counterparty && (
                <InfoRow
                  label="Counterparty"
                  value={(
                    <CounterpartyChip
                      counterparty={currentPerm.counterparty}
                      clickable={false}
                      layout="compact"
                      size={1.0}
                    />
                  )}
                />
              )}
            </Stack>
          </Surface>

          <Surface
            sx={{
              p: 1.75,
              borderStyle: 'dashed',
              borderColor: 'rgba(255,255,255,0.14)',
              background: 'linear-gradient(145deg, rgba(255,255,255,0.015), rgba(255,255,255,0.01))'
            }}
          >
            <Typography variant="caption" color="text.secondary">
              You are seeing this because <strong>{currentPerm.originator || 'this app'}</strong> tried to access the protocol above. Choose what happens next.
            </Typography>
          </Surface>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button
          onClick={handleDeny}
          variant="text"
          color="inherit"
        >
          No, keep blocked
        </Button>
        <Button
          onClick={handleGrant}
          variant="contained"
          color="primary"
          sx={{ minWidth: 140 }}
        >
          Allow this app
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default ProtocolPermissionHandler
