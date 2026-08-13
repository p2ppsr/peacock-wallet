import { useState, useContext, useEffect, useMemo, useCallback, useRef } from 'react'
import { Typography, IconButton, Box, Paper } from '@mui/material'
import Grid2 from '@mui/material/Grid2'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { WalletContext } from '../../../WalletContext'
import { IdentityCertificate, ProtoWallet, PushDrop, Transaction, Utils, VerifiableCertificate } from '@bsv/sdk'
import CertificateCard from './CertificateCard'
import { getIdentityClient, getLookupResolver } from '../../../utils/clientFactories'
import { toast } from 'react-toastify'

type CopyState = { id: boolean }

type DecryptedFields = Record<string, unknown>

type DisplayCertificate = IdentityCertificate & { decryptedFields?: DecryptedFields }

const MyIdentity: React.FC = () => {
  const { managers, network, adminOriginator, activeProfile } = useContext(WalletContext)
  const permissionsManager = managers?.permissionsManager

  const [certificates, setCertificates] = useState<DisplayCertificate[]>([])
  const [primaryIdentityKey, setPrimaryIdentityKey] = useState<string>('...')
  const [copied, setCopied] = useState<CopyState>({ id: false })
  const [onChainSerialNumbers, setOnChainSerialNumbers] = useState<string[]>([])
  const hasInitializedOnChainSerials = useRef(false)
  const [busySerialNumbers, setBusySerialNumbers] = useState<Record<string, boolean>>({})

  const onChainSerialNumbersUpdate = useCallback(async () => {
    const lookupResolver = await getLookupResolver({ networkPreset: network })
    if (!lookupResolver) return
    if (!primaryIdentityKey || primaryIdentityKey === '...') return

    const result = await lookupResolver.query({
        service: 'ls_identity',
        query: {
            identityKey: primaryIdentityKey,
            certifiers: [],
        }
    })

    const collected: string[] = []
    for (const output of result.outputs) {
      const decodedTx = Transaction.fromBEEF(output.beef)
      const outputs = decodedTx.outputs[output.outputIndex]
      const decoded = PushDrop.decode(outputs.lockingScript)

      for (const key of decoded.fields) {
        try {
          const str = Utils.toUTF8(Utils.toArray(key))
          const trimmed = str?.trim()
          if (trimmed && trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const obj = JSON.parse(trimmed)
            if (obj && obj.serialNumber) {
              collected.push(obj.serialNumber)
            }
          }
        } catch (error) {
          console.warn('Error parsing certificate', error)
        }
      }
    }

    const unique = Array.from(new Set(collected))
    setOnChainSerialNumbers(unique)
  }, [network, primaryIdentityKey])

  const cacheKey = useMemo(() => {
    if (!activeProfile?.id) return null
    return `provenCertificates_${activeProfile.id}`
  }, [activeProfile?.id])

  const handleCopy = useCallback((value: string) => {
    if (!value) return

    navigator.clipboard.writeText(value).catch(console.error)
    setCopied(prev => ({ ...prev, id: true }))
    window.setTimeout(() => {
      setCopied(prev => ({ ...prev, id: false }))
    }, 2000)
  }, [])

  useEffect(() => {
    if (!permissionsManager || typeof adminOriginator !== 'string' || !activeProfile?.id) {
      return undefined
    }

    let mounted = true

    const hydrateFromCache = () => {
      if (!cacheKey) return
      try {
        const cached = window.localStorage.getItem(cacheKey)
        if (!cached) return
        const parsed = JSON.parse(cached) as DisplayCertificate[]
        if (Array.isArray(parsed) && mounted) {
          setCertificates(parsed)
          if (!hasInitializedOnChainSerials.current) {
            const serials = parsed.map(c => c.serialNumber)
            setOnChainSerialNumbers(serials)
            onChainSerialNumbersUpdate()
            hasInitializedOnChainSerials.current = true
          }
        }
      } catch (error) {
        console.warn('Failed to parse cached certificates', error)
      }
    }

    const fetchCertificates = async () => {
      try {
        const certs = await permissionsManager.listCertificates(
          {
            certifiers: [],
            types: [],
            limit: 100
          },
          adminOriginator
        )

        const sourceCertificates = (certs?.certificates ?? []) as IdentityCertificate[]
        if (sourceCertificates.length === 0 || !mounted) return

        const proven: DisplayCertificate[] = []
        for (const certificate of sourceCertificates) {
          try {
            const fieldsToReveal = Object.keys(certificate.fields)
            const proof = await permissionsManager.proveCertificate(
              {
                certificate,
                fieldsToReveal,
                verifier: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
              },
              adminOriginator
            )
            const decryptedFields = await new VerifiableCertificate(
              certificate.type,
              certificate.serialNumber,
              certificate.subject,
              certificate.certifier,
              certificate.revocationOutpoint,
              certificate.fields,
              proof.keyringForVerifier,
              certificate.signature
            ).decryptFields(new ProtoWallet('anyone'))

            proven.push({
              ...certificate,
              decryptedFields
            })
          } catch (error) {
            console.error('Unable to prove certificate', error)
          }
        }

        if (!mounted) return
        if (proven.length > 0) {
          setCertificates(proven)
          if (!hasInitializedOnChainSerials.current) {
            const serials = proven.map(c => c.serialNumber)
            setOnChainSerialNumbers(serials)
            onChainSerialNumbersUpdate()
            hasInitializedOnChainSerials.current = true
          }
          if (cacheKey) {
            window.localStorage.setItem(cacheKey, JSON.stringify(proven))
          }
        } else if (cacheKey) {
          window.localStorage.removeItem(cacheKey)
        }
      } catch (error) {
        console.error('Failed to list certificates', error)
      }
    }

    const fetchPrimaryIdentityKey = async () => {
      try {
        const { publicKey } = await permissionsManager.getPublicKey({ identityKey: true }, adminOriginator)
        setPrimaryIdentityKey(publicKey)
      } catch (error) {
        console.error('Failed to load primary identity key', error)
      }
    }

    hydrateFromCache()
    fetchCertificates()
    fetchPrimaryIdentityKey()

    return () => {
      mounted = false
    }
  }, [permissionsManager, adminOriginator, activeProfile?.id, cacheKey, onChainSerialNumbersUpdate])

  useEffect(() => {
    if (!primaryIdentityKey || primaryIdentityKey === '...') return
    onChainSerialNumbersUpdate()
  }, [primaryIdentityKey, onChainSerialNumbersUpdate])

  const revealCertificatePublicly = useCallback(async (_serialNumber: string) => {
    const certificate = certificates.find(c => c.serialNumber === _serialNumber)

    if (!certificate) return
    const identityClient = getIdentityClient(permissionsManager, { adminOriginator, networkPreset: network })
    if (!identityClient) return

    await identityClient.publiclyRevealAttributes(certificate, Object.keys(certificate.decryptedFields))
  }, [permissionsManager, adminOriginator, certificates, network])

  const handleRevokeCertificate = useCallback(async (serialNumber: string) => {
    const identityClient = getIdentityClient(permissionsManager, { adminOriginator, networkPreset: network })
    if (!identityClient) return
    await identityClient.revokeCertificateRevelation(serialNumber)
  }, [permissionsManager, adminOriginator, network])

  const handlePublicVisibilityChange = useCallback(
    async (serialNumber: string, isPublic: boolean) => {
      setBusySerialNumbers(prev => ({ ...prev, [serialNumber]: true }))

      setOnChainSerialNumbers((prev) => {
        const set = new Set(prev)
        if (isPublic) {
          set.add(serialNumber)
        } else {
          set.delete(serialNumber)
        }
        return Array.from(set)
      })

      try {
        if (isPublic) {
          await revealCertificatePublicly(serialNumber)
          toast.success('Certificate is now public!')
        } else {
          await handleRevokeCertificate(serialNumber)
          toast.success('Certificate revelation revoked.')
        }
        await onChainSerialNumbersUpdate()
      } catch (error) {
        console.error('Failed to update public visibility', error)
        setOnChainSerialNumbers((prev) => {
          const set = new Set(prev)
          if (isPublic) {
            set.delete(serialNumber)
          } else {
            set.add(serialNumber)
          }
          return Array.from(set)
        })
        toast.error('Failed to update certificate visibility.')
      } finally {
        setBusySerialNumbers(prev => {
          const copy = { ...prev }
          delete copy[serialNumber]
          return copy
        })
      }
    },
    [revealCertificatePublicly, handleRevokeCertificate, onChainSerialNumbersUpdate]
  );

  const handleRelinquishCertificate = async (serialNumber: string) => {
    setBusySerialNumbers(prev => ({ ...prev, [serialNumber]: true }))
    try {
      const cert = certificates.find(c => c.serialNumber === serialNumber)
      if (permissionsManager && typeof adminOriginator === 'string' && cert) {
        await Promise.all([
          permissionsManager.relinquishCertificate(
            {
              type: cert.type,
              serialNumber: cert.serialNumber,
              certifier: cert.certifier
            },
            adminOriginator
          ),
          handleRevokeCertificate(serialNumber)
        ])

        setCertificates(prevCertificates => {
          const updatedCertificates = prevCertificates.filter(cert => cert.serialNumber !== serialNumber)
          if (cacheKey) {
            window.localStorage.setItem(cacheKey, JSON.stringify(updatedCertificates))
          }
          const serials = updatedCertificates.map(c => c.serialNumber)
          setOnChainSerialNumbers(serials)
          return updatedCertificates
        })

        await onChainSerialNumbersUpdate()
        toast.success('Certificate deleted.')
      }
    } catch (error) {
      console.error('Error relinquishing certificate', error)
      toast.error('Failed to delete certificate.')
    } finally {
      setBusySerialNumbers(prev => {
        const copy = { ...prev }
        delete copy[serialNumber]
        return copy
      })
    }
  }

  return (
    <Box
      sx={{
        maxWidth: 800,
        mx: 'auto',
        px: { xs: 2, md: 3 },
        py: 3
      }}
    >
      <Typography variant="h1" color="textPrimary" sx={{ mb: 2 }}>
        {network === 'teratestnet' ? 'TerraTestNet Identity' : network === 'testnet' ? 'Testnet Identity' : 'Identity'}
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 4 }}>
        Manage the public identity apps use to recognize you and the credentials that support it.
      </Typography>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Your public identity key
        </Typography>
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
            Share this public key when an app or person needs to identify you. It cannot unlock your wallet.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                bgcolor: 'action.hover',
                py: 1,
                px: 2,
                flexGrow: 1,
                overflow: 'hidden'
              }}
            >
              {primaryIdentityKey}
            </Typography>
            <IconButton
              aria-label="Copy public identity key"
              size='small'
              onClick={() => handleCopy(primaryIdentityKey)}
              disabled={copied.id}
              sx={{ ml: 1 }}
            >
              {copied.id ? <CheckIcon /> : <ContentCopyIcon fontSize='small' />}
            </IconButton>
          </Box>
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Certificates
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          Certifiers can issue credentials that let other people and apps verify selected facts about you. You control whether each credential is public.
        </Typography>

        <Grid2 container spacing={2} columns={{ xs: 1, md: 2 }}>
          {certificates.map(cert => (
            <Grid2 key={`${cert.serialNumber}-${cert.certifier}`} size={{ xs: 1, md: 1 }}>
              <CertificateCard
                certificate={cert}
                clickable={false}
                canRelinquish
                onRelinquish={handleRelinquishCertificate}
                onPublicVisibilityChange={handlePublicVisibilityChange}
                publicOnChain={onChainSerialNumbers.includes(cert.serialNumber)}
                busy={Boolean(busySerialNumbers[cert.serialNumber])}
              />
            </Grid2>
          ))}
        </Grid2>

        {certificates.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="textSecondary">
              No credentials yet. They will appear here after a trusted certifier issues one to you.
            </Typography>
          </Box>
        )}
      </Paper>
    </Box>
  )
}

export default MyIdentity
