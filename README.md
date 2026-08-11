# Peacock Wallet

> Secure identity + payments wallet for the BSV ecosystem, built with Tauri and React. This project is open for contributors who want to improve the wallet experience, security, and developer tooling.

Peacock is named for the handicap principle: a signal is credible when it is costly to fake. The product applies that idea to verified identity, explicit permission grants, and payments users can review before committing. The feather-and-eye mark represents visible, inspectable trust rather than decoration alone.

![Peacock Wallet screenshot](./screen.png)

**[Website and signed downloads](https://userwallet.getmetanet.com/)** · **[Latest release](https://github.com/p2ppsr/peacock-wallet/releases/latest)**

## Why this project exists
- Offer a trustworthy BSV wallet that speaks modern protocols (BRC-100, Wallet Wire) and handles identity, permissions, and simple recovery by design.
- Provide an approachable codebase for contributors: Tauri for native, Vite + React + MUI on the frontend, Rust for the glue.
- Make it easy for app developers to integrate—JSON API over TCP/3321 today, Wallet Wire on TCP/3301 coming up.

## Quick start (5 minutes)
1) **Prereqs:** Node 18+, Rust toolchain, Tauri CLI (`npm i -g @tauri-apps/cli` if needed).  
2) **Install:** `npm i`  
3) **Run dev:** `npm run tauri dev`  
4) **Log in:** Generate or paste your private key or seed phrase. Simple as that.  
5) **Build prod:** `npm run build` (frontend) or `npm run tauri build` (native bundle).

If you hit macOS build issues for Rollup, install `npm i -g @rollup/rollup-darwin-x64`.

## Project map
- `src/` — React app (routes under `pages`, shared UI under `components`, theme in `components/Theme.tsx`, context in `WalletContext.tsx` and `UserContext.tsx`).
- `src-tauri/` — Tauri host, TLS helper, updater, and native integrations.
- `public/` — Static assets for the Vite app.
- `scripts/` — Dev helpers (toolbox links, versioning).
- `docs/` — Static docs site.
- `binaries-site/frontend/` — Product marketing site, signed downloads, release metadata, and privacy-bounded UserCom measurement, deployed with CARS by the release workflow.
- CI/CD with GitHub Actions.

## Development workflow
- **Type check & lint:** `npm run lint`
- **Frontend build:** `npm run build`
- **Marketing site checks:** `npm run test:marketing-site`
- **Native run:** `npm run tauri dev`
- **Native build:** `npm run tauri build`
- **Format:** `npm run format`

## How to contribute
We love thoughtful contributions. A great PR usually:
1) Opens an issue (or comments on one) describing the change and risk areas.  
2) Keeps scope tight (one concern per PR).  
3) Includes tests or manual test notes.  
4) Documents any config/env changes.  
5) Screenshots for UI tweaks.

Please file bugs with clear repro steps and platform info. For security-related findings, contact us privately first.

### Design & UX
- Stick to the Peacock Wallet palette and typography (see `components/Theme.tsx`).
- Prefer accessible components and keyboard-friendly interactions.
- Add concise comments only where logic isn’t obvious.

### Code style
- TypeScript strictness: favor explicit types for public APIs.
- Avoid silent catches; surface actionable errors to the UI/toast where relevant.
- Keep modules cohesive; extract helpers over adding one-off inline lambdas.

## Support & questions
- Open a GitHub issue for bugs or feature requests.
- For wallet behavior questions, include logs and platform (macOS/Windows/Linux) plus steps to reproduce.

## Roadmap ahead
- Wallet Wire support on TCP/3301
- Better permissions that don't annoy users
- Consider the ability to port / log-in with WAB-based accounts.

## License

The license for the code in this repository is the Open BSV License.
