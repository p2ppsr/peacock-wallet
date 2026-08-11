import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const rendered = process.argv.includes('--rendered')
const root = path.resolve('binaries-site/frontend')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const html = read('index.html')
const css = read('site.css')
const telemetry = read('telemetry.js')
const manifest = JSON.parse(read('site.webmanifest'))

for (const file of ['index.html', 'site.css', 'telemetry.js', 'site.webmanifest', 'robots.txt', 'sitemap.xml']) {
  assert.ok(fs.statSync(path.join(root, file)).size > 0, `${file} must not be empty`)
}

assert.match(html, /<title>Peacock Wallet — Make trust visible<\/title>/)
assert.match(html, /<h1[^>]*>Make trust[\s\S]*visible\./)
assert.match(html, /handicap principle/)
assert.doesNotMatch(html, /HandCash/i)
assert.match(html, /https:\/\/github\.com\/p2ppsr\/peacock-wallet/)
assert.match(html, /id="downloads"/)
assert.match(html, /id="privacy"/)
assert.match(html, /class="skip-link"/)
assert.match(html, /<main id="main">/)
assert.match(html, /<nav[^>]+aria-label="Primary navigation"/)

for (const asset of [
  'user-wallet-macos-arm64.dmg',
  'user-wallet-macos-x64.dmg',
  'user-wallet-windows-x64.msi',
  'user-wallet-windows-x64.exe',
  'user-wallet-linux-x86_64.AppImage',
  'SHA256SUMS',
  'SHA256SUMS.asc'
]) {
  assert.ok(html.includes(`./${asset}`), `missing download link for ${asset}`)
}

assert.equal(manifest.name, 'Peacock Wallet')
assert.equal(manifest.start_url, '/')
assert.match(css, /prefers-reduced-motion/)
assert.match(css, /:focus-visible/)
assert.match(css, /@media \(max-width: 680px\)/)

assert.match(telemetry, /https:\/\/usercom\.babbage\.systems\/signal/)
assert.match(telemetry, /const SOURCE = "peacock-wallet"/)
assert.match(telemetry, /const SURFACE = "marketing-site"/)
assert.match(telemetry, /marketing\.page_view/)
assert.match(telemetry, /marketing\.download_clicked/)
assert.match(html, /data-signal="marketing\.github_clicked"/)
assert.match(html, /data-signal="marketing\.integrity_clicked"/)
assert.match(telemetry, /navigator\.globalPrivacyControl/)
assert.match(telemetry, /navigator\.doNotTrack/)
assert.match(telemetry, /ALLOWED_HOSTS/)
assert.match(telemetry, /userwallet\.getmetanet\.com/)
assert.match(telemetry, /sessionStorage/)
assert.doesNotMatch(telemetry, /localStorage/)
assert.doesNotMatch(telemetry, /\bemail\b/i)
assert.doesNotMatch(telemetry, /wallet.*(key|identity)|transaction/i)

if (rendered) {
  assert.doesNotMatch(html, /__RELEASE_/)
  assert.doesNotMatch(telemetry, /__RELEASE_/)
  assert.ok(fs.statSync(path.join(root, 'peacock-dashboard.png')).size > 10_000)
  assert.ok(fs.statSync(path.join(root, 'app-icon.svg')).size > 100)
} else {
  assert.match(html, /__RELEASE_VERSION__/)
  assert.match(html, /__RELEASE_DATE__/)
  assert.match(telemetry, /__RELEASE_VERSION__/)
}

console.log(`Peacock marketing site checks passed (${rendered ? 'rendered' : 'source'} mode).`)
