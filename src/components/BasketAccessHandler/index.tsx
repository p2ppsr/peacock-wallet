import { useContext } from 'react'
import { DialogContent, DialogActions, Button, Typography, Stack } from '@mui/material'
import CustomDialog from '../CustomDialog'
import ShoppingBasketIcon from '@mui/icons-material/ShoppingBasket'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'
import { InfoRow, PermissionHeader, RequestCard, Surface } from '../permissions/PermissionScaffold'
import { useEffect, useMemo, useState } from 'react'
import { getRegistryClient } from '../../utils/clientFactories'


const BasketAccessHandler = () => {
    const { basketRequests, advanceBasketQueue, managers, settings, network } = useContext(WalletContext)
    const { basketAccessModalOpen } = useContext(UserContext)
    const [basketName, setBasketName] = useState<string | null>(null)

    const currentRequest = basketRequests[0]

    const registry = useMemo(
        () => getRegistryClient(managers?.permissionsManager, { networkPreset: network }),
        [managers?.permissionsManager, network]
    )

    useEffect(() => {
        let cancelled = false
        const resolveBasket = async () => {
            if (!registry || !settings?.trustSettings || !currentRequest?.basket) return
            try {
                const trusted = settings.trustSettings.trustedCertifiers.map(x => x.identityKey)
                const results = await registry.resolve('basket', {
                    basketID: currentRequest.basket,
                    registryOperators: trusted
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
                const chosen = results[idx]
                if (!cancelled && chosen?.name) {
                    setBasketName(chosen.name)
                }
            } catch (err) {
                if (!cancelled) {
                    console.warn('Failed to resolve basket metadata', err)
                }
            }
        }
        resolveBasket()
        return () => { cancelled = true }
    }, [registry, settings?.trustSettings, currentRequest])

    // Handle denying the top request in the queue
    const handleDeny = async () => {
        if (basketRequests.length > 0) {
            managers.permissionsManager?.denyPermission(basketRequests[0].requestID)
        }
        advanceBasketQueue()
    }

    // Handle granting the top request in the queue
    const handleGrant = async () => {
        if (basketRequests.length > 0) {
            managers.permissionsManager?.grantPermission({
                requestID: basketRequests[0].requestID
            })
        }
        advanceBasketQueue()
    }

    if (!basketAccessModalOpen || !currentRequest) return null

    const { basket, originator, reason, renewal } = currentRequest

    if (!basket) {
        console.warn('Basket access request is missing a basket identifier', basketRequests[0])
        return null
    }

    const displayReason = reason && reason !== 'listOutputs' ? reason : undefined
    const friendlyReason = displayReason || 'Let this app view this basket and its contents.'

    return (
        <CustomDialog
            open={basketAccessModalOpen}
            title="Permission needed"
            onClose={handleDeny} // If the user closes via the X, treat as "deny"
            icon={<ShoppingBasketIcon fontSize="medium" />}
        >
            <DialogContent sx={{ pt: 0 }}>
                <Stack spacing={2}>
                    <PermissionHeader
                        appDomain={originator || 'Unknown app'}
                        contextLine="wants to open one of your baskets"
                        gradient="linear-gradient(135deg, #4f8cff 0%, #7b5bff 45%, #ff9f4d 100%)"
                    />

                    <RequestCard
                        title={renewal ? 'Renew basket access' : 'Allow access to a basket'}
                        body={friendlyReason}
                    />

                    <Surface>
                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                            What this allows
                        </Typography>
                        <Stack spacing={1}>
                            <InfoRow label="Basket" value={basketName || basket} />
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
                            This popped up because <strong>{originator || 'an app'}</strong> tried to read or write to basket <strong>{basket}</strong>. Approve only if you trust the app with that data.
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
                >
                    Allow this app
                </Button>
            </DialogActions>
        </CustomDialog>
    )
}

export default BasketAccessHandler
