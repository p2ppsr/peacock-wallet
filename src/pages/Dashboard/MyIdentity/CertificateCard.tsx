import React, { useState, useEffect, useContext, useCallback, useRef, useMemo } from 'react'
import {
  Card,
  CardContent,
  Typography,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Avatar,
  IconButton,
  Stack,
  Divider,
  Tooltip,
  CircularProgress
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import { Img } from '@bsv/uhrp-react'
import CounterpartyChip from '../../../components/CounterpartyChip'
import Chip from '@mui/material/Chip'
import { DEFAULT_APP_ICON } from '../../../constants/popularApps'
import { useNavigate } from 'react-router-dom'
import { WalletContext } from '../../../WalletContext'
import { CertificateDefinitionData, CertificateFieldDescriptor, IdentityCertificate } from '@bsv/sdk'
import DeleteIcon from '@mui/icons-material/Delete'
import PublicIcon from '@mui/icons-material/Public'
import PublicOffIcon from '@mui/icons-material/PublicOff'
import { alpha } from '@mui/material/styles'
import { getRegistryClient } from '../../../utils/clientFactories'

// Props for the CertificateCard component.
interface CertificateCardProps {
  certificate: IdentityCertificate & { decryptedFields?: Record<string, any> }
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  clickable?: boolean
  canRelinquish?: boolean
  onRelinquish?: (serialNumber: string) => void | Promise<void>
  onPublicVisibilityChange?: (serialNumber: string, isPublic: boolean) => void
  publicOnChain?: boolean
  busy?: boolean
}

// Props for the CertificateDetailsModal component.
interface CertificateDetailsModalProps {
  open: boolean
  onClose: (event?: React.SyntheticEvent | Event) => void
  fieldDetails: { [key: string]: CertificateFieldDescriptor }
  actualData: { [key: string]: any }
  certName?: string
  iconURL?: string
  description?: string
  serialNumber?: string
  certificateType?: string
  documentationURL?: string
}

// Responsible for displaying certificate information within the MyIdentity page
const CertificateCard: React.FC<CertificateCardProps> = ({
  certificate,
  onClick,
  clickable = true,
  canRelinquish = false,
  onRelinquish,
  onPublicVisibilityChange,
  publicOnChain,
  busy = false
}) => {
  const navigate = useNavigate()
  const [certName, setCertName] = useState<string>('Custom Certificate')
  const [iconURL, setIconURL] = useState<string>(DEFAULT_APP_ICON)
  const [description, setDescription] = useState<string>('')
  const [fields, setFields] = useState<{ [key: string]: CertificateFieldDescriptor }>({})
  const { managers, settings, activeProfile } = useContext(WalletContext)
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [documentationURL, setDocumentationURL] = useState<string>('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<boolean>(false)

  const registrant = useMemo(
    () => getRegistryClient(managers.walletManager),
    [managers.walletManager]
  )

  const isPublicOnChain = Boolean(publicOnChain)

  // Handle modal actions
  const handleModalOpen = () => {
    setModalOpen(true)
  }
  const handleModalClose = (event?: React.SyntheticEvent | Event) => {
    if (event) {
      event.stopPropagation()
    }
    setModalOpen(false)
  }

  const handlePublicVisibilityClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (busy) return
    e.stopPropagation()
    if (onPublicVisibilityChange) {
      onPublicVisibilityChange(certificate.serialNumber, !isPublicOnChain)
    }
  }
  const handleOpenDeleteConfirm = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (busy) return
    e.stopPropagation()
    setDeleteConfirmOpen(true)
  }
  const handleCloseDeleteConfirm = (event?: React.SyntheticEvent | Event) => {
    if (event) {
      event.stopPropagation()
    }
    setDeleteConfirmOpen(false)
  }

  useEffect(() => {
    ;(async () => {
      try {
        const registryOperators: string[] = settings.trustSettings.trustedCertifiers.map(
          (x: any) => x.identityKey
        )
        const cacheKey = `certData_${certificate.type}_${registryOperators.join('_')}+${activeProfile.id}`
        const cachedData = window.localStorage.getItem(cacheKey)

        if (cachedData) {
          const cachedCert = JSON.parse(cachedData)
          setCertName(cachedCert.name)
          setIconURL(cachedCert.iconURL)
          setDescription(cachedCert.description)
          setFields(cachedCert.fields)
        }
        if (!registrant) return
        const results = (await registrant.resolve('certificate', {
          type: certificate.type,
          registryOperators
        })) as CertificateDefinitionData[]

        if (results && results.length > 0) {
          // Compute the most trusted of the results
          let mostTrustedIndex = 0
          let maxTrustPoints = 0
          for (let i = 0; i < results.length; i++) {
            const resultTrustLevel =
              settings.trustSettings.trustedCertifiers.find(
                (x: any) => x.identityKey === results[i].registryOperator
              )?.trust || 0
            if (resultTrustLevel > maxTrustPoints) {
              mostTrustedIndex = i
              maxTrustPoints = resultTrustLevel
            }
          }
          const mostTrustedCert = results[mostTrustedIndex]
          setCertName(mostTrustedCert.name)
          setIconURL(mostTrustedCert.iconURL)
          setDocumentationURL(mostTrustedCert?.documentationURL)
          setDescription(mostTrustedCert.description)
          setFields(mostTrustedCert.fields)

          // Cache the fetched data
          window.localStorage.setItem(cacheKey, JSON.stringify(mostTrustedCert))
        } else {
          window.localStorage.removeItem(cacheKey)
        }
      } catch (error) {
        console.error('Failed to fetch certificate details:', error)
      }
    })()
  }, [certificate, settings, managers.walletManager, registrant])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (clickable) {
      if (typeof onClick === 'function') {
        onClick(e)
      } else {
        e.stopPropagation()
        navigate(`/dashboard/certificate/${encodeURIComponent(certificate.type)}`)
      }
    }
  }

  return (
    <Card
      sx={(theme) => ({
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
        '&:hover': clickable
          ? {
            boxShadow: 3,
            transform: 'translateY(-2px)'
          }
          : {},
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        borderRadius: 2,
        border: '1px solid',
        borderColor: alpha(theme.palette.primary.main, 0.18),
        background: `linear-gradient(150deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${theme.palette.background.paper} 55%)`
      })}
      onClick={handleClick}
      variant="outlined"
    >
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flexGrow: 1, p: 2.25, '&:last-child': { pb: 2.25 } }}>
        {/* Revoke button - only shown when canRevoke is true */}
        {canRelinquish && (
          <Box
            sx={(theme) => ({
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              p: 0.5,
              borderRadius: 1.5,
              border: '1px solid',
              borderColor: alpha(theme.palette.primary.main, 0.12),
              backgroundColor: alpha(theme.palette.background.paper, 0.6),
              backdropFilter: 'blur(6px)'
            })}
          >
            {busy && (
              <CircularProgress size={18} />
            )}
            <Tooltip title={isPublicOnChain ? 'Public' : 'Not public'}>
              <IconButton
                color="primary"
                size="small"
                onClick={handlePublicVisibilityClick}
                aria-label="toggle public visibility"
                disabled={busy}
              >
                {isPublicOnChain ? (
                  <PublicIcon fontSize="small" />
                ) : (
                  <PublicOffIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton
                color="primary"
                size="small"
                onClick={handleOpenDeleteConfirm}
                aria-label="revoke certificate"
                disabled={busy}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar sx={{ width: 56, height: 56, border: '2px solid', borderColor: 'primary.light' }}>
            <Img
              style={{ width: '75%', height: '75%' }}
              src={iconURL}
            />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" component="h3" sx={{ fontWeight: 600, mb: 0.5 }}>
              {certName}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {description || 'No description provided for this certificate.'}
            </Typography>
          </Box>
        </Stack>

        <Box sx={{ flexGrow: 1 }} />

        <CounterpartyChip
          counterparty={certificate.certifier}
          label="Issuer"
        />

        <Button
          variant="outlined"
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            handleModalOpen()
          }}
          sx={{ alignSelf: 'flex-center', borderRadius: 2, px: 2.5, mt: 1 }}
        >
          View Details
        </Button>

        <CertificateDetailsModal
          open={modalOpen}
          onClose={(event) => handleModalClose(event)}
          fieldDetails={fields}
          actualData={certificate.decryptedFields || {}}
          certName={certName}
          iconURL={iconURL}
          description={description}
          serialNumber={certificate.serialNumber}
          certificateType={certificate.type}
          documentationURL={documentationURL}
        />

        <Dialog
          open={deleteConfirmOpen}
          onClose={() => handleCloseDeleteConfirm()}
          PaperProps={{ sx: { borderRadius: 3 } }}
        >
          <DialogTitle>Delete certificate?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              Deleting this certificate is permanent and it cannot be recreated.
              Are you sure you want to delete it?
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={(e) => handleCloseDeleteConfirm(e)}>Cancel</Button>
            <Button
              onClick={(e) => {
                e.stopPropagation()
                setDeleteConfirmOpen(false)
                onRelinquish?.(certificate.serialNumber)
              }}
              variant="contained"
              color="error"
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  )
}

const CertificateDetailsModal: React.FC<CertificateDetailsModalProps> = ({
  open,
  onClose,
  fieldDetails,
  actualData,
  certName,
  iconURL,
  description,
  serialNumber,
  certificateType,
  documentationURL
}) => {
  const navigate = useNavigate()
  // Merge the field details with the actual data
  const mergedFields: Record<string, any> = {}

  if (Object.keys(fieldDetails || {}).length > 0) {
    Object.entries(fieldDetails || {}).forEach(([key, fieldDetail]) => {
      if (typeof fieldDetail === 'object') {
        mergedFields[key] = {
          friendlyName: fieldDetail.friendlyName || key,
          description: fieldDetail.description || '',
          type: fieldDetail.type || 'text',
          fieldIcon: fieldDetail.fieldIcon || '',
          value: actualData && key in actualData ? actualData[key] : 'No data available'
        }
      }
    })
  } else if (Object.keys(actualData || {}).length > 0) {
    Object.keys(actualData || {}).forEach(key => {
      mergedFields[key] = {
        friendlyName: key,
        description: '',
        type: 'text',
        fieldIcon: '',
        value: actualData[key]
      }
    })
  }

  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({})
  const copyTimeouts = useRef<Record<string, number>>({})

  const triggerCopied = useCallback((key: string) => {
    if (!key) return
    if (copyTimeouts.current[key]) {
      window.clearTimeout(copyTimeouts.current[key])
    }
    setCopiedMap((prev) => ({ ...prev, [key]: true }))
    copyTimeouts.current[key] = window.setTimeout(() => {
      setCopiedMap((prev) => ({ ...prev, [key]: false }))
      delete copyTimeouts.current[key]
    }, 2000) as any
  }, [])

  const copyValueToClipboard = useCallback((rawValue: unknown, key: string, event?: React.MouseEvent) => {
    event?.stopPropagation()
    if (!key || rawValue === undefined || rawValue === null) {
      return
    }
    const text = typeof rawValue === 'string' ? rawValue : String(rawValue)
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => triggerCopied(key))
        .catch(() => triggerCopied(key))
    } else {
      triggerCopied(key)
    }
  }, [triggerCopied])

  useEffect(() => {
    return () => {
      Object.values(copyTimeouts.current).forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      copyTimeouts.current = {}
    }
  }, [])

  const MetaRow: React.FC<{
    label: React.ReactNode
    value?: React.ReactNode
    dividerBelow?: boolean
  }> = ({ label, value, dividerBelow = false }) => {
    if (!value && value !== 0) return null
    return (
      <>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 1,
            alignItems: { xs: 'flex-start', sm: 'center' },
            justifyContent: 'space-between'
          }}
        >
          <Typography variant="subtitle2" color="text.secondary" sx={{ minWidth: { sm: 160 } }}>
            {label}
          </Typography>
          <Typography
            variant="body2"
            sx={{ flex: 1, wordBreak: 'break-word' }}
            title={typeof value === 'string' ? value : undefined}
          >
            {value}
          </Typography>
        </Box>
        {dividerBelow && <Divider sx={{ my: 1.5 }} />}
      </>
    )
  }

  const CopyableMetaRow: React.FC<{
    label: React.ReactNode
    value?: React.ReactNode
    dividerBelow?: boolean
    copyKey: string
  }> = ({ label, value, dividerBelow = false, copyKey }) => {
    if (!value && value !== 0) return null
    const isCopied = Boolean(copiedMap[copyKey])
    return (
      <>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 1,
            alignItems: { xs: 'flex-start', sm: 'center' },
            justifyContent: 'space-between'
          }}
        >
          <Typography variant="subtitle2" color="text.secondary" sx={{ minWidth: { sm: 160 } }}>
            {label}
          </Typography>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            <Typography
              variant="body2"
              sx={{ wordBreak: 'break-word' }}
              title={typeof value === 'string' ? value : undefined}
            >
              {value}
            </Typography>
            <Tooltip title={isCopied ? 'Copied' : 'Copy'}>
              <span>
                <IconButton
                  size="small"
                  onClick={(e) => copyValueToClipboard(value, copyKey, e)}
                  disabled={isCopied}
                >
                  {isCopied ? <CheckIcon fontSize="inherit" /> : <ContentCopyIcon fontSize="inherit" />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
        {dividerBelow && <Divider sx={{ my: 1.5 }} />}
      </>
    )
  }

  const CT = certificateType ?? actualData?.certType ?? actualData?.type ?? ''

  const handleLearnMoreClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!certificateType) return
    onClose(e)
    navigate(`/dashboard/certificate/${encodeURIComponent(certificateType)}`)
  }

  const infoRows = [
    { key: 'ct', comp: 'copy' as const, label: 'Certificate Type', value: CT, copyKey: 'summary-cert-type' },
    { key: 'serial', comp: 'copy' as const, label: 'Serial Number', value: serialNumber, copyKey: 'summary-serial-number' }
  ].filter(r => r.value !== undefined && r.value !== null && r.value !== '')

  const renderFieldValue = (fieldKey: string, value: any) => {
    if (value?.type === 'imageURL') {
      return (
        <Box
          sx={{
            mt: 1,
            display: 'flex',
            justifyContent: 'flex-start'
          }}
        >
          <Img
            style={{
              width: '5em',
              height: '5em',
              objectFit: 'cover',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.12)'
            }}
            src={value.value}
          />
        </Box>
      )
    }

    if (value?.type === 'other' || typeof value?.value === 'object') {
      return (
        <Box
          sx={{
            mt: 1,
            p: 2,
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04),
            borderRadius: 1.5,
            border: '1px solid',
            borderColor: 'divider'
          }}
        >
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {typeof value?.value === 'object'
              ? JSON.stringify(value.value, null, 2)
              : String(value?.value)}
          </Typography>
        </Box>
      )
    }

    const copyKey = `field-${fieldKey}`
    const isCopied = Boolean(copiedMap[copyKey])
    return (
      <Box
        sx={(theme) => ({
          mt: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          p: 1.5,
          borderRadius: 1.5,
          bgcolor: alpha(theme.palette.primary.main, 0.06)
        })}
      >
        <Typography variant="body2" sx={{ wordBreak: 'break-word', fontWeight: 500 }}>
          {String(value?.value)}
        </Typography>
        <Tooltip title={isCopied ? 'Copied' : 'Copy value'}>
          <span>
            <IconButton
              size="small"
              onClick={(e) => copyValueToClipboard(value?.value, copyKey, e)}
              disabled={isCopied}
            >
              {isCopied ? <CheckIcon fontSize="inherit" /> : <ContentCopyIcon fontSize="inherit" />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      scroll="paper"
      PaperProps={{
        sx: { borderRadius: 3, overflow: 'hidden' }
      }}
    >
      <DialogTitle
        sx={(theme) => ({
          px: 4,
          py: 3,
          textAlign: 'center',
          borderBottom: `1px solid ${theme.palette.divider}`,
          background: alpha(theme.palette.primary.main, 0.04)
        })}
      >
        <Stack spacing={2} alignItems="center">
          <Avatar sx={{ width: 60, height: 60 }}>
            {iconURL ? (
              <Img style={{ width: '100%', height: '100%', objectFit: 'contain' }} src={iconURL} />
            ) : (
              (certName?.[0] ?? 'C').toUpperCase()
            )}
          </Avatar>
          <Box>
            <Typography variant="h5" fontWeight={600}>
              {certName || 'Certificate'}
            </Typography>
            {description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {description}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" justifyContent="center">
            {CT && (
              <Chip size="small" color="primary" variant="outlined" label={`Type • ${CT}`} />
            )}
            {serialNumber && (
              <Chip size="small" variant="outlined" label={`Serial • ${serialNumber}`} />
            )}
          </Stack>
        </Stack>
      </DialogTitle>

      <DialogContent
        dividers
        onClick={(e) => e.stopPropagation()}
        sx={{ cursor: 'default', px: 0 }}
      >
        <Stack spacing={3} sx={{ p: { xs: 2.5, sm: 3.5 } }}>
          {infoRows.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Certificate Summary
              </Typography>
              <Box
                sx={{
                  mt: 1.5,
                  p: { xs: 2, sm: 2.5 },
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: (theme) => alpha(theme.palette.background.default, 0.6)
                }}
              >
                {infoRows.map((row, index) => {
                  const dividerBelow = index < infoRows.length - 1
                  return row.comp === 'copy' ? (
                    <CopyableMetaRow
                      key={row.key}
                      label={row.label}
                      value={row.value}
                      dividerBelow={dividerBelow}
                      copyKey={row.copyKey}
                    />
                  ) : (
                    <MetaRow
                      key={row.key}
                      label={row.label}
                      value={row.value}
                      dividerBelow={dividerBelow}
                    />
                  )
                })}
              </Box>
            </Box>
          )}

          <Box>
            <Typography variant="overline" color="text.secondary">
              Fields
            </Typography>
            {Object.keys(mergedFields).length === 0 ? (
              <Box
                sx={{
                  mt: 1.5,
                  p: { xs: 2, sm: 2.5 },
                  borderRadius: 2,
                  border: '1px dashed',
                  borderColor: 'divider',
                  textAlign: 'center'
                }}
              >
                <Typography variant="body2">
                  No certificate fields are currently available to display.
                </Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  mt: 1.5,
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }
                }}
              >
                {Object.entries(mergedFields).map(([key, value]) => (
                  <Box
                    key={key}
                    sx={(theme) => ({
                      display: 'flex',
                      gap: 2,
                      alignItems: 'flex-start',
                      p: 2.5,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: alpha(theme.palette.primary.main, 0.12),
                      bgcolor: alpha(theme.palette.primary.main, 0.03)
                    })}
                  >
                    {value.fieldIcon ? (
                      <Avatar sx={{ width: 40, height: 40 }}>
                        <Img
                          style={{ width: '75%', height: '75%', objectFit: 'contain' }}
                          src={value.fieldIcon}
                        />
                      </Avatar>
                    ) : (
                      <Avatar sx={{ width: 40, height: 40 }}>
                        {(value.friendlyName?.[0] ?? key?.[0] ?? 'F').toUpperCase()}
                      </Avatar>
                    )}
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {value.friendlyName || key}
                      </Typography>
                      {value.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {value.description}
                        </Typography>
                      )}
                      {renderFieldValue(key, value)}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          py: 2,
          borderTop: (theme) => `1px solid ${theme.palette.divider}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {documentationURL && (
            <Button
              component="a"
              href={documentationURL}
              target="_blank"
              rel="noopener noreferrer"
              color="primary"
              onClick={(e) => e.stopPropagation()}
            >
              View Documentation
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {certificateType && (
            <Button
              onClick={handleLearnMoreClick}
              variant="outlined"
              color="primary"
            >
              Learn More
            </Button>
          )}
          <Button
            onClick={(e) => {
              e.stopPropagation()
              onClose(e)
            }}
            variant="contained"
            color="primary"
          >
            Close
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}

export default CertificateCard
