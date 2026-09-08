# Phase 4B — private local recovery receipts

Status, 8 September 2026: local receipt storage and an opt-in transport capture
hook and an internal receipt-review/recovery bridge are implemented and tested.
They are **not wired into an entry point or scan execution tool**. Default clients
do not create files. Separately gated native recovery REST routes and independent
request limits now pass real WordPress tests with this internal client. MCP-tool
mapping, private-store setup/cleanup, activation and Phase 4 remain open.

Source: MCP repository, branch `feat/mcp-workflows`,
`src/scan-receipt-store.js`, `src/workflow-rest.js`, `src/scan-receipt-recovery.js`,
`test/workflow-scan-receipts.mjs`, `test/workflow-scan-receipt-recovery.mjs`,
`test/workflow-scan-recovery-wordpress.mjs`.
Server contract: PRO repository, same branch,
`docs/mcp-phase4b-scan-settlement.md`.

## What is retained

A trusted future driver can explicitly construct a `ScanReceiptStore` with an
existing, dedicated private directory, pass it to `WorkflowClient`, and opt one
exact attempt request into `retainScanReceipt: true`. This is an internal library
option, **not a tool argument, environment switch, new route or scan permission**.
No current handler calls it. The shipped/preview entry points remain unchanged.

The exact outgoing attempt is copied before awaiting anything. Capture binds to
the configured site URL (including the WordPress subdirectory), execution ID,
measurement ID, original request ID and original expected runtime hash.
The latter is the **pre-start attempt hash**, not the signed started-runtime hash
required for server settlement. No implicit conversion or invented settlement
input is made here. The internal recovery bridge asks WordPress to authenticate
the packet and supply the signed started hash; it never decodes it into authority.

After a non-success JSON response with `data.result_receipt` and
`receipt_contains_private_result: true`, retain the exact bounded packet before
returning an error. Only its format is checked locally; **only WordPress verifies
the signature, original user, exact result/history and current recovery rights**.
The opaque packet is not decoded into permissions, approval or a successful result.
A signed receipt grants no authority by itself.

The file contains format version, local receipt time, site/attempt identity and
the opaque packet. It contains no PAT, Google API key, HTTP headers/body, chat text
or extra caller fields. Local receipt time is not a Google/server completion time.
A deterministic SHA-256 reference binds the site, full attempt identity and packet.
The saved record is not a substitute for the server audit.

## Local storage boundary

- Explicit existing canonical directory, owned by the running POSIX user, mode
  0700; files 0600. No automatic mkdir, chmod, default home path or installation.
  Symlink paths, foreign ownership, public permissions, hardlinked records,
  malformed/oversized files and mismatched references are refused.
- Maximum 100 retained records per configured directory, maximum 16 KiB per
  record, with packets limited to 8 KiB. Incomplete entries count against capacity.
  A single serialized save can additionally have one temporary file and lock.
- A private exclusive file lock serializes writers. Write and sync a unique
  temporary file, publish through a no-replace hard link, remove the temporary
  name, validate the published record and sync the directory before reporting
  retention. Existing evidence is never overwritten.
- Exact local retry reads the first saved record without changing its timestamp.
  An uncertain durability acknowledgement can be reconciled through local
  read/exact save retry. This never repeats the measurement or submits settlement.
- Passive local load validates the reference and exact site/execution context.
  It makes no writes or network calls and returns the private record only to
  the internal driver, never through an MCP tool.
- No automatic expiry, eviction, deletion, lock stealing, repair or background
  work. A crash may leave a lock or incomplete file: new capture refuses while
  existing valid evidence remains readable. Do not remove such files while a
  writer may still be running.

This is filesystem-permission protection, **not encryption**. Root, this OS user,
trusted directory parents, local administrators, host backups and debuggers remain
outside the isolation boundary. Each local account/profile must have its own
trusted directory; this is not remote agency role management. Windows ACL storage,
automatic setup, operator-controlled cleanup/export/erasure and safe interrupted
save maintenance remain activation gates. No implementation silently claims those
are solved by mode bits.

## Client behavior and privacy

Readiness is checked before an opted-in attempt: missing, insecure, full or busy
storage refuses before HTTP. This is not a reserved slot or a guarantee against
later disk loss/concurrent capacity changes. A failed save after a response returns
`scan_receipt_retention_failed`, without packet, raw filesystem exception or a
claim of retention. A lost HTTP response/process death cannot be recovered from
a local receipt that was never received and saved.

On successful retention, the internal error exposes only
`receipt_reference` and `receipt_retained: true`; its message directs reconciliation,
not remeasurement. The raw packet is absent from transport errors and MCP text.
Normal successful result storage makes no extra local copy.

All V2 responses, including passive saved-history reads, redact `result_receipt`
fields, recognizable packet strings and the request's PAT before exposing them.
Ordinary metrics are preserved. An unexpected private error packet without capture
enabled is withheld with an explicit not-retained message. External HTTP filters,
host tracing/debuggers or arbitrary caller logging of the internal loaded record
are not controlled by this module.

Capture adds no redirect forwarding, HTTP retry, automatic dispatch or settlement.
Missing receipts, timeouts, bad JSON and uncertain transport stay uncertain.

## Internal review and explicit recovery bridge

`ScanReceiptRecovery` loads a reference privately for a fixed site/execution and
requests an authenticated server review of the original attempt/packet pair.
It returns only bounded known-result details, remaining-device count, the correct
signed started hash and a local review hash; never the packet. Changed version,
outcome or remainder requires a new review. Observation time alone does not.

An explicit `settle()` call requires that exact review hash and `confirmed: true`.
The latter is a client assertion, not independently verified human approval.
It reloads and reviews again before sending the existing exact settlement input.
Already-recorded or already-settled results return a read-only no-op. Unexpected
responses remain uncertain, with no automatic retry, remeasurement or file deletion.
The server still enforces same-user rights and exact history atomically.

The library targets `/scans/recovery/{id}/receipt-review` and `/scans/recovery/{id}/settle`.
These paths are now registered natively only behind the separate default-off
`TAMRANK_WORKFLOW_SCAN_RECOVERY_REST_ENABLED` gate, with existing recovery/read and
settlement gates also required. Native routing, rights, independent request limits
and this internal client are tested together. No MCP tool accepts a packet or
calls the bridge. Full contract: PRO repository, branch `feat/mcp-workflows`,
`docs/mcp-phase4b-scan-receipt-reconciliation.md`.

## Remaining decisions and integration

Timeouts without evidence cannot be settled as known results. Age alone is not
proof of worker death or permission to free a claim. A subsequent product decision
allows explicit current-admin abandonment with an unknown outcome and separate
chat consent: PRO repository, branch `feat/mcp-workflows`,
`docs/mcp-phase4b-scan-maintenance.md`. That separately gated path now has native
REST/MCP verification and traffic limits; it does not grant this recovery authority.

Before activation: connect explicit MCP review/confirmation/settlement orchestration
and execution capture to the tested native REST/internal-client chain, provision
the private directory safely, finish cleanup, verify external provider/plugin
compatibility, and finish privacy/export/erasure and coordinated rollout. No public
approve-now/start-later operation is introduced.

## Verification

`node --test test/workflow-scan-receipts.mjs`: 20 scenarios (22 TAP tests including
the two parent groups). Real private temporary files, separate-process reload,
exact retries, cross-site/execution refusal, capacity, unsafe paths/files,
concurrent saves, injected write/directory-sync failures, passive no-write reads,
transport capture/redaction, immutable outgoing context and no HTTP retries.
HTTP/auth/provider responses are synthetic; no real account or Google call.

`node --test test/workflow-scan-receipt-recovery.mjs`: eight scenarios (nine TAP
tests with the parent). PRO's receipt-review SQL harness launches
`test/workflow-scan-receipt-chain.mjs`: six real HTTP/private-file/server-HMAC/SQL
chains, with synthetic routing/auth/provider. Failed storage, lost ordinary commit
acknowledgement and lost settlement acknowledgement all reconcile without another
measurement. Those HTTP fixture chains do not certify native WordPress routing.

PRO's `docs/mcp-phase4b-scan-recovery-native-wordpress.mjs` additionally passes 305
native WordPress PAT/admin/locally stored PRO checks with passive receipt review
and atomic settlement, including same-user rotation, other-client/user refusal
and late revocation rollback. That earlier suite does not enable recovery HTTP.

PRO's `docs/mcp-phase4b-scan-recovery-http-wordpress.mjs` now adds 686 passing checks
against actual native recovery routes, with single-site and two-client subdirectory
multisite, both REST URL forms, request-limit concurrency/faults, role/PAT/PRO
revocation, bounded inputs, redaction, explicit uninstall and immutable original
approval. It launches `test/workflow-scan-recovery-wordpress.mjs` for 12 actual
private-file/internal-client/server-HMAC/WordPress/SQL chains: three sites, two URL
forms, pending versus already-recorded results. Replacement-token review and exact
explicit settlement preserve all 50 measurements without another provider call.
No MCP entry point is connected. Results are synthetic; no real provider is called.
Server route, authority, accounting and test-reproduction contract:
PRO repository, branch `feat/mcp-workflows`, `docs/mcp-phase4b-scan-recovery.md`.

Current 12/20/42 workflow profiles and legacy 42-tool surface remain unchanged.
The extracted package also passed a clean-cache dependency installation with the
repository lock and install scripts disabled, including both REST forms and all
three installed profiles. No active/global installation or version change.
Temporary synthetic receipt files are removed by each test's scoped cleanup.
