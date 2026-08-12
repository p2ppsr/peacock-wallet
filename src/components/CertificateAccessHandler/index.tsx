import { useContext, useState, useEffect, useMemo } from 'react'
import { DialogContent, DialogActions, Button, Typography, Stack, CircularProgress } from '@mui/material'
import CustomDialog from '../CustomDialog'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'
import { InfoRow, PermissionHeader, RequestCard, Surface } from '../permissions/PermissionScaffold'
import { getRegistryClient } from '../../utils/clientFactories'
import CounterpartyChip from '../CounterpartyChip'
type CertificateAccessRequest = {
  requestID: string
  certificateType?: string
  fields?: any
  verifierPublicKey?: string
  originator: string
  description?: string
  renewal?: boolean
}

const CertificateAccessHandler = () => {
  const { certificateRequests, advanceCertificateQueue, managers, settings, network } = useContext(WalletContext)
  const { certificateAccessModalOpen } = useContext(UserContext)

  const [granting, setGranting] = useState(false)
  const [denying, setDenying] = useState(false)
  const [certName, setCertName] = useState<string | null>(null)

  const registry = useMemo(
    () => getRegistryClient(managers?.permissionsManager, { networkPreset: network }),
    [managers?.permissionsManager, network]
  )

  const handleDeny = async () => {
    if (!certificateRequests.length) return
    try {
      setDenying(true)
      await managers.permissionsManager?.denyPermission(certificateRequests[0].requestID)
      const { originator } = certificateRequests[0] as CertificateAccessRequest
      window.dispatchEvent(new CustomEvent('cert-access-changed', { detail: { op: 'deny', originator } }))
    } finally {
      setDenying(false)
      advanceCertificateQueue()
    }
  }

  const handleGrant = async () => {
    if (!certificateRequests.length) return
    const { requestID, originator } = certificateRequests[0] as CertificateAccessRequest
    try {
      setGranting(true)
      await managers.permissionsManager?.grantPermission({ requestID })
      window.dispatchEvent(new CustomEvent('cert-access-changed', { detail: { op: 'grant', originator } }))
    } finally {
      setGranting(false)
      advanceCertificateQueue()
    }
  }

  const currentRequest = certificateRequests[0] as CertificateAccessRequest | undefined

  useEffect(() => {
    let cancelled = false
    const resolveCert = async () => {
      if (!registry || !settings?.trustSettings || !currentRequest?.certificateType) return
      try {
        const operators = settings.trustSettings.trustedCertifiers.map(x => x.identityKey)
        const results = await registry.resolve('certificate', {
          type: currentRequest.certificateType,
          registryOperators: operators
        })
        if (!results || !results.length) return
        let best = 0
        let idx = 0
        for (let i = 0; i < results.length; i++) {
          const trust = settings.trustSettings.trustedCertifiers.find(x => x.identityKey === results[i].registryOperator)?.trust || 0
          if (trust > best) {
            best = trust
            idx = i
          }
        }
        const picked = results[idx]
        if (!cancelled && picked?.name) {
          setCertName(picked.name)
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to resolve certificate metadata', err)
        }
      }
    }
    resolveCert()
    return () => { cancelled = true }
  }, [registry, settings?.trustSettings, currentRequest?.certificateType])

  if (!certificateAccessModalOpen || !currentRequest) return null

  const { originator, verifierPublicKey, certificateType, description, renewal } = currentRequest

  return (
    <CustomDialog
      open={certificateAccessModalOpen}
      title="Permission needed"
      onClose={handleDeny}
      icon={<VerifiedUserIcon fontSize="medium" />}
    >
      <DialogContent sx={{ pt: 0 }}>
        <Stack spacing={2}>
          <PermissionHeader
            appDomain={originator || 'Unknown app'}
            contextLine="wants to view your credentials"
          />

          <RequestCard
            title={renewal ? 'Renew certificate access' : 'Allow access to your credential'}
            body={description || 'The app needs to read one of your identity certificates to continue.'}
          />

          <Surface>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
              What this allows
            </Typography>
            <Stack spacing={1}>
              <InfoRow label="Certificate" value={certName || certificateType || 'Not specified'} />
              {verifierPublicKey && (
                <InfoRow
                  label="Verifier"
                  value={(
                    <CounterpartyChip
                      counterparty={verifierPublicKey}
                      clickable={false}
                      layout="compact"
                      size={1.0}
                    />
                  )}
                  muted
                />
              )}
              <InfoRow label="App" value={originator || 'Unknown'} muted />
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
              This appeared because <strong>{originator || 'an app'}</strong> tried to view your credential. Approve only if you expect this app to verify your identity.
            </Typography>
          </Surface>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button onClick={handleDeny} variant="text" color="inherit" disabled={granting || denying}>
          No, keep blocked
        </Button>

        <Button onClick={handleGrant} variant="contained" color="primary" disabled={granting || denying}>
          {granting ? <CircularProgress size={18} /> : 'Allow this app'}
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default CertificateAccessHandler
