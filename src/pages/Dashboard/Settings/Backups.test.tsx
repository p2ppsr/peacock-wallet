import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { BackupSettingsView, type BackupSettingsProps } from './Backups';
import BackupActivity from '../../../components/WalletBackups/BackupActivity';

vi.mock('../../../WalletContext', async () => {
  const { createContext } = await import('react');
  return { WalletContext: createContext({}) };
});

function props(): BackupSettingsProps {
  return {
    network: 'mainnet',
    storageConfig: {
      revision: 1,
      primary: { kind: 'remote', url: 'https://storage.example.com' },
      backups: [],
      localStorageIdentityKey: 'synthetic',
      lastSuccessfulSyncAt: {},
      updatedAt: '2026-01-01T00:00:00Z',
    },
    storageProviders: [
      {
        role: 'primary',
        target: { kind: 'remote', url: 'https://storage.example.com' },
        state: 'active',
      },
    ],
    storageOperation: { busy: false, progress: [] },
    addBackupStorage: vi.fn(),
    removeBackupStorage: vi.fn(),
    setPrimaryStorage: vi.fn(),
    syncBackupStorage: vi.fn(),
    cancelStorageOperation: vi.fn(),
    cancelBackupSetup: vi.fn(),
  };
}
const render = (data: BackupSettingsProps) =>
  renderToStaticMarkup(
    <StaticRouter location="/dashboard/settings/backups">
      <BackupSettingsView {...data} />
    </StaticRouter>
  );

describe('backup page safety and accessible structure', () => {
  it('offers a device copy without exposing delete or primary-switch shortcuts', () => {
    const data = props();
    const html = render(data);
    expect(html).toContain('Keep a copy on this device');
    expect(html).toMatch(/<h1[^>]*>Backups<\/h1>/);
    expect(html).toContain('A data backup does not replace your recovery key');
    expect(html).not.toContain('>Disconnect backup<');
    expect(html).not.toContain('>Change main location<');
    expect(data.addBackupStorage).not.toHaveBeenCalled();
    expect(data.setPrimaryStorage).not.toHaveBeenCalled();
    expect(data.removeBackupStorage).not.toHaveBeenCalled();
  });
  it('names management controls and never offers another device copy when one is configured', () => {
    const data = props();
    data.storageConfig.backups = [{ kind: 'local' }];
    data.storageProviders.push({ role: 'backup', target: { kind: 'local' }, state: 'backup' });
    const html = render(data);
    expect(html).toContain('aria-label="Manage backup on This device"');
    expect(html).toContain('First backup not finished');
    expect(html).not.toContain('>Keep a copy on this device<');
    expect(html).not.toContain('>Backup saved<');
  });
  it('provides a specific resume action for interrupted setup instead of starting another backup', () => {
    const data = props();
    data.storageConfig.pendingOperation = {
      id: 'test-operation',
      kind: 'add-backup',
      target: { kind: 'local' },
      startedAt: '2026-01-01T00:00:00Z',
    };
    const html = render(data);
    expect(html).toContain('Resume setup');
    expect(html).toContain('Cancel setup');
    expect(html).toContain('saved checkpoints');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Keep a copy on this device/);
    expect(data.addBackupStorage).not.toHaveBeenCalled();
  });
  it('identifies a failed remote and offers recovery while keeping setup actions locked', () => {
    const data = props();
    data.storageConfig.pendingOperation = {
      id: 'synthetic', kind: 'add-backup', target: { kind: 'remote', url: 'https://backup.example.com' },
      startedAt: '2026-01-01T00:00:00Z',
    };
    data.storageOperation = {
      busy: false, kind: 'add-backup', startedAt: 1, progress: [], error: 'synthetic timeout',
      providerFailure: { target: data.storageConfig.pendingOperation.target, method: 'processSyncChunk', timedOut: true },
    };
    const html = render(data);
    expect(html).toContain('Setup for backup.example.com did not finish');
    expect(html).toContain('Completed pages stay saved');
    expect(html).toContain('Cancel setup');
    expect(html).toContain('Resume setup');
    expect(data.cancelBackupSetup).not.toHaveBeenCalled();
  });
  it('shows active setup progress without calling the running copy interrupted', () => {
    const data = props();
    data.storageConfig.pendingOperation = {
      id: 'active-setup', kind: 'add-backup', target: { kind: 'local' },
      startedAt: '2026-01-01T00:00:00Z',
    };
    data.storageOperation = { busy: true, kind: 'add-backup', startedAt: 1, progress: [] };
    const html = render(data);
    expect(html).toContain('Saving your wallet backup');
    expect(html).toContain('Stop this sync');
    expect(html).toContain('Wallet reads and writes may wait until this copy finishes');
    expect(html).toContain('Record sizes vary');
    expect(html).not.toContain('min remaining');
    expect(html).not.toContain('An interrupted setup needs to finish');
    expect(html).not.toContain('Resume setup');
    expect(html).not.toContain('Cancel setup');
  });
  it('explains a source upgrade failure during device backup without blaming the device', () => {
    const html = renderToStaticMarkup(<BackupActivity operation={{
      busy: false, kind: 'add-backup', startedAt: 1, progress: [], error: 'synthetic size failure',
      providerFailure: { target: { kind: 'remote', url: 'https://source.example.com' },
        method: 'getSyncChunk', timedOut: false, sourceUpgradeRequired: true },
    }} onStop={vi.fn()} />);
    expect(html).toContain('source.example.com');
    expect(html).toContain('source provider needs an upgrade');
    expect(html).toContain('then resume setup');
    expect(html).toContain('Choosing a different backup destination will not fix');
  });
  it('explains unresolved transaction verification without diagnosing a connection failure', () => {
    const html = renderToStaticMarkup(<BackupActivity operation={{
      busy: false, kind: 'add-backup', startedAt: 1, progress: [], error: 'synthetic proof failure',
      providerFailure: { target: { kind: 'remote', url: 'https://backup.example.com' },
        method: 'processSyncChunk', timedOut: false, proofReconciliationRequired: true },
    }} onStop={vi.fn()} />);
    expect(html).toContain('could not verify a transaction');
    expect(html).toContain('your saved copies are kept');
    expect(html).not.toContain('Check your connection');
  });
  it('does not promise automatic retry for a stopped, unfinished addition', () => {
    const html = renderToStaticMarkup(<BackupActivity operation={{
      busy: false, kind: 'add-backup', cancelled: true, startedAt: 1, progress: [],
    }} onStop={vi.fn()} />);
    expect(html).toContain('Resume setup to continue, or cancel setup');
    expect(html).not.toContain('Automatic backups will try again');
  });
  it('keeps technical logs out of screen-reader announcements and names the progress indicator', () => {
    const html = renderToStaticMarkup(
      <BackupActivity
        operation={{
          busy: true,
          kind: 'sync-backups',
          startedAt: 1,
          progress: [{ at: 1, message: 'synthetic technical detail' }],
        }}
        onStop={vi.fn()}
      />
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Progress for the current copy"');
    expect(html).toContain('Stop this sync');
    expect(html).toContain('aria-controls="backup-activity-log"');
    expect(html.match(/role="status"[\s\S]*?<\/div><\/div>/)?.[0]).not.toContain(
      'synthetic technical detail'
    );
  });
});
