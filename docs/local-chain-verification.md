# Local chain verification

This wallet now treats a device-local ChainTracks instance as the primary SPV verifier. Wallet proof checks receive a stable SDK `ChainTracker` proxy at construction time. During first-run migration the proxy preserves the prior remote behavior until the local database is available, then switches to the local proof-of-work-validating view. Remote-only operation remains an explicit advanced compatibility option.

## Checkpoint and persistence

Release builds materialize nine immutable 100,000-header files covering main-chain heights 0–899,999. `config/chaintracks-checkpoint.json` pins every file by byte count and SHA-256 digest. The build aborts before packaging if a downloaded object differs. Vite places the verified files inside the application bundle.

ChainTracks stores bulk metadata and the live chain in IndexedDB. A cache adapter reads packaged files first, retains later immutable bulk objects in device Cache Storage, and lets the upstream bulk manager re-check size, SHA-256, genesis, linkage, chainwork, compact targets, and proof of work before use. Test-chain headers use the same durable cache but download on demand.

The local ingestors use the public Arcade header stream, immutable bulk CDN, and credential-free WhatsOnChain fallback supplied by Wallet Toolbox. Two independent remote clients are retained for consistency quorum and exceptional fallback. A definitive local rejection is never overridden by a remote answer.

## Synchronization and recovery

The tracker listens continuously while the app is running, requests a sync every minute, checks two-reference agreement every five minutes, and immediately retries when connectivity returns. A lag greater than six blocks or a quorum-confirmed divergent hash triggers the upstream evidence-based recovery callback. Recovery closes and deletes only ChainTracks state, retains wallet keys and transaction data, reseeds from the packaged checkpoint, and synchronizes the tip.

Advanced Settings exposes local/remote mode, local height/tip, reference height and lag, storage estimates, sync and consistency actions, and a header-only clear/rebuild action.

## Release dependency

Every release command runs `chaintracks:release-gate` and requires stable `@bsv/wallet-toolbox-client >=2.9.0`. That line includes the local-first verification boundary from ts-stack #463 and the resilient, non-blocking bulk-ingestion runtime from #469. The wallet imports those published APIs directly and has no dependency on the closed, unmerged ts-stack #472.
