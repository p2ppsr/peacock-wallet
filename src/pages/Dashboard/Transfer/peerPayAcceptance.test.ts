import { describe, expect, it } from 'vitest'
import { assertPeerPayAcceptanceSucceeded } from './peerPayAcceptance'

describe('PeerPay acceptance result', () => {
  it('accepts a confirmed payment result', () => {
    expect(() => assertPeerPayAcceptanceSucceeded({ paymentResult: {} })).not.toThrow()
  })

  it('treats the PeerPay error string as a failure', () => {
    expect(() => assertPeerPayAcceptanceSucceeded('Unable to receive payment!')).toThrow(
      'Unable to receive payment!'
    )
  })

  it('rejects a missing acceptance result', () => {
    expect(() => assertPeerPayAcceptanceSucceeded(undefined)).toThrow(
      'PeerPay did not confirm that the payment was accepted'
    )
  })
})
