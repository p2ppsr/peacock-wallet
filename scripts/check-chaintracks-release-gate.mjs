#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageName = process.argv[2] || '@bsv/wallet-toolbox-client';
const required = [2, 9, 0];
const installed = require(`${packageName}/package.json`).version;
const parsed = installed.split(/[.-]/).slice(0, 3).map(Number);
const ready =
  required.every((part, index) => (parsed[index] ?? 0) === part) ||
  (parsed[0] ?? 0) > required[0] ||
  ((parsed[0] ?? 0) === required[0] && (parsed[1] ?? 0) > required[1]) ||
  ((parsed[0] ?? 0) === required[0] &&
    (parsed[1] ?? 0) === required[1] &&
    (parsed[2] ?? 0) >= required[2]);

if (!ready || installed.includes('-')) {
  console.error(
    `Release blocked: ${packageName} >=2.9.0 stable is required for resilient checkpoint caching, PoW enforcement, bounded downloads, and local-first recovery. Installed: ${installed}.`
  );
  process.exit(1);
}
console.log(`Release dependency gate passed: ${packageName}@${installed}.`);
