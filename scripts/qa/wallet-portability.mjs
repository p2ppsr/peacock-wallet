// Disposable data only. Exercises production workers, real browser IDB and crypto.
import { deleteDB } from 'idb';
import { decryptBRC39, encryptBRC39 } from '@bsv/wallet-toolbox-client';
import { portabilityFixture } from '../../src/walletPortabilityFixture.ts';
import { canonicalArchiveJson } from '../../src/walletPortability.ts';
import { runPortabilityWorker } from '../../src/walletPortabilityClient.ts';
import { archiveDatasetDigest, verifiedArchiveDocument } from '../../src/walletPortabilityStore.ts';

export async function runWalletPortabilityQA(report) {
  const jobs = [],
    passed = [];
  const check = (value, label) => {
    if (!value) throw new Error(label);
    passed.push(label);
    report(`PASS: ${label}`);
  };
  const password = 'Public unfunded QA file passphrase';
  let ticks = 0;
  const ticker = setInterval(() => ticks++, 20);
  try {
    const document = portabilityFixture();
    const job = await runPortabilityWorker(
      {
        operation: 'import',
        file: new Blob([canonicalArchiveJson(document)]),
        fileName: 'UNFUNDED-QA.brc38.json',
        password: '',
      },
      report
    );
    jobs.push(job);
    check(job.summary.totalRecords === 13, 'worker restores all 13 categories into real IndexedDB');
    const source = {
      databaseName: job.databaseName,
      identityKey: job.summary.identityKey,
      chain: 'test',
      copiedFrom: 'Unfunded fixture',
    };
    const started = performance.now(),
      beforeTicks = ticks;
    const exported = await runPortabilityWorker(
      { operation: 'export', source, format: 'brc39', password },
      report
    );
    const elapsed = performance.now() - started;
    check(
      ticks > beforeTicks + 5,
      'UI event loop remains responsive during standard-strength encryption'
    );
    const decoded = await decryptBRC39(new Uint8Array(exported.bytes), password);
    check(
      (await archiveDatasetDigest(decoded)) === (await archiveDatasetDigest(document)),
      'Toolbox independently decrypts and verifies worker BRC-39 export'
    );
    const toolbox = await encryptBRC39(document, password);
    const imported = await runPortabilityWorker(
      {
        operation: 'import',
        file: new Blob([new Uint8Array(toolbox)]),
        fileName: 'UNFUNDED-QA.brc39',
        password,
      },
      report
    );
    jobs.push(imported);
    check(
      (await archiveDatasetDigest(await verifiedArchiveDocument(imported))) ===
        (await archiveDatasetDigest(document)),
      'worker decrypts Toolbox BRC-39 and verifies every restored record'
    );
    const controller = new AbortController();
    const cancelled = runPortabilityWorker(
      { operation: 'export', source, format: 'brc39', password },
      report,
      controller.signal
    );
    setTimeout(() => controller.abort(), 50);
    try {
      await cancelled;
      throw new Error('Cancellation did not reject');
    } catch (error) {
      check(error.code === 'cancelled', 'worker cancellation stops before saving any file');
    }
    check(
      (await archiveDatasetDigest(await verifiedArchiveDocument(job))) ===
        (await archiveDatasetDigest(document)),
      'cancellation leaves the existing database unchanged'
    );
    report(
      `METRIC: standard-strength encrypted export ${Math.round(elapsed)} ms; ${exported.bytes.byteLength} bytes; ${ticks} UI timer ticks`
    );
    return { passed };
  } finally {
    clearInterval(ticker);
    // Leave production/user journals untouched. Remove only this fixture's jobs.
    const { openDB } = await import('idb');
    const journal = await openDB('peacock-wallet-portability-v1');
    try {
      for (const job of jobs) {
        await deleteDB(job.databaseName);
        await journal.delete('jobs', job.id);
      }
    } finally {
      journal.close();
    }
  }
}
