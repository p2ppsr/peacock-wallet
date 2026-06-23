#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const baseUrl = process.env.WALLET_BRIDGE_URL ?? 'http://127.0.0.1:3321'
const origin = process.env.WALLET_TEST_ORIGIN ?? 'http://127.0.0.1:7171'
const perRequestMs = Number(process.env.WALLET_QA_REQUEST_TIMEOUT_MS ?? 2500)
const promptUi = process.argv.includes('--prompt-ui')
const promptQa = process.argv.includes('--prompt-qa')
const noPromptDiagnostic = process.argv.includes('--no-prompt-diagnostic')

const checks = []
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function walletRequest(path, body = {}, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), perRequestMs)

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.omitOrigin ? {} : { Origin: origin, Originator: origin })
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const text = await response.text()
    let data
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    return { status: response.status, data, text }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${path} did not respond within ${perRequestMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function walletRequestWaitingForUser(path, body = {}, overallMs = 20000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), overallMs)

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: origin,
        Originator: origin
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const text = await response.text()
    let data
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    return { status: response.status, data, text }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${path} did not resolve after user decision within ${overallMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function check(name, fn) {
  const started = Date.now()
  await fn()
  checks.push({ name, ms: Date.now() - started })
}

async function submitQaPermissionDecision(decision, kind = 'protocol') {
  const result = await walletRequest('/__wallet-qa/permission-decision', {
    kind,
    decision
  })

  assert(result.status === 202, `expected QA decision 202, got ${result.status}: ${result.text}`)
  assert(result.data?.accepted === true, `QA decision was not accepted: ${result.text}`)
}

async function clickPermissionDecision(decision, kind = 'protocol') {
  const buttonName = kind === 'spending'
    ? (decision === 'grant' ? 'Spend' : 'Deny')
    : (decision === 'grant' ? 'Grant Access' : 'Deny')
  const groupName = kind === 'spending' ? 'Spending Request' : 'Protocol Access Request'
  const script = `
tell application "System Events"
  tell process "user-wallet"
    set frontmost to true
    delay 0.2
    click button "${buttonName}" of group "${groupName}" of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window 1
  end tell
end tell
`
  await execFileAsync('osascript', ['-e', script])
}

async function exercisePermissionDecision(decision) {
  const protocolName = `userwallet bridge qa ${decision} ${Date.now()}`
  const pending = walletRequestWaitingForUser('/getPublicKey', {
    protocolID: [1, protocolName],
    keyID: 'qa-public',
    counterparty: 'self',
    seekPermission: true
  })

  await sleep(800)
  if (promptQa) {
    await submitQaPermissionDecision(decision)
  } else {
    await clickPermissionDecision(decision)
  }
  const result = await pending

  if (decision === 'grant') {
    assert(result.status === 200, `expected grant to resolve 200, got ${result.status}: ${result.text}`)
    assert(typeof result.data?.publicKey === 'string', `grant did not return publicKey: ${result.text}`)
    return
  }

  assert(result.status === 400, `expected denial to reject with 400, got ${result.status}: ${result.text}`)
  assert(/denied/i.test(result.data?.message ?? result.text), `denial did not return permission-denied error: ${result.text}`)
}

async function exerciseSpendingPermissionDeny() {
  const pending = walletRequestWaitingForUser('/createAction', {
    description: `userwallet bridge qa spending deny ${Date.now()}`,
    outputs: [
      {
        satoshis: 1,
        lockingScript: '76a914000000000000000000000000000000000000000088ac',
        outputDescription: 'QA spend authorization output'
      }
    ],
    options: {
      randomizeOutputs: false
    }
  })

  await sleep(800)
  if (promptQa) {
    await submitQaPermissionDecision('deny', 'spending')
  } else {
    await clickPermissionDecision('deny', 'spending')
  }
  const result = await pending

  assert(result.status === 400, `expected spending denial to reject with 400, got ${result.status}: ${result.text}`)
  assert(/denied/i.test(result.data?.message ?? result.text), `spending denial did not return permission-denied error: ${result.text}`)
}

try {
  await check('getVersion responds with BRC-100 version', async () => {
    const result = await walletRequest('/getVersion')
    assert(result.status === 200, `expected 200, got ${result.status}: ${result.text}`)
    assert(typeof result.data?.version === 'string', `missing version: ${result.text}`)
  })

  let authenticated = false
  await check('isAuthenticated responds without waiting', async () => {
    const result = await walletRequest('/isAuthenticated')
    assert(result.status === 200, `expected 200, got ${result.status}: ${result.text}`)
    authenticated = result.data?.authenticated === true
    assert(typeof result.data?.authenticated === 'boolean', `missing authenticated boolean: ${result.text}`)
  })

  await check('missing Origin is rejected clearly', async () => {
    const result = await walletRequest('/getVersion', {}, { omitOrigin: true })
    assert(result.status === 400, `expected 400, got ${result.status}: ${result.text}`)
    assert(result.data?.code, `expected structured error code: ${result.text}`)
  })

  await check('unknown wallet path is rejected clearly', async () => {
    const result = await walletRequest('/notARealWalletCall')
    assert(result.status === 404, `expected 404, got ${result.status}: ${result.text}`)
    assert(result.data?.code === 'UNKNOWN_WALLET_PATH', `expected UNKNOWN_WALLET_PATH: ${result.text}`)
  })

  if (noPromptDiagnostic) {
    await check('diagnostic getPublicKey seekPermission=false does not hang', async () => {
      const result = await walletRequest('/getPublicKey', {
        identityKey: true,
        seekPermission: false
      })

      if (authenticated) {
        assert(
          result.status === 200 || result.status === 400,
          `expected authenticated wallet success or clear wallet error, got ${result.status}: ${result.text}`
        )
        if (result.status === 400) {
          assert(
            result.data?.code || result.data?.message,
            `expected structured wallet error payload: ${result.text}`
          )
        }
        return
      }

      assert(result.status === 503, `expected unauthenticated 503, got ${result.status}: ${result.text}`)
      assert(result.data?.code === 'WALLET_NOT_AUTHENTICATED', `expected WALLET_NOT_AUTHENTICATED: ${result.text}`)
    })
  }

  if (promptUi || promptQa) {
    assert(authenticated, 'qa:bridge:prompt requires an authenticated UserWallet session')
    await check('permission prompt grant resolves original request', async () => {
      await exercisePermissionDecision('grant')
    })
    await check('permission prompt deny rejects original request', async () => {
      await exercisePermissionDecision('deny')
    })
    if (promptQa) {
      await check('spending permission prompt deny rejects original request', async () => {
        await exerciseSpendingPermissionDeny()
      })
    }
    await check('bridge health responds after prompt decisions', async () => {
      const result = await walletRequest('/isAuthenticated')
      assert(result.status === 200, `expected 200, got ${result.status}: ${result.text}`)
      assert(result.data?.authenticated === true, `expected authenticated wallet after prompt decisions: ${result.text}`)
    })
  }

  for (const item of checks) {
    console.log(`ok ${item.name} (${item.ms}ms)`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(`Bridge URL: ${baseUrl}`)
  console.error('Start UserWallet with `USER_WALLET_QA=1 npm run tauri dev` before running this live gate.')
  process.exit(1)
}
