import { describe, expect, it } from 'vitest'
import { overflowSafeDialogContentSx } from './index'

describe('CustomDialog overflow containment', () => {
  it('wraps unbroken permission text and lets nested flex content shrink', () => {
    expect(overflowSafeDialogContentSx.overflowWrap).toBe('anywhere')
    expect(overflowSafeDialogContentSx['& .MuiTypography-root']).toMatchObject({
      minWidth: 0,
      maxWidth: '100%',
      overflowWrap: 'anywhere'
    })
    expect(overflowSafeDialogContentSx['& .MuiDialogContent-root, & .MuiDialogActions-root, & .MuiStack-root, & .MuiBox-root']).toMatchObject({
      minWidth: 0,
      maxWidth: '100%'
    })
    expect(overflowSafeDialogContentSx['& .MuiChip-root'].maxWidth).toBe('100%')
  })
})
