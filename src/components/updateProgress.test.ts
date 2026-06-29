import { describe, expect, it } from 'vitest';
import { createDownloadProgressTracker } from './updateProgress';

describe('createDownloadProgressTracker', () => {
  it('accumulates chunk progress against the download content length', () => {
    const track = createDownloadProgressTracker();

    expect(track({ event: 'Started', data: { contentLength: 1000 } })).toBe(0);
    expect(track({ event: 'Progress', data: { chunkLength: 125 } })).toBe(13);
    expect(track({ event: 'Progress', data: { chunkLength: 375 } })).toBe(50);
    expect(track({ event: 'Progress', data: { chunkLength: 500 } })).toBe(100);
  });

  it('uses indeterminate progress when the content length is unavailable', () => {
    const track = createDownloadProgressTracker();

    expect(track({ event: 'Started', data: {} })).toBeNull();
    expect(track({ event: 'Progress', data: { chunkLength: 125 } })).toBeNull();
    expect(track({ event: 'Finished' })).toBe(100);
  });

  it('never returns NaN for invalid progress metadata', () => {
    const track = createDownloadProgressTracker();

    expect(track({ event: 'Started', data: { contentLength: 0 } })).toBeNull();
    const progress = track({ event: 'Progress', data: { chunkLength: 125 } });
    expect(progress).toBeNull();
    expect(Number.isNaN(progress)).toBe(false);
  });
});
