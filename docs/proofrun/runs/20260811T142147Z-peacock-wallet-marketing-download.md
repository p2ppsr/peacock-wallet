# ProofRun Record: Peacock Wallet/marketing download

- ProofRun version: `1`
- Flow definition: `docs/proofrun/flows/peacock-wallet-marketing-download.proofrun.yaml`
- Run ID: `20260811T142147Z-peacock-wallet-marketing-download`
- Started at: `2026-08-11T14:21:47Z`
- Completed at: `2026-08-11T14:24:00Z`
- Outcome: `pass`
- Operator: `AI agent`

## Scope

- Surface: Peacock Wallet product home and signed downloads
- Repo: `p2ppsr/peacock-wallet`
- Workspace: task-scoped network-ops worktree
- Environment: production
- Base URL: `https://userwallet.getmetanet.com/`
- Target audience: desktop users looking for a transparent identity and payments wallet
- Flow category: onboarding and download conversion
- State changing: `no`
- Spend cap: `0 sats`

## Deployment Identity

- Source commit: `c878291478160232a140209f27b0c169b0521f99`
- Branch: `master`
- Workflow run: `https://github.com/p2ppsr/peacock-wallet/actions/runs/31499788844`
- Deployment ID: `ff96d1e7558969b184853331ae0c79ad`
- Image tag: n/a
- Image digest: n/a
- Kubernetes namespace/workload: CARS managed
- CARS project: `60cb777b729f1f272d9ca70a141a3e8d`
- Other release identity: GitHub release `v0.7.1`, 17 assets, published `2026-08-11T14:13:38Z`

## Wallet And Device Matrix Used

| Dimension | Value | Result | Notes |
| --- | --- | --- | --- |
| Desktop browser | Codex in-app Chromium, default large viewport | pass | Full semantic and visual review; platform detection recommended the macOS arm64 DMG. |
| Mobile browser | Chromium responsive viewport, 390x844 | pass | Live production hero, CTAs, preview, typography, and single-column layout rendered without visible clipping or overlap. |
| Mobile simulator | n/a | pass | Not required by this non-wallet, non-transaction flow. |
| Desktop wallet | n/a | pass | The marketing/download flow does not invoke the wallet. |
| Mobile wallet | n/a | pass | The marketing/download flow does not invoke the wallet. |
| Server wallet | n/a | pass | The marketing/download flow does not invoke the wallet. |
| Network | mainnet production | pass | Public CARS site, GitHub release, and UserCom production were used. |

## Preflight

| Check | Command/Method | Result | Evidence |
| --- | --- | --- | --- |
| Worktree clean | `git status --short --branch` | pass | Production commit was tested from a clean follow-up worktree before this record was added. |
| Live HTTP | cache-busted `curl -fsS` | pass | HTTP 200; TTFB 285 ms; total 291 ms. |
| Health endpoint | `curl -fsS https://userwallet.getmetanet.com/manifest.json` | pass | HTTP 200 in 74 ms; version `0.7.1`, four updater platforms. |
| Deployment state | GitHub Actions run `31499788844` | pass | All native build/sign jobs and `package-binaries-site` succeeded. |
| Wallet availability | not required | pass | Flow is public and wallet-free. |
| Required device/simulator boot state | 390x844 explicit Chromium viewport | pass | Production page captured and reviewed at the required responsive size. |
| Wallet permission baseline | not required | pass | No wallet API or permission prompt is used. |
| Spend cap confirmed | operator check | pass | Zero-satoshi, read-only flow. |
| Telemetry endpoint | UserCom health, write, and production DB read | pass | Database healthy; all expected v0.7.1 events were queryable. |

## Step Results

| Step | Expected | Actual | Result | Timing |
| --- | --- | --- | --- | ---: |
| 1 | Product purpose and primary action are clear above the fold; page view is emitted. | “Make trust visible,” the signed-release status, product purpose, platform download, and source link appeared above the fold. `marketing.page_view` was observed. | pass | 291 ms HTTP total |
| 2 | Product, handicap-principle trust model, features, onboarding, and integrity information are understandable. | All sections rendered in the semantic snapshot and visual desktop/mobile review with explicit identity, payments, permissions, source, signing, and privacy language. | pass | under 5 s |
| 3 | Recommended/manual download resolves and conversion telemetry is emitted. | macOS arm64 was recommended; the primary CTA and arm64 DMG actions worked, the canonical payload returned HTTP 200, and both click signals were observed. | pass | UI feedback under 500 ms; asset HTTP in 953 ms |
| 4 | Canonical source resolves and GitHub telemetry is emitted. | The source CTA resolved to `p2ppsr/peacock-wallet`; `marketing.github_clicked` was observed. | pass | under 3 s |

## Assertions

### UI And Appearance

- Result: `pass`
- Evidence: Desktop production DOM/visual review and 390x844 production screenshot review covered the complete hero, trust story, features, onboarding, downloads, integrity, open-source CTA, and footer.
- Notes: No visible clipping or overlap was found. Source validation also verifies focus-visible and reduced-motion rules.

### Intuitiveness For Target Audience

- Result: `pass`
- Evidence: The opening copy explains the wallet in plain language, the trust model is explicitly tied to the handicap principle, and platform-specific installers are grouped and labeled.
- Notes: The primary CTA automatically selected the closest macOS build while leaving all platforms available.

### Customer Trust

- Result: `pass`
- Evidence: The site exposes source, release history, checksums, signatures, permission behavior, local-key claims, and the privacy-bounded telemetry disclosure.
- Notes: The product copy distinguishes inspectable evidence from unsupported trust claims.

### Flow Success

- Result: `pass`
- Evidence: The live page, manifest, CSS, JavaScript, manifest/SEO files, logo, screenshot, and all four canonical updater payloads returned HTTP 200. The live manifest was byte-identical to GitHub `latest.json` at SHA-256 `2dcf759c2d2f224ad1fd5fd2eb6feab11b969aa906734726ac16859168014c6a`.
- Notes: The release workflow verified all four updater signatures before deployment.

### Telemetry And Observability

- Result: `pass`
- Expected events: `marketing.page_view`, `marketing.primary_cta_clicked`, `marketing.download_clicked`, `marketing.github_clicked`; optional `marketing.integrity_clicked`.
- Observed events: All five events appeared once in the production UserCom database between `2026-08-11T14:21:47Z` and `2026-08-11T14:22:31Z` with `source=peacock-wallet`, `surface=marketing-site`, and `release:v0.7.1`.
- Log checks: Production DB projection confirmed `email`, `anonymousId`, raw `url`, and raw `referrer` were absent for every event.
- Notes: Context was limited to release, platform/architecture, viewport, source channel, and action metadata. The session identifier is sessionStorage-only and was not included in public evidence.

### Reliability And Repeatability

- Result: `pass`
- Evidence: Source and rendered marketing checks passed locally and in the release job. Navigation remains ordinary HTML when JavaScript or telemetry is unavailable; telemetry failures are caught and non-blocking.
- Notes: Canonical compatibility filenames and updater URLs were preserved.

### Performance And Trust Latency

| Measurement | Pass Threshold | Actual | Result |
| --- | ---: | ---: | --- |
| First meaningful content | 2s | 291 ms full HTML response | pass |
| UI feedback after action | 500ms | immediate browser activation; under 500 ms | pass |
| Wallet prompt shown | n/a | no wallet prompt | pass |
| Approval to confirmation | n/a | no approval flow | pass |
| Full flow duration | 45s | 44s from page-view to final observed click signal | pass |
| Telemetry visible | 60s | each event visible in the production DB within the run | pass |

## Evidence

### Public-Safe Evidence

- GitHub PR `https://github.com/p2ppsr/peacock-wallet/pull/17`
- GitHub release `https://github.com/p2ppsr/peacock-wallet/releases/tag/v0.7.1`
- GitHub Actions run `https://github.com/p2ppsr/peacock-wallet/actions/runs/31499788844`
- Production site `https://userwallet.getmetanet.com/`
- CARS deployment `ff96d1e7558969b184853331ae0c79ad`; uploaded artifact size `132423710` bytes; pre-deploy balance `204057` satoshis

### Private Artifacts

- No sensitive or bulky artifact was retained. Browser screenshots were inspected in-session, and production database reads emitted only aggregate event names, counts, timestamps, bounded context, and sensitive-field presence booleans.

## Defects And Follow-Up

| Severity | Finding | Owner | Next Action |
| --- | --- | --- | --- |
| low | The requested `PeacockWallet.com` domain is already registered, has no live DNS surface, and was unavailable for normal Squarespace registration. | Product owner | Choose an available alternate domain or authorize an acquisition budget/owner outreach; then update canonical metadata and CARS DNS without changing updater compatibility URLs. |

## Readiness Impact

- Commercial readiness changed: `yes`
- Previous tier: validated desktop wallet and signed distribution
- New tier: validated product home, signed distribution, conversion telemetry, and current production ProofRun
- Registry update needed: `yes`
- Dossier update needed: `yes`
- Product repo update needed: `yes`

## Chat Summary

```text
ProofRun: Peacock Wallet/marketing download
Outcome: pass
Environment: production, https://userwallet.getmetanet.com/
Commit/deploy: c878291 / workflow 31499788844 / CARS ff96d1e7558969b184853331ae0c79ad / v0.7.1
Wallet/device matrix: Chromium desktop plus 390x844 responsive browser; wallet not required
Success evidence: public site and canonical assets 200; live manifest equals GitHub latest.json; all expected CTAs worked
Trust/UX findings: handicap-principle story, signatures, source, permissions, telemetry disclosure, and platform selection are clear
Performance: HTML total 291 ms; full flow 44 s
Telemetry/log evidence: all five v0.7.1 marketing events present; no email, anonymous ID, raw URL, or referrer
Artifacts: public GitHub/Actions/CARS evidence; no private artifact retained
Next action: decide alternate domain or exact-domain acquisition budget
```
