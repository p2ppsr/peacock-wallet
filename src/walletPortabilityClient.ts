import { invoke } from '@tauri-apps/api/core';
import { PortabilityError, type PortabilityErrorCode } from './walletPortability';
import type { PortabilityRequest } from './walletPortability.worker';

export async function runPortabilityWorker<T>(
  request: PortabilityRequest,
  report: (message: string) => void,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) throw new PortabilityError('cancelled');
  return await new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL('./walletPortability.worker.ts', import.meta.url), {
      type: 'module',
    });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      cleanup();
      reject(new PortabilityError('cancelled'));
    };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        report(data.message);
        return;
      }
      cleanup();
      if (data.type === 'error')
        reject(new PortabilityError(data.code as PortabilityErrorCode, data.detail));
      else resolve(data.result as T);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      cleanup();
      reject(new PortabilityError('storage'));
    };
    worker.postMessage(request);
    // The worker owns its structured clone. Do not retain the passphrase here.
    if ('password' in request) request.password = '';
  });
}

/** Binary IPC avoids JSON arrays. Rust owns the chooser and atomic file write. */
export async function saveWalletArchive(bytes: ArrayBuffer, encrypted: boolean): Promise<boolean> {
  return await invoke<boolean>('save_wallet_archive', new Uint8Array(bytes), {
    headers: { 'x-wallet-archive-format': encrypted ? 'brc39' : 'brc38' },
  });
}
