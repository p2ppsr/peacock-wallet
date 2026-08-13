export type StorageConnectionWarmupReason = 'create-action' | 'focus' | 'online' | 'visible';

type StorageConnectionWarmupEvent = {
  reason: StorageConnectionWarmupReason;
  duration_ms: number;
  status: 'success' | 'http_error' | 'network_error' | 'timeout';
  timeout_ms: number;
  http_status?: number;
};

type StorageConnectionWarmerOptions = {
  fetch?: typeof fetch;
  minIntervalMs?: number;
  now?: () => number;
  report?: (event: StorageConnectionWarmupEvent) => void;
  timeoutMs?: number;
};

const OFFICIAL_STORAGE_HOSTS = new Set([
  'storage.babbage.systems',
  'staging-storage.babbage.systems',
]);

export function isOfficialStorageEndpoint(endpointUrl: string): boolean {
  try {
    const url = new URL(endpointUrl);
    return url.protocol === 'https:' && OFFICIAL_STORAGE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function createStorageConnectionWarmer(
  endpointUrl: string,
  options: StorageConnectionWarmerOptions = {}
) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const minIntervalMs = options.minIntervalMs ?? 15_000;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 2_500;
  const officialEndpoint = isOfficialStorageEndpoint(endpointUrl);
  const healthUrl = officialEndpoint ? new URL('/healthz', endpointUrl).toString() : '';
  let inFlight: Promise<boolean> | undefined;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let activeController: AbortController | undefined;
  let disabled = false;

  const warm = (reason: StorageConnectionWarmupReason): Promise<boolean> => {
    if (disabled || !officialEndpoint || !fetchImpl) return Promise.resolve(false);
    if (inFlight) return inFlight;

    const startedAt = now();
    if (startedAt - lastAttemptAt < minIntervalMs) return Promise.resolve(false);
    lastAttemptAt = startedAt;

    const controller = new AbortController();
    activeController = controller;
    let didTimeout = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        didTimeout = true;
        controller.abort();
        reject(new Error('Storage connection warmup timed out.'));
      }, timeoutMs);
    });
    let currentWarmup: Promise<boolean>;
    currentWarmup = Promise.race([
      fetchImpl(healthUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }),
      timeout,
    ])
      .then((response) => {
        if (!disabled) {
          options.report?.({
            reason,
            duration_ms: Math.max(0, now() - startedAt),
            status: response.ok ? 'success' : 'http_error',
            timeout_ms: timeoutMs,
            http_status: response.status,
          });
        }
        return response.ok;
      })
      .catch(() => {
        if (!disabled) {
          options.report?.({
            reason,
            duration_ms: Math.max(0, now() - startedAt),
            status: didTimeout ? 'timeout' : 'network_error',
            timeout_ms: timeoutMs,
          });
        }
        return false;
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        if (activeController === controller) activeController = undefined;
        if (inFlight === currentWarmup) inFlight = undefined;
      });
    inFlight = currentWarmup;
    return currentWarmup;
  };

  return {
    warm,
    clear: () => {
      disabled = true;
      activeController?.abort();
      activeController = undefined;
      inFlight = undefined;
    },
  };
}
