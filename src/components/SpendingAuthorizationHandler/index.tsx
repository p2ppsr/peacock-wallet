import { useContext, useState, useEffect } from 'react'
import {
  DialogContent,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Box,
  Stack,
  Typography,
  Tooltip
} from '@mui/material'
import { InfoOutlined } from '@mui/icons-material'
import AmountDisplay from '../AmountDisplay'
import CustomDialog from '../CustomDialog'
import { WalletContext } from '../../WalletContext'
import { Services } from '@bsv/wallet-toolbox-client'
import { UserContext } from '../../UserContext'
import { PermissionHeader, RequestCard, Surface } from '../permissions/PermissionScaffold'

const services = new Services('main')

const SpendingAuthorizationHandler: React.FC = () => {
  const {
    managers, spendingRequests, advanceSpendingQueue
  } = useContext(WalletContext)

  const { spendingAuthorizationModalOpen } = useContext(UserContext)

  const [usdPerBsv, setUsdPerBSV] = useState(35)
  const [showLineItems, setShowLineItems] = useState(false)

  const handleCancel = () => {
    if (spendingRequests.length > 0) {
      managers.permissionsManager!.denyPermission(spendingRequests[0].requestID)
    }
    advanceSpendingQueue()
  }

  const handleGrant = async ({ singular = true, amount }: { singular?: boolean, amount?: number }) => {
    if (spendingRequests.length > 0) {
      managers.permissionsManager!.grantPermission({
        requestID: spendingRequests[0].requestID,
        ephemeral: singular,
        amount
      })
    }
    advanceSpendingQueue()
  }

  // Helper function to figure out the upgrade amount (note: consider moving to utils)
  const determineUpgradeAmount = (previousAmountInSats: any, returnType = 'sats') => {
    let usdAmount
    const previousAmountInUsd = previousAmountInSats * (usdPerBsv / 100000000)

    // The supported spending limits are $5, $10, $20, $50
    if (previousAmountInUsd <= 5) {
      usdAmount = 5
    } else if (previousAmountInUsd <= 10) {
      usdAmount = 10
    } else if (previousAmountInUsd <= 20) {
      usdAmount = 20
    } else {
      usdAmount = 50
    }

    if (returnType === 'sats') {
      return Math.round(usdAmount / (usdPerBsv / 100000000))
    }
    return usdAmount
  }

  useEffect(() => {
    // Fetch exchange rate when we have spending requests
    if (spendingRequests.length > 0) {
      services.getBsvExchangeRate().then(rate => {
        setUsdPerBSV(rate)
      })
    }
  }, [spendingRequests])

  if (spendingRequests.length === 0) {
    return null
  }

  // Get the current permission request
  const currentPerm = spendingRequests[0]

  // Determine the type of request
  const isSpendingLimitIncrease = currentPerm.description === 'Increase spending limit'
  const isCreateSpendingLimit = currentPerm.description === 'Create a spending limit'

  // Determine dialog title
  const getDialogTitle = () => {
    if (isSpendingLimitIncrease) {
      return 'Spending Limit Increase'
    }
    if (isCreateSpendingLimit) {
      return 'Set Spending Limit'
    }
    return !currentPerm.renewal ? 'Spending Request' : 'Spending Check-in'
  }

  return (
    <CustomDialog
      open={spendingAuthorizationModalOpen}
      title="Permission needed"
    >
      <DialogContent sx={{ pt: 0 }}>
        <Stack spacing={2}>
          <PermissionHeader
            appDomain={currentPerm.originator}
            contextLine="wants to spend from your wallet"
          />

          <RequestCard
            title={getDialogTitle()}
            body={currentPerm.description || 'The app is asking to spend your funds. Decide if that is expected.'}
          />

          {isSpendingLimitIncrease ? (
            <Surface>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                New monthly limit requested
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, color: 'secondary.main' }}>
                <AmountDisplay showFiatAsInteger>
                  {currentPerm.authorizationAmount}
                </AmountDisplay>
                /month
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                This replaces the previous limit for this app.
              </Typography>
            </Surface>
          ) : isCreateSpendingLimit ? (
            <Surface>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                Set a spending limit
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, color: 'primary.main' }}>
                <AmountDisplay showFiatAsInteger>
                  {currentPerm.authorizationAmount}
                </AmountDisplay>
                /month
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                The app can spend up to this amount each month without prompting you.
              </Typography>
            </Surface>
          ) : (
            <Surface>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                Requested this time
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, color: 'secondary.main' }}>
                <AmountDisplay>
                  {currentPerm.lineItems.reduce(
                    (sum, item) => sum + item.satoshis,
                    0
                  )}
                </AmountDisplay>
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                You can approve once or set a higher auto-approve limit below.
              </Typography>
              {currentPerm.lineItems.length > 0 && (
                <>
                  <Button
                    size="small"
                    onClick={() => setShowLineItems(!showLineItems)}
                    aria-label={showLineItems ? 'Hide spending details' : 'Show spending details'}
                    data-testid="spending-prompt-toggle-details"
                    data-proofrun="spending-prompt-toggle-details"
                    sx={{
                      fontSize: '0.75rem',
                      textTransform: 'none',
                      color: 'text.secondary',
                      mt: 1
                    }}
                  >
                    {showLineItems ? 'Hide details' : 'See itemized spend'}
                  </Button>

                  {showLineItems && (
                    <TableContainer
                      component={Paper}
                      sx={{
                        overflow: 'hidden',
                        mt: 2,
                        width: '100%'
                      }}
                    >
                      <Table
                        sx={{
                          width: '100%',
                          '& th, & td': {
                            px: 3,
                            py: 1.5
                          }
                        }}
                        aria-label='spending details table'
                        size='medium'
                      >
                        <TableHead>
                          <TableRow
                            sx={{
                              color: 'text.primary',
                              '& th': {
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                color: 'text.primary',
                                letterSpacing: '0.01em',
                                borderBottom: '1px solid',
                                borderColor: 'primary.light',
                              }
                            }}
                          >
                            <TableCell>Description</TableCell>
                            <TableCell align='right'>Amount</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {currentPerm.lineItems.map((item, idx) => (
                            <TableRow
                              key={`item-${idx}-${item.description || 'unnamed'}`}
                              sx={{
                                '&:last-child td, &:last-child th': {
                                  border: 0
                                },
                                '&:nth-of-type(odd)': {
                                  bgcolor: 'background.default'
                                },
                                transition: 'background-color 0.2s ease',
                                '&:hover': {
                                  bgcolor: 'action.hover',
                                }
                              }}
                            >
                              <TableCell
                                component='th'
                                scope='row'
                                sx={{
                                  fontWeight: 500,
                                  color: 'text.primary'
                                }}
                              >
                                {item.description || '—'}
                              </TableCell>
                              <TableCell
                                align='right'
                                sx={{
                                  fontWeight: 600,
                                  color: 'secondary.main'
                                }}
                              >
                                <AmountDisplay>
                                  {item.satoshis}
                                </AmountDisplay>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </>
              )}
            </Surface>
          )}
        </Stack>

        <Box sx={{
          display: 'flex',
          justifyContent: 'space-between',
          mt: 3,
          px: 2
        }}>
          <Button
            variant="text"
            color="inherit"
            onClick={handleCancel}
            aria-label="Deny spending request"
            data-testid="spending-prompt-deny"
            data-proofrun="spending-prompt-deny"
            sx={{
              height: '40px'
            }}
          >
            No, keep blocked
          </Button>

          {isSpendingLimitIncrease ? (
            // Simple approve button for spending limit increases
            <Button
              variant="contained"
              color="primary"
              onClick={() => handleGrant({ singular: false, amount: currentPerm.authorizationAmount })}
              aria-label="Approve spending limit increase"
              data-testid="spending-prompt-approve-increase"
              data-proofrun="spending-prompt-approve-increase"
              sx={{
                minWidth: '120px',
                height: '40px'
              }}
            >
              Approve increase
            </Button>
          ) : isCreateSpendingLimit ? (
            // Simple approve button for creating spending limits
            <Button
              variant="contained"
              color="primary"
              onClick={() => handleGrant({ singular: false, amount: currentPerm.authorizationAmount })}
              aria-label="Set spending limit"
              data-testid="spending-prompt-set-limit"
              data-proofrun="spending-prompt-set-limit"
              sx={{
                minWidth: '120px',
                height: '40px'
              }}
            >
              Set limit
            </Button>
          ) : (
            // Original buttons for regular spending requests
            <>
              <Tooltip
                title="Auto-approve future payments in this app up to this limit. You can revoke anytime."
                arrow
                placement="top"
              >
                <Button
                  variant="outlined"
                  color="warning"
                  onClick={() => handleGrant({ singular: false, amount: determineUpgradeAmount(currentPerm.amountPreviouslyAuthorized) })}
                  aria-label="Allow future spending up to this limit"
                  data-testid="spending-prompt-allow-up-to"
                  data-proofrun="spending-prompt-allow-up-to"
                  sx={{
                    minWidth: '120px',
                    height: '40px',
                    gap: 0.5
                  }}
                  endIcon={<InfoOutlined sx={{ fontSize: '16px !important' }} />}
                >
                  Allow up to &nbsp;<AmountDisplay showFiatAsInteger>{determineUpgradeAmount(currentPerm.amountPreviouslyAuthorized)}</AmountDisplay>
                </Button>
              </Tooltip>

              <Button
                  variant="contained"
                  color="success"
                  onClick={() => handleGrant({ singular: true })}
                  aria-label="Approve this spend"
                  data-testid="spending-prompt-spend"
                  data-proofrun="spending-prompt-spend"
                  sx={{
                    height: '40px'
                  }}
                >
                  Allow once
                </Button>
            </>
          )}
        </Box>
      </DialogContent>
    </CustomDialog>
  )
}

export default SpendingAuthorizationHandler
