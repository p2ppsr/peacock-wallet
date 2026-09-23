# Portable wallet data

Open **Settings → Backups** to manage device copies and portable wallet files. The sign-in screen also offers **Restore portable wallet data**, so data can be inspected and restored before recovering the matching wallet keys.

Export an encrypted BRC-39 file with a passphrase of at least 12 characters. Save the passphrase separately: it cannot be recovered from the file. Plaintext BRC-38 export requires an explicit acknowledgement because it exposes wallet records. Neither format replaces account-key recovery.

Imports retain the original file, authenticate encrypted content, validate all 13 BRC-38 record categories, and show the network, identity, counts and source before activation. Restoring creates a separate copy. A file from another wallet identity or network can be inspected but cannot become the active wallet. Mainnet and TerraTestNet settings and data remain separate.

Merge requires the same identity and network, preserves a recovery copy of the destination, and reconciles records in a separate database. Review the result before explicitly choosing it as the main location. Activation drains outstanding storage work and fences old sessions before changing the saved binding. Restart the wallet when prompted. Other devices are not switched automatically.

Interrupted imports and merges remain in the recovery journal and can be retried. Original files and previous database bindings are retained. Corrupt files, wrong passwords, changed staging data, and invalid storage acknowledgements fail without replacing active data. Keep the previous copy until activity, certificates and balances have been checked in the restored wallet.

The format includes saved transaction records, proofs, baskets, outputs, labels, certificates and synchronization records, including tombstones. Pending action batches and auxiliary runtime tables are outside BRC-38. Review unsettled activity before spending. A device backup reflects its last completed synchronization; it is not a snapshot of a remote provider's internal database.

## Validation

Run `npm ci`, `npm run lint`, `npm test`, `npm run test:security`, `npm run build`, and `npm run chaintracks:release-gate`. Native archive tests run with `cargo test --locked` in `src-tauri`. Browser worker tests are exposed through the development-only QA page and use disposable unfunded fixtures. Production builds do not include that page.

Release qualification also requires native file-picker/save flows, interruption/restart, cross-wallet semantic comparisons and application-level wallet requests. Unit and browser tests alone do not establish native-platform or production-service acceptance.

## Coordinated Toolbox upgrade

The wallet consumes published Toolbox 2.14.0 and Message Box Client 2.5.3. [TS Stack #579](https://github.com/bsv-blockchain/ts-stack/pull/579) supplies basket membership/recovery corrections, send-max authorization, optional monitor subscription recovery and additive client/mobile exports. The lockfile pins the verified npm artifacts; file-format and signing-key boundaries remain unchanged.

## SDK 2.8.2 integration

The wallet now pins published SDK 2.8.2, retaining the authenticated AES-GCM fix from 2.8.1 and adding [TS Stack #581](https://github.com/bsv-blockchain/ts-stack/pull/581). Successful automatic React Native/XDM discovery no longer leaves subsequent wallet calls subject to the short probe deadline. Discovery remains bounded, explicit operation timeouts and response/origin validation are unchanged. Web applications must also update their own SDK bundle; upgrading a wallet alone cannot repair an older application bundle.
