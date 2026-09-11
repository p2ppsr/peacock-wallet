import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildFeedbackPayload,
  MAX_EMAIL_LENGTH,
  MAX_FEEDBACK_LENGTH,
  submitFeedback,
  USERCOM_FEEDBACK_ENDPOINT
} from './feedback'
import packageJson from '../package.json'

describe('Usercom feedback', () => {
  afterEach(() => vi.restoreAllMocks())

  it('builds a product-scoped payload without hidden wallet data', () => {
    expect(buildFeedbackPayload({
      feedback: '  Please make app permissions easier to scan.  ',
      email: '  person@example.com  '
    })).toEqual({
      type: 'feedback',
      feedback: 'Please make app permissions easier to scan.',
      email: 'person@example.com',
      subject: 'Peacock Wallet feedback',
      source: 'user-wallet',
      surface: 'wallet-feedback',
      tags: ['surface:wallet-feedback', 'intent:peacock-wallet-feedback', 'feedback'],
      context: {
        releaseVersion: packageJson.version,
        feedbackSurface: 'wallet-feedback'
      }
    })
  })

  it('rejects messages outside the documented bounds', () => {
    expect(() => buildFeedbackPayload({ feedback: 'Too short' })).toThrow('at least 10 characters')
    expect(() => buildFeedbackPayload({ feedback: 'x'.repeat(MAX_FEEDBACK_LENGTH + 1) })).toThrow('or fewer')
    expect(buildFeedbackPayload({
      feedback: 'This is valid feedback.',
      email: 'x'.repeat(MAX_EMAIL_LENGTH + 1)
    }).email).toHaveLength(MAX_EMAIL_LENGTH)
  })

  it('posts feedback without credentials or referrer information', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200
    } as Response)

    await submitFeedback({ feedback: 'The Settings layout is much clearer.' })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(USERCOM_FEEDBACK_ENDPOINT, expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    }))
    const options = fetchMock.mock.calls[0][1]
    expect(JSON.parse(String(options?.body))).toMatchObject({
      source: 'user-wallet',
      feedback: 'The Settings layout is much clearer.'
    })
  })
})
