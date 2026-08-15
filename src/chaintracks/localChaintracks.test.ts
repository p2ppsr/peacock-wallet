import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CHAINTRACKS_MODE,
  localChaintracksManager,
  resolveChaintracksMode
} from './localChaintracks'

describe('ChainTracks mode defaults', () => {
  it('uses remote ChainTracks when no preference has been stored', () => {
    expect(DEFAULT_CHAINTRACKS_MODE).toBe('remote-only')
    expect(resolveChaintracksMode(null)).toBe('remote-only')
    expect(localChaintracksManager.getSnapshot()).toMatchObject({
      mode: 'remote-only',
      activeSource: 'remote-fallback'
    })
  })

  it('preserves an explicit opt-in to experimental local ChainTracks', () => {
    expect(resolveChaintracksMode('local-primary')).toBe('local-primary')
  })

  it('fails safe to remote ChainTracks for unknown stored values', () => {
    expect(resolveChaintracksMode('unexpected-mode')).toBe('remote-only')
  })
})
