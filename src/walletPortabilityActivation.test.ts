import { describe, expect, it } from 'vitest';
import { commitArchiveActivation, recoverArchiveActivation } from './walletPortabilityActivation';
import { localWalletDatabaseName, resolveLocalWalletDatabase } from './walletStorageLocal';
import { loadProfileWalletStorageConfig } from './walletStorageProfiles';
import { summarizeArchive } from './walletPortability';
import { portabilityFixture } from './walletPortabilityFixture';
import type { ArchiveJob } from './walletPortabilityStore';

describe('activation write-ahead recovery', () => {
  for (const failAt of [1, 2, 3, 4, 5])
    it(`recovers safely after write boundary ${failAt}`, async () => {
      const summary = summarizeArchive(portabilityFixture()),
        key = '9'.repeat(64);
      const job: ArchiveJob = {
        id: 'test',
        state: 'activating',
        createdAt: '',
        fileName: 'fixture',
        fileBytes: 1,
        databaseName: 'unused',
        storageIdentityKey: 'unused',
        summary,
        activationDatabaseName: localWalletDatabaseName('test', summary.identityKey, key),
        activationStorageIdentityKey: key,
      };
      const rows = new Map<string, string>();
      let writes = 0,
        fail = true;
      const storage = {
        getItem: (name: string) => rows.get(name) ?? null,
        setItem: (name: string, value: string) => {
          if (fail && ++writes === failAt) throw new Error('Simulated interrupted write');
          rows.set(name, value);
        },
        removeItem: (name: string) => {
          if (fail && ++writes === failAt) throw new Error('Simulated interrupted write');
          rows.delete(name);
        },
      };
      try {
        commitArchiveActivation(storage, job);
      } catch {
        /* Simulate closing the app at this boundary. */
      }
      fail = false;
      recoverArchiveActivation(storage, 'test', summary.identityKey);
      const config = loadProfileWalletStorageConfig(
        storage,
        'test',
        summary.identityKey,
        'https://fixture.example',
        () => '8'.repeat(64)
      );
      if (failAt <= 2) expect(config.primary.kind).toBe('remote');
      else {
        expect(config.primary.kind).toBe('local');
        expect(config.backups).toEqual([]);
        expect(config.localStorageIdentityKey).toBe(key);
        const binding = await resolveLocalWalletDatabase(
          storage,
          'test',
          summary.identityKey,
          key,
          true,
          async () => ({ hasUser: true, chain: 'test', storageIdentityKey: key })
        );
        expect(binding.name).toBe(job.activationDatabaseName);
      }
    });
});
