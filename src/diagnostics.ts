import packageJson from '../package.json'
import type { TelemetryConfig, TelemetryEvent } from '@bsv/sdk'

export const DIAGNOSTICS_ENABLED_STORAGE_KEY = 'user-wallet:diagnostics-enabled:v1'
export const DIAGNOSTICS_PREFERENCE_EVENT = 'metanet-diagnostics-preference-changed'

const USERCOM_SIGNALS_ENDPOINT = 'https://usercom.babbage.systems/signals'
const USERCOM_SOURCE = 'user-wallet'
const ANONYMOUS_ID_STORAGE_KEY = 'user-wallet:diagnostics-anonymous-id:v1'
const QUEUE_STORAGE_KEY = 'user-wallet:diagnostics-queue:v1'
const MAX_QUEUE_SIZE = 80
const MAX_BATCH_SIZE = 20
const FLUSH_DELAY_MS = 750
const RETRY_DELAY_MS = 15_000
const REQUEST_TIMEOUT_MS = 4_000

export type DiagnosticSeverity = 'info' | 'warn' | 'error' | 'fatal'

type DiagnosticOptions = {
  surface?: string
  severity?: DiagnosticSeverity
  context?: Record<string, unknown>
}

type UsercomSignal = {
  source: string
  name: string
  surface: string
  anonymousId: string
  sessionId: string
  tags: string[]
  context: Record<string, unknown>
}

type NativeCrashReport = {
  kind?: string
  thread?: string
  file?: string
  line?: number
  column?: number
}

const SENSITIVE_KEY = /(account|address|beef|certificate|cipher|credential|email|header|identity|key|mnemonic|password|payload|phone|private|proof|publickey|raw|recovery|request|response|secret|seed|serial|signature|token|transaction|txid|wallet)/i
const sessionId = createId('session')
let queue: UsercomSignal[] = loadQueue()
let flushTimer: ReturnType<typeof setTimeout> | undefined
let flushInFlight = false
let initialized = false
let activeRequest: AbortController | undefined

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

function createTelemetryTraceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  const part = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
  return `${part()}${part()}${part()}${part()}`
}

function getAnonymousId(): string {
  const store = storage()
  try {
    const existing = store?.getItem(ANONYMOUS_ID_STORAGE_KEY)
    if (existing) return existing
    const next = createId('install')
    store?.setItem(ANONYMOUS_ID_STORAGE_KEY, next)
    return next
  } catch {
    return createId('install')
  }
}

function loadQueue(): UsercomSignal[] {
  const store = storage()
  try {
    const parsed = JSON.parse(store?.getItem(QUEUE_STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE_SIZE) : []
  } catch {
    return []
  }
}

function persistQueue(): void {
  const store = storage()
  try {
    if (queue.length === 0) store?.removeItem(QUEUE_STORAGE_KEY)
    else store?.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)))
  } catch {
    // Diagnostics must never interfere with wallet operation.
  }
}

export function getDiagnosticsEnabled(): boolean {
  try {
    return storage()?.getItem(DIAGNOSTICS_ENABLED_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setDiagnosticsEnabled(enabled: boolean): void {
  try {
    storage()?.setItem(DIAGNOSTICS_ENABLED_STORAGE_KEY, String(enabled))
  } catch {
    // Keep the in-memory preference notification working if storage is unavailable.
  }

  if (!enabled) {
    queue = []
    persistQueue()
    activeRequest?.abort()
    activeRequest = undefined
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = undefined
  } else {
    reportDiagnosticEvent('diagnostics.enabled', {
      surface: 'settings',
      context: { preference: 'enabled' }
    })
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DIAGNOSTICS_PREFERENCE_EVENT, { detail: { enabled } }))
  }
}

function cleanTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

function cleanEventName(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 128)
  return cleaned || 'app.event'
}

function cleanSurface(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 128) || 'app'
}

export function sanitizeDiagnosticText(value: string, maxLength = 500): string {
  return value
    .replace(/([?&][^=\s]+)=([^&#\s]*)/g, '$1=[redacted]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hex]')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,}\b/g, '[encoded]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[user]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[user]')
    .slice(0, maxLength)
}

function cleanValue(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (depth > 3) return '[truncated]'
  if (typeof value === 'string') return sanitizeDiagnosticText(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map(item => cleanValue(item, depth + 1))
      .filter(item => item !== undefined)
  }
  if (typeof value === 'object') {
    return sanitizeDiagnosticContext(value as Record<string, unknown>, depth + 1)
  }
  return sanitizeDiagnosticText(String(value), 200)
}

export function sanitizeDiagnosticContext(
  context: Record<string, unknown>,
  depth = 0
): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [rawKey, rawValue] of Object.entries(context).slice(0, 40)) {
    const key = rawKey.replace(/[^a-zA-Z0-9_.:-]+/g, '_').slice(0, 80)
    if (!key) continue
    const value = SENSITIVE_KEY.test(key) ? '[redacted]' : cleanValue(rawValue, depth)
    if (value !== undefined && value !== null && value !== '') safe[key] = value
  }
  return safe
}

function classifyDiagnosticFailure(message: string): string {
  if (/timeout|timed out/i.test(message)) return 'timeout'
  if (/network|fetch|socket|connection|offline|dns|http/i.test(message)) return 'network'
  if (/abort|cancel/i.test(message)) return 'cancelled'
  if (/permission|denied|unauthor/i.test(message)) return 'permission'
  if (/auth|login|credential|password|mnemonic|recovery|private.?key/i.test(message)) return 'authentication'
  if (/storage|database|sqlite|indexeddb/i.test(message)) return 'storage'
  if (/update|install|download/i.test(message)) return 'updater'
  if (/parse|seriali|json|decode|encode/i.test(message)) return 'data-format'
  if (/config|setting/i.test(message)) return 'configuration'
  return 'unknown'
}

function safeErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(value) ? value : undefined
}

function safeStackFrames(stack: string): string[] {
  return stack
    .split('\n')
    .slice(1)
    .flatMap(line => {
      const match = line.match(/(?:^|[/\\])([^/\\()\s?#]+):(\d+):(\d+)\)?$/)
      if (!match) return []
      return [`${match[1]}:${match[2]}:${match[3]}`]
    })
    .slice(0, 8)
}

function boundedDiagnosticContext(context: Record<string, unknown>): Record<string, unknown> {
  const safe = sanitizeDiagnosticContext(context)
  while (JSON.stringify(safe).length > 7000) {
    const removableKeys = Object.keys(safe).filter(key =>
      !['releaseVersion', 'severity', 'occurredAt', 'truncated'].includes(key)
    )
    const removableKey = removableKeys[removableKeys.length - 1]
    if (!removableKey) break
    delete safe[removableKey]
    safe.truncated = true
  }
  return safe
}

export function describeDiagnosticError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown }
    return sanitizeDiagnosticContext({
      errorName: /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(error.name) ? error.name : 'Error',
      errorCode: safeErrorCode(candidate.code),
      failureClass: classifyDiagnosticFailure(error.message || ''),
      stackFrames: safeStackFrames(error.stack || '')
    })
  }
  return { errorName: 'NonError', failureClass: classifyDiagnosticFailure(String(error || '')) }
}

function diagnosticSeverityForTelemetry(event: Readonly<TelemetryEvent>): DiagnosticSeverity {
  return event.severity === 'debug' ? 'info' : event.severity
}

function numericTelemetryAttribute(
  attributes: Readonly<Record<string, unknown>>,
  key: string
): number | undefined {
  const value = attributes[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringTelemetryAttribute(
  attributes: Readonly<Record<string, unknown>>,
  key: string
): string | undefined {
  const value = attributes[key]
  return typeof value === 'string' ? value : undefined
}

export function walletTelemetryDiagnosticContext(
  event: Readonly<TelemetryEvent>
): Record<string, unknown> {
  const timed = event as TelemetryEvent & {
    type?: unknown
    durationMs?: unknown
    spanStatus?: unknown
  }
  const attributes = event.attributes ?? {}
  return {
    component: event.component,
    correlationId: event.correlationId,
    telemetryType: typeof timed.type === 'string' ? timed.type : undefined,
    telemetryDurationMs: typeof timed.durationMs === 'number' ? timed.durationMs : undefined,
    telemetrySpanStatus: typeof timed.spanStatus === 'string' ? timed.spanStatus : undefined,
    rpcMethod: stringTelemetryAttribute(attributes, 'rpc.method'),
    rpcEncoding: stringTelemetryAttribute(attributes, 'rpc.encoding'),
    rpcOutboundEncoding: stringTelemetryAttribute(attributes, 'rpc.request.encoding'),
    rpcInboundEncoding: stringTelemetryAttribute(attributes, 'rpc.response.encoding'),
    outboundSizeBytes: numericTelemetryAttribute(attributes, 'request.size_bytes'),
    inboundSizeBytes: numericTelemetryAttribute(attributes, 'response.size_bytes'),
    httpMethod: stringTelemetryAttribute(attributes, 'http.request.method'),
    httpStatus: numericTelemetryAttribute(attributes, 'http.response.status_code'),
    telemetryErrorName: event.error?.name,
    telemetryErrorCode: event.error?.code
  }
}

/**
 * Adapts TS Stack's privacy-bounded wallet telemetry to Peacock's anonymous
 * diagnostics pipeline. The diagnostics preference remains authoritative.
 */
export function createWalletTelemetryConfig(): TelemetryConfig {
  return {
    enabled: getDiagnosticsEnabled,
    minimumSeverity: 'info',
    traceIdFactory: createTelemetryTraceId,
    sink: {
      capture: (event: Readonly<TelemetryEvent>) => {
        reportDiagnosticEvent(event.name, {
          surface: 'wallet-toolbox',
          severity: diagnosticSeverityForTelemetry(event),
          context: walletTelemetryDiagnosticContext(event)
        })
      }
    }
  } as unknown as TelemetryConfig
}

function scheduleFlush(delay = FLUSH_DELAY_MS): void {
  if (!getDiagnosticsEnabled() || flushTimer || flushInFlight || queue.length === 0) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    void flushDiagnostics()
  }, delay)
}

export function reportDiagnosticEvent(name: string, options: DiagnosticOptions = {}): void {
  if (!getDiagnosticsEnabled()) return
  const severity = options.severity || 'info'
  const surface = cleanSurface(options.surface || 'app')
  const platform = cleanTag(typeof navigator === 'undefined' ? 'unknown' : navigator.platform || 'unknown')
  const signal: UsercomSignal = {
    source: USERCOM_SOURCE,
    name: cleanEventName(name),
    surface,
    anonymousId: getAnonymousId(),
    sessionId,
    tags: [
      `surface:${cleanTag(surface)}`,
      `severity:${severity}`,
      `platform:${platform || 'unknown'}`,
      `release:${cleanTag(packageJson.version)}`
    ],
    context: boundedDiagnosticContext({
      releaseVersion: packageJson.version,
      severity,
      occurredAt: new Date().toISOString(),
      ...options.context
    })
  }
  queue.push(signal)
  queue = queue.slice(-MAX_QUEUE_SIZE)
  persistQueue()
  scheduleFlush()
}

export function reportDiagnosticError(
  name: string,
  error: unknown,
  options: Omit<DiagnosticOptions, 'severity'> = {}
): void {
  reportDiagnosticEvent(name, {
    ...options,
    severity: 'error',
    context: {
      ...options.context,
      ...describeDiagnosticError(error)
    }
  })
}

export async function flushDiagnostics(): Promise<void> {
  if (!getDiagnosticsEnabled() || flushInFlight || queue.length === 0) return
  flushInFlight = true
  const batch = queue.splice(0, MAX_BATCH_SIZE)
  persistQueue()
  const controller = new AbortController()
  activeRequest = controller
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(USERCOM_SIGNALS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Usercom returned HTTP ${response.status}`)
  } catch {
    if (getDiagnosticsEnabled()) {
      queue = [...batch, ...queue].slice(-MAX_QUEUE_SIZE)
      persistQueue()
    }
  } finally {
    clearTimeout(timeout)
    if (activeRequest === controller) activeRequest = undefined
    flushInFlight = false
    if (queue.length > 0) scheduleFlush(RETRY_DELAY_MS)
  }
}

async function reportPendingNativeCrash(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const crash = await invoke<NativeCrashReport | null>('take_pending_crash_report')
    if (!crash || !getDiagnosticsEnabled()) return
    reportDiagnosticEvent('app.native_crash_detected', {
      surface: 'native-runtime',
      severity: 'fatal',
      context: crash
    })
  } catch {
    // Browser/dev UI builds do not expose Tauri commands.
  }
}

export function initializeDiagnostics(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  window.addEventListener('error', event => {
    reportDiagnosticError('app.uncaught_error', event.error || event.message, {
      surface: 'window'
    })
  })
  window.addEventListener('unhandledrejection', event => {
    reportDiagnosticError('app.unhandled_rejection', event.reason, {
      surface: 'window'
    })
  })
  window.addEventListener('online', () => scheduleFlush(0))

  reportDiagnosticEvent('app.started', {
    surface: 'startup',
    context: { diagnosticsSchema: 1 }
  })
  void reportPendingNativeCrash()
}
