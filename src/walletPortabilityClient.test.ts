import { afterEach, expect, it, vi } from 'vitest';
import { runPortabilityWorker } from './walletPortabilityClient';

afterEach(() => vi.unstubAllGlobals());

it('clears the caller passphrase if worker construction fails', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('unavailable'); } });
  const request = { type: 'export', password: 'synthetic test passphrase' } as any;
  await expect(runPortabilityWorker(request, () => {})).rejects.toMatchObject({ code: 'storage' });
  expect(request.password).toBe('');
});

it('terminates the worker and removes the abort listener after a failed transfer', async () => {
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class {
    terminate = terminate;
    postMessage() { throw new DOMException('Cannot clone', 'DataCloneError'); }
  });
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const request = { type: 'export', password: 'synthetic test passphrase' } as any;
  await expect(runPortabilityWorker(request, () => {}, controller.signal)).rejects.toMatchObject({ code: 'storage' });
  expect(request.password).toBe('');
  expect(terminate).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  controller.abort();
  expect(terminate).toHaveBeenCalledOnce();
});
