import { describe, expect, it, vi } from 'vitest';
import {
  createStorageConnectionWarmer,
  isOfficialStorageEndpoint,
} from './storageConnectionWarmup';

describe('storage connection warmup', () => {
  it('recognizes only managed HTTPS storage endpoints', () => {
    expect(isOfficialStorageEndpoint('https://storage.babbage.systems')).toBe(true);
    expect(isOfficialStorageEndpoint('https://staging-storage.babbage.systems/rpc')).toBe(true);
    expect(isOfficialStorageEndpoint('http://storage.babbage.systems')).toBe(false);
    expect(isOfficialStorageEndpoint('https://storage.example.com')).toBe(false);
  });

  it('coalesces and throttles bounded health requests', async () => {
    let now = 20_000;
    let resolveFetch: (() => void) | undefined;
    const fetchImpl = vi.fn(
      async () =>
        await new Promise<Response>((resolve) => {
          resolveFetch = () => resolve(new Response('{"status":"ok"}'));
        })
    );
    const reports: Array<Record<string, unknown>> = [];
    const warmer = createStorageConnectionWarmer('https://storage.babbage.systems/rpc', {
      fetch: fetchImpl,
      minIntervalMs: 10_000,
      now: () => now,
      report: (event) => reports.push(event),
    });

    const first = warmer.warm('focus');
    const joined = warmer.warm('visible');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://storage.babbage.systems/healthz',
      expect.objectContaining({ method: 'GET', cache: 'no-store' })
    );

    now += 25;
    resolveFetch?.();
    await expect(Promise.all([first, joined])).resolves.toEqual([true, true]);
    expect(reports).toEqual([
      expect.objectContaining({
        reason: 'focus',
        duration_ms: 25,
        status: 'success',
        http_status: 200,
      }),
    ]);

    now += 5_000;
    await expect(warmer.warm('online')).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not probe user-selected providers', async () => {
    const fetchImpl = vi.fn();
    const warmer = createStorageConnectionWarmer('https://storage.example.com', {
      fetch: fetchImpl,
    });

    await expect(warmer.warm('focus')).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stays disabled after wallet teardown', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const warmer = createStorageConnectionWarmer('https://storage.babbage.systems', {
      fetch: fetchImpl,
    });

    warmer.clear();
    await expect(warmer.warm('create-action')).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports non-success health responses without treating them as warm', async () => {
    const report = vi.fn();
    const warmer = createStorageConnectionWarmer('https://storage.babbage.systems', {
      fetch: vi.fn(async () => new Response('', { status: 503 })),
      report,
    });

    await expect(warmer.warm('create-action')).resolves.toBe(false);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'http_error', http_status: 503 })
    );
  });
});
