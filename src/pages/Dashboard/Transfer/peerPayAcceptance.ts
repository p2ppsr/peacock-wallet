export const PEER_PAY_ACCEPTANCE_ERROR_MESSAGE =
  'Unable to receive this payment. It may be malformed or incomplete.'

export const assertPeerPayAcceptanceSucceeded = (result: unknown): void => {
  if (typeof result === 'string') {
    throw new Error(result || 'PeerPay did not accept the payment')
  }
  if (result == null || typeof result !== 'object') {
    throw new Error('PeerPay did not confirm that the payment was accepted')
  }
}
