#!/usr/bin/env node

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  const value = process.argv[index + 1]
  if (!key?.startsWith('--') || !value) {
    throw new Error(`Invalid argument near ${key ?? '<end>'}`)
  }
  args.set(key.slice(2), value)
}

const required = name => {
  const value = args.get(name)
  assert.ok(value, `--${name} is required`)
  return value
}

const frontend = path.resolve(required('frontend'))
const outputRoot = path.resolve(required('output-root'))
const releaseRepo = required('release-repo')
const releaseTag = required('release-tag')
const assetPrefix = required('asset-prefix')
const customDomain = required('custom-domain')

assert.match(releaseRepo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
assert.match(releaseTag, /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9_.-]+)?$/)
assert.match(customDomain, /^[A-Za-z0-9.-]+$/)

const pagesDir = path.join(outputRoot, 'pages')
const releaseDir = path.join(outputRoot, 'release-assets')
fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(outputRoot, { recursive: true })
fs.cpSync(frontend, pagesDir, { recursive: true })
fs.mkdirSync(releaseDir, { recursive: true })

const releaseBase = `https://github.com/${releaseRepo}/releases/download/${releaseTag}`
const fragmentNames = fs.readdirSync(pagesDir).filter(name => /^manifest-.*\.json$/.test(name)).sort()
let manifest

if (fragmentNames.length > 0) {
  manifest = { platforms: {} }
  for (const fragmentName of fragmentNames) {
    const fragmentPath = path.join(pagesDir, fragmentName)
    const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'))
    if (fragment.version && manifest.version && manifest.version !== fragment.version) {
      throw new Error(`${fragmentName} has a conflicting version`)
    }
    if (fragment.version) manifest.version = fragment.version
    if (!manifest.notes && fragment.notes) manifest.notes = fragment.notes
    if (!manifest.pub_date && fragment.pub_date) manifest.pub_date = fragment.pub_date
    const platforms = fragment.platforms ?? {}
    for (const [target, payload] of Object.entries(platforms)) {
      assert.ok(payload.url && payload.signature, `${fragmentName} is incomplete for ${target}`)
      assert.ok(!manifest.platforms[target], `Duplicate updater target ${target}`)
      const filename = path.basename(payload.url)
      const source = path.join(pagesDir, 'updater', filename)
      assert.ok(fs.existsSync(source), `Updater package ${filename} is missing`)
      const legacyPrefix = `${assetPrefix}-${target}`
      const releaseFilename = filename.startsWith(`${assetPrefix}-updater-`)
        ? filename
        : `${assetPrefix}-updater-${target}${filename.slice(legacyPrefix.length)}`
      assert.ok(
        filename.startsWith(`${assetPrefix}-updater-`) || filename.startsWith(legacyPrefix),
        `Unexpected updater filename ${filename} for ${target}`
      )
      fs.copyFileSync(source, path.join(pagesDir, releaseFilename))
      manifest.platforms[target] = {
        url: `${releaseBase}/${encodeURIComponent(releaseFilename)}`,
        signature: payload.signature
      }
    }
    fs.rmSync(fragmentPath)
  }
  fs.rmSync(path.join(pagesDir, 'updater'), { recursive: true, force: true })
} else {
  const existingManifestPath = path.join(pagesDir, 'manifest.json')
  manifest = JSON.parse(fs.readFileSync(existingManifestPath, 'utf8'))
  for (const payload of Object.values(manifest.platforms ?? {})) {
    const filename = path.basename(new URL(payload.url).pathname)
    payload.url = `${releaseBase}/${encodeURIComponent(filename)}`
  }
}

const requiredTargets = ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64']
for (const target of requiredTargets) {
  assert.ok(manifest.platforms?.[target], `Updater manifest is missing ${target}`)
}
fs.writeFileSync(path.join(pagesDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const releaseLinkOverrides = new Map()
const checksumLine = fs
  .readFileSync(path.join(pagesDir, 'SHA256SUMS'), 'utf8')
  .split(/\r?\n/)
  .find(line => line.trim())
const checksumMatch = checksumLine?.match(/^([0-9a-f]{64})\s+\*?([^/]+)$/i)
assert.ok(checksumMatch, 'SHA256SUMS must contain a simple release filename')
const [, expectedLinuxHash, checksummedLinuxName] = checksumMatch
const canonicalLinuxName = `${assetPrefix}-linux-x86_64.AppImage`
const canonicalLinuxPath = path.join(pagesDir, canonicalLinuxName)
assert.ok(fs.existsSync(canonicalLinuxPath), `Linux AppImage ${canonicalLinuxName} is missing`)
const actualLinuxHash = crypto.createHash('sha256').update(fs.readFileSync(canonicalLinuxPath)).digest('hex')
assert.equal(actualLinuxHash, expectedLinuxHash.toLowerCase(), 'Linux AppImage does not match SHA256SUMS')

if (checksummedLinuxName !== canonicalLinuxName) {
  fs.copyFileSync(canonicalLinuxPath, path.join(pagesDir, checksummedLinuxName))
  releaseLinkOverrides.set(canonicalLinuxName, checksummedLinuxName)
  const canonicalSignatureName = `${canonicalLinuxName}.asc`
  const checksummedSignatureName = `${checksummedLinuxName}.asc`
  const canonicalSignaturePath = path.join(pagesDir, canonicalSignatureName)
  if (fs.existsSync(canonicalSignaturePath)) {
    fs.copyFileSync(canonicalSignaturePath, path.join(pagesDir, checksummedSignatureName))
    releaseLinkOverrides.set(canonicalSignatureName, checksummedSignatureName)
  }
}

const isReleaseAsset = name =>
  name.startsWith(`${assetPrefix}-`) || name === 'SHA256SUMS' || name === 'SHA256SUMS.asc'

const releaseAssets = []
for (const entry of fs.readdirSync(pagesDir, { withFileTypes: true })) {
  if (!entry.isFile() || !isReleaseAsset(entry.name)) continue
  fs.copyFileSync(path.join(pagesDir, entry.name), path.join(releaseDir, entry.name))
  fs.rmSync(path.join(pagesDir, entry.name))
  releaseAssets.push(entry.name)
}

assert.ok(releaseAssets.length >= 10, `Expected at least 10 release assets, found ${releaseAssets.length}`)

const manifestPath = path.join(pagesDir, 'manifest.json')
assert.ok(manifest.platforms && Object.keys(manifest.platforms).length >= 4, 'Updater manifest is incomplete')

for (const [target, payload] of Object.entries(manifest.platforms)) {
  const expectedPrefix = `${releaseBase}/`
  assert.ok(payload.url.startsWith(expectedPrefix), `${target} updater URL is not on the GitHub Release`)
  const filename = decodeURIComponent(payload.url.slice(expectedPrefix.length))
  assert.ok(releaseAssets.includes(filename), `${target} updater asset ${filename} was not staged`)
  assert.ok(payload.signature, `${target} updater signature is missing`)
}

let html = fs.readFileSync(path.join(pagesDir, 'index.html'), 'utf8')
for (const filename of releaseAssets) {
  const relative = `./${filename}`
  const linkedFilename = releaseLinkOverrides.get(filename) ?? filename
  const absolute = `${releaseBase}/${encodeURIComponent(linkedFilename)}`
  html = html.replaceAll(`href="${relative}"`, `href="${absolute}"`)
  html = html.replaceAll(`href='${relative}'`, `href='${absolute}'`)
}
fs.writeFileSync(path.join(pagesDir, 'index.html'), html)

for (const filename of releaseAssets) {
  assert.ok(!html.includes(`href="./${filename}"`), `Relative download link remains for ${filename}`)
}

fs.copyFileSync(manifestPath, path.join(releaseDir, 'latest.json'))
fs.writeFileSync(path.join(pagesDir, 'CNAME'), `${customDomain}\n`)
fs.writeFileSync(path.join(pagesDir, '.nojekyll'), '')

console.log(`Staged ${releaseAssets.length} GitHub Release assets in ${releaseDir}`)
console.log(`Staged GitHub Pages site in ${pagesDir}`)
