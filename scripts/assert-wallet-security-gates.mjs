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
const binaryBridge = read('src/binaryBridge.ts')
const rustBinaryBridge = read('src-tauri/src/binary_bridge.rs')
const tauriMain = read('src-tauri/src/main.rs')
const chaintracks = read('src/chaintracks/localChaintracks.ts')
const advancedSettings = read('src/pages/Dashboard/Settings/Advanced.tsx')
const packageJson = JSON.parse(read('package.json'))
const checkpoint = JSON.parse(read('config/chaintracks-checkpoint.json'))

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

assertIncludes('live permission manager inspector', walletContext, 'const permissionsManager = permissionsManagerRef.current')
assertNotMatches(
  'permission manager bridge restart dependency',
  walletContext,
  /managers\.permissionsManager,\s*\n\s*activeProfile/
)
assertIncludes('binary bridge generation registration', binaryBridge, "invoke('register_binary_handler', { generation, channel })")
assertIncludes('binary bridge generation cleanup', binaryBridge, "invoke('clear_binary_handler', { generation })")
assertIncludes('Rust generation-scoped pending request', rustBinaryBridge, 'generation: String')
assertIncludes('Rust generation-scoped cleanup', rustBinaryBridge, 'request.generation != generation')

assertIncludes('wallet chain tracker injection', walletContext, 'chainTracker')
assertIncludes('local persistent ChainTracks', chaintracks, 'createIdbChaintracks')
assertIncludes('remote-only default', chaintracks, "DEFAULT_CHAINTRACKS_MODE: ChaintracksMode = 'remote-only'")
assertIncludes('independent fallback quorum', chaintracks, 'requiredFallbackAgreement: 2')
assertIncludes('consistency quorum', chaintracks, 'requiredConsistencyAgreement: 2')
assertIncludes('automatic recovery', chaintracks, 'autoRecover: true')
assertIncludes('packaged checkpoint cache', chaintracks, 'bulkFileCache')
assertIncludes('bounded bulk downloads', chaintracks, 'bulkFileDownloadBudget')
assertIncludes('advanced local/remote mode', advancedSettings, 'value="local-primary"')
assertIncludes('experimental local label', advancedSettings, 'Local ChainTracks (experimental)')
assertIncludes('recommended remote label', advancedSettings, 'Remote ChainTracks (recommended)')
assertIncludes('advanced header reset', advancedSettings, 'clearLocalData')
if (checkpoint.checkpointHeight !== 899999 || checkpoint.files.length !== 9) {
  failures.push('checkpoint: expected nine immutable files through height 899999')
}
if (!String(packageJson.scripts?.release || '').startsWith('npm run chaintracks:release-gate')) {
  failures.push('release: missing upstream ChainTracks release gate')
}

if (failures.length > 0) {
  console.error('UserWallet security gate check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('UserWallet security gate check passed.')
