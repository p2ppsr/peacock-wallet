import packageJson from '../package.json'

export const USERCOM_FEEDBACK_ENDPOINT = 'https://usercom.babbage.systems/submit'
export const MIN_FEEDBACK_LENGTH = 10
export const MAX_FEEDBACK_LENGTH = 4_000
export const MAX_EMAIL_LENGTH = 320

export type FeedbackPayload = {
  type: 'feedback'
  feedback: string
  email?: string
  subject: string
  source: 'user-wallet'
  surface: 'wallet-feedback'
  tags: string[]
  context: {
    releaseVersion: string
    feedbackSurface: 'wallet-feedback'
  }
}

export function buildFeedbackPayload(input: { feedback: string; email?: string }): FeedbackPayload {
  const feedback = input.feedback.trim()
  const email = input.email?.trim().slice(0, MAX_EMAIL_LENGTH)

  if (feedback.length < MIN_FEEDBACK_LENGTH) {
    throw new Error(`Feedback must be at least ${MIN_FEEDBACK_LENGTH} characters.`)
  }
  if (feedback.length > MAX_FEEDBACK_LENGTH) {
    throw new Error(`Feedback must be ${MAX_FEEDBACK_LENGTH.toLocaleString()} characters or fewer.`)
  }

  return {
    type: 'feedback',
    feedback,
    ...(email ? { email } : {}),
    subject: 'Peacock Wallet feedback',
    source: 'user-wallet',
    surface: 'wallet-feedback',
    tags: ['surface:wallet-feedback', 'intent:peacock-wallet-feedback', 'feedback'],
    context: {
      releaseVersion: packageJson.version,
      feedbackSurface: 'wallet-feedback'
    }
  }
}

export async function submitFeedback(input: { feedback: string; email?: string }): Promise<void> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000)

  try {
    const response = await fetch(USERCOM_FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildFeedbackPayload(input)),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    })

    if (!response.ok) {
      const body = await response.json().catch((): undefined => undefined) as { description?: unknown } | undefined
      const description = typeof body?.description === 'string' ? body.description : undefined
      throw new Error(description || `Usercom returned HTTP ${response.status}.`)
    }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}
