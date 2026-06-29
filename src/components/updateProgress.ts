import type { DownloadEvent } from '@tauri-apps/plugin-updater';

export type DownloadProgressPercent = number | null;

const clampProgressPercent = (value: number): number => Math.min(100, Math.max(0, value));

export const createDownloadProgressTracker = () => {
  let contentLength: number | null = null;
  let downloadedBytes = 0;

  return (event: DownloadEvent): DownloadProgressPercent => {
    switch (event.event) {
      case 'Started':
        downloadedBytes = 0;
        contentLength = Number.isFinite(event.data.contentLength) && event.data.contentLength > 0
          ? event.data.contentLength
          : null;
        return contentLength === null ? null : 0;
      case 'Progress':
        if (Number.isFinite(event.data.chunkLength) && event.data.chunkLength > 0) {
          downloadedBytes += event.data.chunkLength;
        }
        if (contentLength === null) {
          return null;
        }
        return clampProgressPercent(Math.round((downloadedBytes / contentLength) * 100));
      case 'Finished':
        return 100;
      default:
        return null;
    }
  };
};
