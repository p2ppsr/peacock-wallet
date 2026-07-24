#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function readOption(name) {
  const index = process.argv.indexOf(name)
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required option ${name}`)
  }
  return process.argv[index + 1]
}

const frontend = path.resolve(readOption('--frontend'))
const tauriConfigPath = path.resolve(readOption('--tauri-config'))
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'))
const encodedPublicKey = tauriConfig?.plugins?.updater?.pubkey

if (!encodedPublicKey) {
  throw new Error(`Updater public key is missing from ${tauriConfigPath}`)
}

const decodedPublicKey = Buffer.from(encodedPublicKey, 'base64').toString('utf8')
const publicKey = decodedPublicKey
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line && !line.startsWith('untrusted comment:'))

if (!publicKey) {
  throw new Error(`Updater public key in ${tauriConfigPath} is malformed`)
}

const manifestFragments = readdirSync(frontend)
  .filter((filename) => /^manifest-.*\.json$/.test(filename))
  .map((filename) => path.join(frontend, filename))
  .sort()

if (manifestFragments.length === 0) {
  throw new Error(`No updater manifest fragments found in ${frontend}`)
}

const signatureDirectory = mkdtempSync(path.join(tmpdir(), 'tauri-updater-signatures-'))

try {
  for (const manifestPath of manifestFragments) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const platforms = manifest.platforms ?? {}

    if (Object.keys(platforms).length === 0) {
      throw new Error(`${manifestPath} does not contain platform updater data`)
    }

    for (const [target, payload] of Object.entries(platforms)) {
      const filename = path.basename(payload.url ?? '')
      if (!filename || !payload.signature) {
        throw new Error(`${manifestPath} is missing the URL or signature for ${target}`)
      }

      const updaterPath = path.join(frontend, 'updater', filename)
      const publishedPath = path.join(frontend, filename)
      const artifactPath = existsSync(updaterPath) ? updaterPath : publishedPath
      if (!existsSync(artifactPath)) {
        throw new Error(`Updater artifact ${filename} for ${target} is missing`)
      }

      const decodedSignature = Buffer.from(payload.signature, 'base64').toString('utf8')
      if (!decodedSignature.includes('signature from tauri secret key')) {
        throw new Error(`Updater signature for ${target} is not a Tauri minisign signature`)
      }

      const signaturePath = path.join(
        signatureDirectory,
        `${path.basename(manifestPath)}-${target}.minisig`
      )
      writeFileSync(signaturePath, decodedSignature)

      const verification = spawnSync(
        'minisign',
        ['-Vm', artifactPath, '-x', signaturePath, '-P', publicKey],
        { encoding: 'utf8' }
      )

      if (verification.error) {
        throw new Error(`Unable to run minisign: ${verification.error.message}`)
      }
      if (verification.status !== 0) {
        throw new Error(
          `Updater signature verification failed for ${target} (${filename}):\n` +
            `${verification.stdout}${verification.stderr}`
        )
      }

      console.log(`Verified updater signature for ${target}: ${filename}`)
    }
  }
} finally {
  rmSync(signatureDirectory, { recursive: true, force: true })
}
