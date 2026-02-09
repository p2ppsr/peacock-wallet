import { useContext, useEffect, useMemo, useState } from 'react'
import {
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Divider,
  Box,
  Stack,
  Tooltip,
  Checkbox,
  FormControlLabel
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CustomDialog from '../CustomDialog'
import AppChip from '../AppChip'
import CounterpartyChip from '../CounterpartyChip'
import ProtoChip from '../ProtoChip'
import deterministicColor from '../../utils/deterministicColor'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'

const CounterpartyPermissionHandler = () => {
  const { counterpartyPermissionRequests, advanceCounterpartyPermissionQueue, managers } = useContext(WalletContext)
  const { counterpartyPermissionModalOpen } = useContext(UserContext)

  const currentRequest = counterpartyPermissionRequests[0]

  const protocolKey = (p: any) => `${p?.protocolID?.[0] ?? ''}|${p?.protocolID?.[1] ?? ''}`
  const [checkedProtocolKeys, setCheckedProtocolKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!currentRequest?.permissions?.protocols?.length) {
      setCheckedProtocolKeys(new Set())
      return
    }
    setCheckedProtocolKeys(new Set(currentRequest.permissions.protocols.map(protocolKey)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRequest?.requestID])

  const protocolItems = useMemo(() => {
    if (!currentRequest?.permissions?.protocols?.length) return []
    return currentRequest.permissions.protocols
  }, [currentRequest])

  const handleDeny = async () => {
    if (currentRequest?.requestID) {
      try {
        await (managers.permissionsManager as any)?.denyCounterpartyPermission?.(currentRequest.requestID)
      } catch (e) {
        console.error('Error denying counterparty permissions:', e)
      }
    }
    advanceCounterpartyPermissionQueue()
  }

  const handleGrant = async () => {
    if (currentRequest?.requestID) {
      try {
        const selectedProtocols = (currentRequest.permissions?.protocols || []).filter(p => checkedProtocolKeys.has(protocolKey(p)))
        await (managers.permissionsManager as any)?.grantCounterpartyPermission?.({
          requestID: currentRequest.requestID,
          granted: {
            protocols: selectedProtocols
          },
          expiry: 0
        })

        try {
          const { originator, counterparty } = currentRequest
          const normOriginator = originator ? originator.replace(/^https?:\/\//, '') : originator
          window.dispatchEvent(new CustomEvent('protocol-permissions-changed', {
            detail: {
              op: 'grant-counterparty',
              originator: normOriginator,
              counterparty
            }
          }))
        } catch {
        }
      } catch (e) {
        console.error('Error granting counterparty permissions:', e)
      }
    }
    advanceCounterpartyPermissionQueue()
  }

  if (!counterpartyPermissionModalOpen || !currentRequest) return null

  const { originator, counterparty, counterpartyLabel } = currentRequest

  return (
    <CustomDialog
      open={counterpartyPermissionModalOpen}
      title="Trust This Person?"
      onClose={handleDeny}
    >
      <DialogContent>
        <Stack spacing={2}>
          <Stack spacing={1} alignItems="center">
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" flexWrap="wrap">
              <Box sx={{ opacity: 0.9 }}>
                <AppChip size={1.7} showDomain label={originator || 'unknown'} clickable={false} />
              </Box>
              <CounterpartyChip counterparty={counterparty} label={counterpartyLabel || 'Counterparty'} layout="compact" clickable={false} />
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              You are about to trust this counterparty for specific Level 2 protocols when using this app.
            </Typography>
          </Stack>

          <Divider />

          <Typography variant="body1" sx={{ lineHeight: 1.6 }}>
            Select which protocol capabilities you want to allow for this person.
          </Typography>

          {Array.isArray(protocolItems) && protocolItems.length > 0 && (
            <Stack spacing={1}>
              {protocolItems.map((p, i) => (
                <FormControlLabel
                  key={i}
                  control={
                    <Checkbox
                      checked={checkedProtocolKeys.has(protocolKey(p))}
                      onChange={(e) => {
                        const key = protocolKey(p)
                        setCheckedProtocolKeys(prev => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(key)
                          else next.delete(key)
                          return next
                        })
                      }}
                    />
                  }
                  label={
                    <Stack spacing={0.5} sx={{ py: 0.5 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <CheckCircleOutlineIcon color="primary" fontSize="small" />
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {p.description || p.protocolID?.[1] || 'Protocol access'}
                        </Typography>
                      </Stack>
                      {Array.isArray(p.protocolID) && p.protocolID.length > 1 && (
                        <ProtoChip
                          securityLevel={p.protocolID[0]}
                          protocolID={p.protocolID[1]}
                          counterparty={counterparty}
                          originator={originator}
                          clickable={false}
                          canRevoke={false}
                          layout="compact"
                        />
                      )}
                    </Stack>
                  }
                  sx={{ alignItems: 'flex-start', m: 0 }}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </DialogContent>

      <Tooltip title="Unique visual signature for this request" placement="top">
        <Box sx={{ mb: 3, py: 0.5, background: deterministicColor(JSON.stringify(currentRequest)) }} />
      </Tooltip>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button onClick={handleDeny} variant="outlined" color="inherit">
          Deny
        </Button>
        <Button onClick={handleGrant} variant="contained" color="primary">
          Allow Selected
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default CounterpartyPermissionHandler
