import {
  archiveErrorCode,
  PortabilityError,
  encodeArchive,
  summarizeArchive,
  type ArchiveFormat,
  type ArchiveSource,
} from './walletPortability';
import {
  captureArchive,
  prepareArchiveImport,
  prepareArchiveMerge,
  prepareArchiveActivation,
  resumeArchiveImport,
} from './walletPortabilityStore';

export type PortabilityRequest =
  | { operation: 'export'; source: ArchiveSource; format: ArchiveFormat; password: string }
  | { operation: 'import'; file: Blob; fileName: string; password: string }
  | { operation: 'merge'; id: string; source: ArchiveSource; target: string }
  | { operation: 'resume'; id: string; password: string }
  | { operation: 'activate'; id: string };

self.onmessage = async ({ data }: MessageEvent<PortabilityRequest>) => {
  const report = (message: string) => self.postMessage({ type: 'progress', message });
  try {
    if (data.operation === 'export') {
      report('Capturing a consistent snapshot of this device copy…');
      const document = await captureArchive(data.source, report);
      const summary = summarizeArchive(document);
      report(
        data.format === 'brc39'
          ? 'Protecting the file with your passphrase…'
          : 'Preparing the plaintext wallet data file…'
      );
      const bytes = await encodeArchive(document, data.format, data.password);
      data.password = '';
      self.postMessage(
        { type: 'result', result: { bytes: bytes.buffer, summary } },
        { transfer: [bytes.buffer] }
      );
    } else if (data.operation === 'import') {
      const result = await prepareArchiveImport(data.file, data.fileName, data.password, report);
      data.password = '';
      self.postMessage({ type: 'result', result });
    } else if (data.operation === 'merge') {
      const result = await prepareArchiveMerge(data.id, data.source, data.target, report);
      self.postMessage({ type: 'result', result });
    } else if (data.operation === 'resume') {
      const result = await resumeArchiveImport(data.id, data.password, report);
      data.password = '';
      self.postMessage({ type: 'result', result });
    } else {
      self.postMessage({ type: 'result', result: await prepareArchiveActivation(data.id, report) });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      code: archiveErrorCode(error),
      detail: error instanceof PortabilityError ? error.detail : undefined,
    });
  }
};
