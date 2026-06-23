#!/usr/bin/env node
import fs from 'fs';

const expected = process.argv[2]?.replace(/^v/, '');

function readJsonVersion(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

function readCargoTomlVersion(file) {
  const content = fs.readFileSync(file, 'utf8');
  const match = content.match(/^version = "([^"]+)"/m);
  return match?.[1];
}

function readCargoLockVersion(file, packageName) {
  const content = fs.readFileSync(file, 'utf8');
  const match = content.match(new RegExp(`\\[\\[package\\]\\]\\s+name = "${packageName}"\\s+version = "([^"]+)"`));
  return match?.[1];
}

const versions = {
  expected,
  packageJson: readJsonVersion('package.json'),
  tauriConf: readJsonVersion('src-tauri/tauri.conf.json'),
  cargoToml: readCargoTomlVersion('src-tauri/Cargo.toml'),
  cargoLock: readCargoLockVersion('src-tauri/Cargo.lock', 'user-wallet')
};

const uniqueVersions = new Set(Object.values(versions).filter(Boolean));
if (uniqueVersions.size !== 1) {
  console.error('Release version mismatch:');
  for (const [source, version] of Object.entries(versions)) {
    console.error(`  ${source}: ${version || 'missing'}`);
  }
  process.exit(1);
}

console.log(`Release version ${versions.packageJson} is synced across package, Tauri, Cargo, and tag.`);
