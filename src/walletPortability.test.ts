import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { KeyDeriver, PrivateKey } from '@bsv/sdk';
import { WalletBackupStorageManager } from './walletStorageConnections';
import {
  decryptBRC39,
  encryptBRC39,
  importBRC38,
  exportBRC38,
  Wallet,
  Services,
} from '@bsv/wallet-toolbox-client';
import {
  decodeArchive,
  encodeArchive,
  readArchiveHeader,
  validateArchive,
  canonicalArchiveJson,
  summarizeArchive,
  matchesArchiveWallet,
} from './walletPortability';
import {
  archiveDatasetDigest,
  captureArchive,
  listArchiveJobs,
  loadArchiveJob,
  prepareArchiveImport,
  prepareArchiveMerge,
  verifiedArchiveDocument,
  openArchiveStorage,
  updateArchiveJob,
  resumeArchiveImport,
  prepareArchiveActivation,
} from './walletPortabilityStore';
import { portabilityFixture } from './walletPortabilityFixture';
import { archiveStores } from './walletPortabilityIdb';

afterEach(async () => {
  for (const job of await listArchiveJobs()) {
    for (const name of [
      job.databaseName,
      job.beforeDatabaseName,
      job.mergeDatabaseName,
      job.activationDatabaseName,
    ])
      if (name) await deleteDB(name);
  }
  await deleteDB('peacock-wallet-portability-v1');
});

describe('standard wallet archives', () => {
  it('interoperates both directions with Toolbox BRC-39 at canonical strength', async () => {
    const document = portabilityFixture();
    const password = 'Disposable cafe\u0301 fixture passphrase';
    const encoded = await encodeArchive(document, 'brc39', password);
    expect(await decryptBRC39(encoded, password.normalize('NFC'))).toEqual(document);
    const toolbox = await encryptBRC39(document, password);
    expect(await decodeArchive(new Uint8Array(toolbox), password.normalize('NFC'))).toEqual(
      document
    );
    await expect(decodeArchive(encoded, '')).rejects.toMatchObject({ code: 'password' });
    await expect(decodeArchive(encoded, 'wrong password')).rejects.toMatchObject({
      code: 'password',
    });
    encoded[encoded.length - 1] ^= 1;
    await expect(decodeArchive(encoded, password)).rejects.toMatchObject({ code: 'password' });
  }, 60000);

  it('rejects unsupported and excessive KDF headers before deriving a key', () => {
    const file = new Uint8Array(150);
    file.set([87, 68, 65, 84, 1, 1, 38, 1, 0, 32, 32]);
    file[19] = 1;
    file[20] = 32;
    const view = new DataView(file.buffer);
    view.setUint32(11, 7);
    view.setUint32(15, 131072);
    expect(readArchiveHeader(file).memoryKiB).toBe(131072);
    view.setUint32(15, 524288);
    expect(() => readArchiveHeader(file)).toThrow(/resources/);
    file[7] = 2;
    expect(() => readArchiveHeader(file)).toThrow(/unsupported/);
  });

  it('validates relationships and identity/network before allowing a merge', () => {
    const document = portabilityFixture(),
      summary = summarizeArchive(validateArchive(document));
    expect(matchesArchiveWallet(summary, summary.identityKey, 'test')).toBe(true);
    expect(matchesArchiveWallet(summary, summary.identityKey, 'main')).toBe(false);
    document.tables.outputs[0].transactionId = 999;
    expect(() => validateArchive(document)).toThrow(/valid, complete/);
  });

  it('restores all thirteen categories exactly, including legacy policy, tombstones and bytes, without a provider', async () => {
    const document = portabilityFixture();
    const original = new Blob([canonicalArchiveJson(document)]);
    const job = await prepareArchiveImport(original, 'fixture.brc38.json', '', () => {});
    expect(job.state).toBe('ready');
    expect(Object.values(job.summary!.counts)).toEqual(Array(13).fill(1));
    const reopened = await loadArchiveJob(job.id);
    const restored = await verifiedArchiveDocument(reopened);
    expect(await archiveDatasetDigest(restored)).toBe(await archiveDatasetDigest(document));
    expect(restored.tables.outputBaskets[0].minimumDesiredUTXOValue).toBe(32);
    expect(restored.tables.outputs[0].lockingScript).toBe('UQ==');
    expect(restored.user.activeStorage).toBe(document.user.activeStorage);
  });

  it('prepares overlapping merges with a retained recovery point and restart journal', async () => {
    const document = portabilityFixture();
    const original = new Blob([canonicalArchiveJson(document)]);
    const current = await prepareArchiveImport(original, 'current.brc38.json', '', () => {});
    const incoming = await prepareArchiveImport(original, 'incoming.brc38.json', '', () => {});
    const source = {
      databaseName: current.databaseName,
      identityKey: current.summary!.identityKey,
      chain: 'test' as const,
      copiedFrom: 'Fixture',
    };
    const pending = await prepareArchiveMerge(
      incoming.id,
      source,
      'remote:https://fixture.example',
      () => {}
    );
    expect(pending.state).toBe('merging');
    const before = await captureArchive({ ...source, databaseName: pending.beforeDatabaseName! });
    expect(await archiveDatasetDigest(before)).toBe(await archiveDatasetDigest(document));
    const merged = await captureArchive({ ...source, databaseName: pending.mergeDatabaseName! });
    expect(merged.tables.transactions).toHaveLength(1);
    expect(merged.tables.outputs).toHaveLength(1);
    expect(merged.tables.outputTagMaps[0].isDeleted).toBe(true);
    expect(
      (await prepareArchiveMerge(incoming.id, source, 'remote:https://fixture.example', () => {}))
        .mergeDatabaseName
    ).toBe(pending.mergeDatabaseName);
    await expect(
      prepareArchiveMerge(incoming.id, source, 'remote:https://other.example', () => {})
    ).rejects.toMatchObject({ code: 'stale' });
  });
});

it('remaps overlapping identifiers and preserves deletions across repeated merges', async () => {
  const original = portabilityFixture();
  const current = await prepareArchiveImport(
    new Blob([canonicalArchiveJson(original)]),
    'current.json',
    '',
    () => {}
  );
  const changed = portabilityFixture();
  changed.sourceStorage.storageIdentityKey = '4'.repeat(64);
  changed.user.userId = 17;
  for (const rows of Object.values(changed.tables))
    for (const row of rows) {
      for (const field of Object.keys(row))
        if (field.endsWith('Id') && typeof row[field] === 'number')
          row[field] = Number(row[field]) + (field === 'userId' ? 16 : 50);
      row.updated_at = '2026-06-01T00:00:00.000Z';
    }
  changed.tables.provenTxReqs[0].notify = { transactionIds: [51] };
  changed.tables.transactions[0].description = 'Updated description';
  const incoming = await prepareArchiveImport(
    new Blob([canonicalArchiveJson(changed)]),
    'changed.json',
    '',
    () => {}
  );
  const source = {
    databaseName: current.databaseName,
    identityKey: current.summary!.identityKey,
    chain: 'test' as const,
    copiedFrom: 'Fixture',
  };
  const job = await prepareArchiveMerge(incoming.id, source, 'local', () => {});
  const merged = await captureArchive({ ...source, databaseName: job.mergeDatabaseName! });
  expect(merged.tables.transactions).toHaveLength(1);
  expect(merged.tables.transactions[0].description).toBe('Updated description');
  expect(merged.tables.outputs[0].transactionId).toBe(merged.tables.transactions[0].transactionId);
  expect(merged.tables.outputs[0].basketId).toBe(merged.tables.outputBaskets[0].basketId);
  expect(merged.tables.certificateFields[0].certificateId).toBe(
    merged.tables.certificates[0].certificateId
  );
  expect(merged.tables.txLabelMaps[0].isDeleted).toBe(true);
  const storage = await openArchiveStorage(job.mergeDatabaseName!, 'test');
  try {
    await importBRC38(storage, changed, { mode: 'merge' });
  } finally {
    await storage.destroy();
  }
  const repeated = await captureArchive({ ...source, databaseName: job.mergeDatabaseName! });
  expect(repeated.tables.outputs).toHaveLength(1);
  expect(repeated.tables.transactions).toHaveLength(1);
});

it('resumes interrupted staging from the retained original and isolates activation from archive data', async () => {
  const document = portabilityFixture();
  const job = await prepareArchiveImport(
    new Blob([canonicalArchiveJson(document)]),
    'recover.json',
    '',
    () => {}
  );
  await updateArchiveJob(job.id, { state: 'preparing', digest: undefined });
  const resumed = await resumeArchiveImport(job.id, '', () => {});
  expect(resumed.state).toBe('ready');
  const active = await prepareArchiveActivation(job.id, () => {});
  expect(active.activationDatabaseName).not.toBe(active.databaseName);
  const working = await captureArchive({
    databaseName: active.activationDatabaseName!,
    identityKey: active.summary!.identityKey,
    chain: 'test',
    copiedFrom: 'Fixture',
  });
  expect(working.user.activeStorage).toBe(active.activationStorageIdentityKey);
  expect((await verifiedArchiveDocument(active)).user.activeStorage).toBe(
    document.user.activeStorage
  );
});

it('rejects incomplete rows and duplicate composite keys before writing a recovery journal', async () => {
  const document = portabilityFixture();
  delete document.tables.outputs[0].spendable;
  await expect(
    prepareArchiveImport(new Blob([JSON.stringify(document)]), 'incomplete.json', '', () => {})
  ).rejects.toMatchObject({ code: 'invalid' });
  expect(await listArchiveJobs()).toHaveLength(0);
  const duplicate = portabilityFixture();
  duplicate.tables.outputTagMaps.push({ ...duplicate.tables.outputTagMaps[0] });
  expect(() => validateArchive(duplicate)).toThrow(/valid, complete/);
});

it('opens the activated data with matching keys and an enabled local wallet, without the old provider', async () => {
  const original = portabilityFixture();
  const job = await prepareArchiveImport(
    new Blob([canonicalArchiveJson(original)]),
    'cold-restore.json',
    '',
    () => {}
  );
  const ready = await prepareArchiveActivation(job.id, () => {});
  const storage = await openArchiveStorage(ready.activationDatabaseName!, 'test');
  const manager = new WalletBackupStorageManager(String(original.user.identityKey));
  try {
    await manager.addWalletStorageProvider(storage);
    expect(manager.isActiveEnabled).toBe(true);
    expect(manager.getActiveStore()).toBe(ready.activationStorageIdentityKey);
    const wallet = new Wallet({
      chain: 'test',
      keyDeriver: new KeyDeriver(new PrivateKey(42)),
      storage: manager,
      services: new Services(Services.createDefaultOptions('test')),
    });
    expect((await wallet.getPublicKey({ identityKey: true })).publicKey).toBe(
      original.user.identityKey
    );
    const listed = await wallet.listOutputs({ basket: 'default', limit: 10 });
    expect(listed.outputs).toHaveLength(0); // The public fixture output is deliberately not spendable.
    expect((await storage.findTransactions({ partial: {} }))[0].description).toBe('Fixture');
  } finally {
    await storage.destroy();
  }
});

it('matches Toolbox export semantics with packed bytes and script/raw-transaction hydration', async () => {
  const document = portabilityFixture();
  const job = await prepareArchiveImport(
    new Blob([canonicalArchiveJson(document)]),
    'hydration.json',
    '',
    () => {}
  );
  const storage = await openArchiveStorage(job.databaseName, 'test');
  try {
    const db = await storage.verifyDB();
    const tx = db.transaction(['transactions', 'outputs'], 'readwrite');
    const transaction = await tx.objectStore('transactions').get(1);
    delete transaction!.rawTx;
    await tx.objectStore('transactions').put(transaction!);
    const output = await tx.objectStore('outputs').get(1);
    delete output!.lockingScript;
    output!.scriptLength = 1;
    output!.scriptOffset = 15;
    await tx.objectStore('outputs').put(output!);
    await tx.done;
    const toolbox = await exportBRC38(storage, job.summary!.identityKey);
    const packed = await captureArchive({
      databaseName: job.databaseName,
      identityKey: job.summary!.identityKey,
      chain: 'test',
      copiedFrom: 'Fixture',
    });
    expect(await archiveDatasetDigest(packed)).toBe(await archiveDatasetDigest(toolbox));
    expect(packed.tables.transactions[0].rawTx).toBe(document.tables.transactions[0].rawTx);
    expect(packed.tables.outputs[0].lockingScript).toBe('UQ==');
  } finally {
    await storage.destroy();
  }
});

it('exports exactly one profile and ignores pending action batches and auxiliary stores', async () => {
  const document = portabilityFixture();
  const job = await prepareArchiveImport(
    new Blob([canonicalArchiveJson(document)]),
    'scope.json',
    '',
    () => {}
  );
  const storage = await openArchiveStorage(job.databaseName, 'test');
  try {
    const db = await storage.verifyDB();
    const tx = db.transaction(
      ['users', 'transactions', 'action_batches', 'monitor_events'],
      'readwrite'
    );
    const user = await tx.objectStore('users').get(1);
    await tx
      .objectStore('users')
      .add({ ...user!, userId: 2, identityKey: new PrivateKey(43).toPublicKey().toString() });
    const other = await tx.objectStore('transactions').get(1);
    await tx.objectStore('transactions').add({
      ...other!,
      transactionId: 2,
      userId: 2,
      reference: 'other-profile',
      description: 'Must remain in the other profile',
    });
    await tx
      .objectStore('action_batches')
      .add({ actionBatchId: 1, userId: 1, batchId: 'pending-fixture', status: 'pending' } as never);
    await tx.objectStore('monitor_events').add({ id: 1, details: 'auxiliary fixture' } as never);
    await tx.done;
    const captured = await captureArchive({
      databaseName: job.databaseName,
      chain: 'test',
      identityKey: job.summary!.identityKey,
      copiedFrom: 'Fixture',
    });
    expect(Object.keys(captured.tables).sort()).toEqual(Object.keys(archiveStores).sort());
    expect(await archiveDatasetDigest(captured)).toBe(await archiveDatasetDigest(document));
    expect(await db.count('action_batches')).toBe(1);
    expect(await db.count('users')).toBe(2);
  } finally {
    await storage.destroy();
  }
});

it('round-trips multi-chunk binary fields and rejects truncated or malformed UTF-8 files', async () => {
  const document = portabilityFixture();
  document.tables.transactions[0].inputBEEF = 'AQID'.repeat(2 * 1024 * 1024);
  const bytes = await encodeArchive(document, 'brc38', '');
  const decoded = await decodeArchive(bytes, '');
  expect(await archiveDatasetDigest(decoded)).toBe(await archiveDatasetDigest(document));
  await expect(decodeArchive(bytes.subarray(0, bytes.length - 1), '')).rejects.toMatchObject({
    code: 'invalid',
  });
  const malformed = new Uint8Array([123, 34, 0xff, 34, 58, 49, 125]);
  await expect(decodeArchive(malformed, '')).rejects.toMatchObject({ code: 'invalid' });
}, 30000);

it('represents absent optional history properties by omission without modifying the source', async () => {
  const document = portabilityFixture();
  const job = await prepareArchiveImport(
    new Blob([canonicalArchiveJson(document)]),
    'history.json',
    '',
    () => {}
  );
  const storage = await openArchiveStorage(job.databaseName, 'test');
  try {
    const db = await storage.verifyDB();
    const row = await db.get('proven_tx_reqs', 1);
    row!.history = JSON.stringify({
      notes: [{ when: document.exportedAt, what: 'sent', optional: null }],
    });
    await db.put('proven_tx_reqs', row!);
    const source = {
      databaseName: job.databaseName,
      chain: 'test' as const,
      identityKey: job.summary!.identityKey,
      copiedFrom: 'Fixture',
    };
    const captured = await captureArchive(source);
    expect(captured.tables.provenTxReqs[0].history).toEqual({
      notes: [{ when: document.exportedAt, what: 'sent' }],
    });
    expect((await db.get('proven_tx_reqs', 1))!.history).toBe(row!.history);
    row!.history = JSON.stringify({ notes: [null] });
    await db.put('proven_tx_reqs', row!);
    await expect(captureArchive(source)).rejects.toMatchObject({ code: 'invalid' });
  } finally {
    await storage.destroy();
  }
});

it('merges more than one page using Toolbox reconciliation without losing unsettled transaction records', async () => {
  const document = portabilityFixture();
  const current = await prepareArchiveImport(
    new Blob([canonicalArchiveJson(document)]),
    'base.json',
    '',
    () => {}
  );
  for (let id = 2; id <= 560; id++) {
    const row: (typeof document.tables.transactions)[number] = {
      ...document.tables.transactions[0],
      transactionId: id,
      status: 'unsigned',
      reference: btoa(`page-${id}`),
    };
    delete row.txid;
    delete row.provenTxId;
    delete row.rawTx;
    delete row.inputBEEF;
    document.tables.transactions.push(row);
  }
  const incoming = await prepareArchiveImport(
    new Blob([canonicalArchiveJson(document)]),
    'pages.json',
    '',
    () => {}
  );
  const phases: string[] = [];
  const source = {
    databaseName: current.databaseName,
    identityKey: current.summary!.identityKey,
    chain: 'test' as const,
    copiedFrom: 'Fixture',
  };
  const merged = await prepareArchiveMerge(incoming.id, source, 'local', (message) =>
    phases.push(message)
  );
  const captured = await captureArchive({ ...source, databaseName: merged.mergeDatabaseName! });
  expect(captured.tables.transactions).toHaveLength(560);
  expect(new Set(captured.tables.transactions.map((row) => row.reference)).size).toBe(560);
  expect(phases.filter((message) => message.startsWith('Reconciling transactions:'))).toHaveLength(
    3
  );
  expect(captured.tables.transactions.filter((row) => row.status === 'unsigned')).toHaveLength(559);
});


it('retains TerraTestNet identity through archive restore and never matches another chain', async () => {
  const document = portabilityFixture();
  document.sourceStorage.chain = 'ttn';
  const job = await prepareArchiveImport(new Blob([canonicalArchiveJson(document)]), 'ttn.brc38.json', '', () => {});
  expect(job.summary!.chain).toBe('ttn');
  expect(matchesArchiveWallet(job.summary!, job.summary!.identityKey, 'ttn')).toBe(true);
  for (const chain of ['main', 'test'] as const) {
    expect(matchesArchiveWallet(job.summary!, job.summary!.identityKey, chain)).toBe(false);
  }
  const restored = await verifiedArchiveDocument(job);
  expect(restored.sourceStorage.chain).toBe('ttn');
  expect(await archiveDatasetDigest(restored)).toBe(await archiveDatasetDigest(document));
});
