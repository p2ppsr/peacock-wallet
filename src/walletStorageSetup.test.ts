import { expect, it, vi } from 'vitest'
import { prepareWalletBackupSetup, validateWalletStorageCapabilities } from './walletStorageSetup'
import { createDefaultWalletStorageConfig } from './walletStorageConfig'

const config = () => createDefaultWalletStorageConfig('https://primary.example.com', () => '1'.repeat(64))
const target = { kind: 'remote', url: 'https://backup.example.com' } as const

it.each(['timeout', 'network', 'protocol'])('does not write pending state when %s preflight fails', async failure => {
  const save = vi.fn()
  const discover = async () => {
    if (failure === 'timeout') throw new Error('Timed out waiting for authenticated response.')
    validateWalletStorageCapabilities({ chain: failure === 'network' ? 'test' : 'main', storageIdentityKey: '1'.repeat(64), syncCheckpointVersion: failure === 'protocol' ? 2 : 1 }, 'main')
  }
  await expect(prepareWalletBackupSetup(config(), target, discover, save, () => 'id')).rejects.toThrow()
  expect(save).not.toHaveBeenCalled()
})

it('journals only after successful discovery and preserves the same journal on resume', async () => {
  const order: string[] = []
  const discover = async () => { order.push('discovered'); return 'provider' }
  const save = vi.fn(next => { order.push('journaled'); return next })
  const result = await prepareWalletBackupSetup(config(), target, discover, save, () => 'id')
  expect(order).toEqual(['discovered', 'journaled'])
  expect(result.attached).toBe('provider')
  const resume = await prepareWalletBackupSetup(result.pendingConfig, target, discover, save, () => 'different-id')
  expect(resume.pendingConfig.pendingOperation?.id).toBe('id')
  expect(save).toHaveBeenCalledTimes(1)
})

const transfer = { version: 1, maxBytes: 64 * 1024 * 1024, partBytes: 256 * 1024, inlineBytes: 6 * 1024 * 1024 }
it.each([
  { version: 2 }, { maxBytes: 64 * 1024 * 1024 + 1 },
  { partBytes: 256 * 1024 + 1 }, { inlineBytes: 64 * 1024 * 1024 + 1 }
])('rejects incompatible transfer capabilities before saving a setup journal: %j', async invalid => {
  const save = vi.fn()
  await expect(prepareWalletBackupSetup(config(), target, async () => {
    validateWalletStorageCapabilities({ chain: 'main', storageIdentityKey: '1'.repeat(64), syncTransfer: { ...transfer, ...invalid } }, 'main')
  }, save, () => 'id')).rejects.toThrow('unsupported large-record backup protocol')
  expect(save).not.toHaveBeenCalled()
})

it('accepts legacy providers and supported transfer capabilities without inferring unlimited record support', () => {
  const settings = { chain: 'main', storageIdentityKey: '1'.repeat(64) }
  expect(() => validateWalletStorageCapabilities(settings, 'main')).not.toThrow()
  expect(() => validateWalletStorageCapabilities({ ...settings, syncTransfer: transfer }, 'main')).not.toThrow()
})
