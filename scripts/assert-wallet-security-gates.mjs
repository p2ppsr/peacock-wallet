import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const failures = []

const assertIncludes = (label, text, expected) => {
  if (!text.includes(expected)) failures.push(`${label}: missing ${expected}`)
}

const assertNotMatches = (label, text, pattern) => {
  if (pattern.test(text)) failures.push(`${label}: matched forbidden pattern ${pattern}`)
}

const config = read('src/config.ts')
const origin = read('src/walletBridgeOrigin.ts')
const rustOrigin = read('src-tauri/src/origin.rs')
const walletContext = read('src/WalletContext.tsx')
const onWalletReady = read('src/onWalletReady.ts')
const tauriMain = read('src-tauri/src/main.rs')

assertNotMatches(
  'config admin originator',
  config,
  /ADMIN_ORIGINATOR\s*=\s*['"]admin\.com['"]/
)

assertIncludes(
  'config admin originator',
  config,
  "export { INTERNAL_ADMIN_ORIGINATOR as ADMIN_ORIGINATOR }"
)

assertIncludes('TypeScript reserved legacy origin', origin, "LEGACY_ADMIN_ORIGINATOR = 'admin.com'")
assertIncludes(
  'TypeScript reserved internal origin',
  origin,
  "INTERNAL_ADMIN_ORIGINATOR = 'metanet-client.wallet.internal'"
)
assertIncludes('TypeScript reserved origin rejection', origin, 'assertExternalOriginator')

assertIncludes('Rust reserved legacy origin', rustOrigin, 'LEGACY_ADMIN_ORIGINATOR')
assertIncludes('Rust reserved internal origin', rustOrigin, 'INTERNAL_ADMIN_ORIGINATOR')
assertIncludes('Rust reserved origin rejection', rustOrigin, 'validate_external_originator')

assertIncludes('Tauri QA debug gate', tauriMain, 'cfg!(debug_assertions)')
assertIncludes('Tauri QA env gate', tauriMain, 'USER_WALLET_QA')
assertIncludes('Tauri QA route scope', tauriMain, '"/__wallet-qa/permission-decision"')

assertIncludes('renderer QA dev gate', walletContext, 'if (!import.meta.env.DEV) return undefined')
assertIncludes('read-only inspector route', onWalletReady, "'/__wallet-inspect/permission-baseline'")
assertIncludes('read-only inspector dev gate', onWalletReady, 'if (!import.meta.env.DEV || !inspector)')
assertNotMatches(
  'read-only inspector mutation',
  onWalletReady,
  /__wallet-inspect\/permission-baseline[\s\S]{0,1200}(grantPermission|denyPermission|revokePermission|revokeAllForOriginator)/
)

if (failures.length > 0) {
  console.error('UserWallet security gate check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('UserWallet security gate check passed.')
