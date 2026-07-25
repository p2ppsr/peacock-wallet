import { describe, expect, it } from 'vitest'
import {
  describeDiagnosticError,
  sanitizeDiagnosticContext,
  sanitizeDiagnosticText
} from './diagnostics'

describe('wallet diagnostics privacy boundary', () => {
  it('recursively redacts wallet and secret-shaped context', () => {
    expect(sanitizeDiagnosticContext({
      operation: 'wallet-startup',
      privateKey: 'do-not-send',
      nested: {
        txid: 'abc',
        retryable: true
      }
    })).toEqual({
      operation: 'wallet-startup',
      privateKey: '[redacted]',
      nested: {
        txid: '[redacted]',
        retryable: true
      }
    })
  })

  it('removes encoded identifiers, query values, email addresses, and user paths', () => {
    const text = sanitizeDiagnosticText(
      'failed for 02b4478e0df7197f4b245a269f6b5eb7689cf0213336752a2349d4137cc9d91c7b ' +
      'at https://example.com/path?token=secret for person@example.com /Users/alice/app.ts'
    )
    expect(text).not.toContain('02b4478e')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('person@example.com')
    expect(text).not.toContain('/Users/alice')
  })

  it('keeps bounded error classification without retaining exception text', () => {
    const error = Object.assign(new Error('password secret deadbeefdeadbeefdeadbeefdeadbeef'), {
      code: 'WALLET_INIT_FAILED'
    })
    const result = describeDiagnosticError(error)
    expect(result.errorName).toBe('Error')
    expect(result.errorCode).toBe('WALLET_INIT_FAILED')
    expect(result.failureClass).toBe('authentication')
    expect(result).not.toHaveProperty('message')
    expect(result).not.toHaveProperty('stack')
    expect(JSON.stringify(result)).not.toContain('password secret')
  })
})
