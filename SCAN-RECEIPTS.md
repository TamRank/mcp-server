# Phase 4B — private local recovery receipts

Status, 9 September 2026: recovery is connected to explicitly configured specialist
preview, with all targets and durable chat attestation tested through actual MCP
stdio and WordPress. Explicit POSIX setup, inspection, export and exact-record
erasure are implemented. Default clients do not create files. Dispatch/capture,
interrupted-save/platform/privacy/rollout gates and Phase 4 remain open.

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
No current scan handler calls it. Preview may configure read/recovery access to an
existing store; this does not enable capture. The shipped legacy entry is unchanged.

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
trusted directory; this is not remote agency role management. Explicit operator
setup/export/erasure is described below. Windows ACL support, extended/inherited
ACL verification and safe interrupted-save maintenance remain activation gates;
mode-bit checks do not solve those platform permission models.

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
and the MCP chat chain are tested together. No MCP tool accepts a packet or path.
Full contract: PRO repository, branch `feat/mcp-workflows`,
`docs/mcp-phase4b-scan-receipt-reconciliation.md`.

## Remaining decisions and integration

Timeouts without evidence cannot be settled as known results. Age alone is not
proof of worker death or permission to free a claim. A subsequent product decision
allows explicit current-admin abandonment with an unknown outcome and separate
chat consent: PRO repository, branch `feat/mcp-workflows`,
`docs/mcp-phase4b-scan-maintenance.md`. That separately gated path now has native
REST/MCP verification and traffic limits; it does not grant this recovery authority.

Before activation: connect execution/capture, finish interrupted-save/platform
permission handling, verify external provider/plugin compatibility and remaining
server privacy/export/erasure and coordinated rollout. No public approve-now/
start-later operation is introduced.

## Specialist chat mapping

Only `index-workflow.js` with `TAMRANK_WORKFLOW_PREVIEW=1` and
`TAMRANK_TOOL_PROFILE=specialist` may configure `TAMRANK_SCAN_RECEIPT_DIR`.
It must name an existing canonical private POSIX directory. Startup checks only
readability: it creates no files and does not require free capture capacity.
A full store/pending writer must not block reading existing valid evidence.
Invalid configuration refuses startup without printing private paths or packets.
Server discovery must advertise `chat_review_contract: 1` and current rights;
unpaid administrative access cannot become paid same-user recovery.

1. `get_scan_status({execution_id, receipt_reference})` loads the exact site-bound
   reference privately and obtains the server review. Show ALL
   `review.proposal.targets`, before/after states, the received outcome and
   `required_acknowledgements`; do not truncate the remaining devices.
2. After explicit chat approval, call `close_scan` with those same fields, a fresh
   `client_request_id`, the review's `expected_runtime_hash`, and `confirmation`
   (`mode`, `confirmed`, `client`, `agent`, `acknowledgements`, `review_hash`).
   The confirmation hash is the **outer client `review_hash`**.
3. The client reloads/reviews and checks that complete proposal again, then maps
   the client hash to the verified server `proposal_hash` for private settlement.
   WordPress verifies that proposal inside the result/stop/release transaction
   and retains client, agent, server time, hash, acknowledgements and
   `user approved in chat`. Human identity is not independently verified.
4. Already-recorded/settled returns a read-only no-op. Lost responses require fresh
   review, never remeasurement. No automatic local receipt deletion.

Without `receipt_reference`, `get_scan_status`/`close_scan` retain their separate
administrative-unknown-closure behavior. Profiles remain 12/20/42; no new tool name
and no read-triggered closure. No path, site override or raw packet is a tool input.

## Explicit local receipt lifecycle

`receipt-storage.js` is an operator CLI, not an MCP tool or startup routine. It
makes no network requests and never prints packet bytes. Use a dedicated absolute
directory under an existing trusted parent owned by this OS user and not group/
world writable. Replace these illustrative paths/site with the intended values:

```sh
node receipt-storage.js init --directory /absolute/private-parent/tamrank-receipts
node receipt-storage.js list --directory /absolute/private-parent/tamrank-receipts --site https://client.example
```

`init` exclusively creates one 0700 directory: no recursive parents, symlink
aliases, reuse or permission repair. Configure it explicitly in the preview
client. `list` returns references, execution IDs and local receipt times only for
the requested site, plus bounded incomplete/busy counts; no foreign-site details.

`inspect` also requires `--execution` and `--reference`. It returns a
`deletion_hash` and warns that this may be the only retained evidence. `remove`
requires those same fields, `--expected_hash` from inspection and
`--confirm DELETE_PRIVATE_RECEIPT`. Under the exclusive writer lock it checks the
exact record/site/execution and deletes only that file. No directories/stale locks
are removed. This is not recoverable from the store; independent exports remain.
A failed acknowledgement requires local inspection, not blind retry. Server state
is unaffected; deleting does not settle, stop or retry a scan.

`export` requires the same identity fields plus `--destination`: a NEW absolute
filename in an existing canonical private directory. It writes a 0600 private copy
without overwriting and retains the source. Exports/backups require separate
erasure. An interrupted export may leave a private partial file. Malformed records,
pending files and stale locks are deliberately not force-deleted; safe interrupted-
save maintenance remains open. Neither mode bits nor exports provide encryption.

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

PRO's `docs/mcp-phase4b-scan-recovery-http-wordpress.mjs` now adds 728 passing checks
against actual native recovery routes, with single-site and two-client subdirectory
multisite, both REST URL forms, request-limit concurrency/faults, role/PAT/PRO
revocation, bounded inputs, redaction, explicit uninstall and immutable original
approval. It launches `test/workflow-scan-recovery-wordpress.mjs` for 12 actual
private-file/internal-client/server-HMAC/WordPress/SQL chains: three sites, two URL
forms, pending versus already-recorded results. Replacement-token review and exact
explicit settlement preserve all 50 measurements without another provider call.
These chains now use actual MCP stdio, all 50 devices and server attestation
readback. Results are synthetic; no real provider is called.
Server route, authority, accounting and test-reproduction contract:
PRO repository, branch `feat/mcp-workflows`, `docs/mcp-phase4b-scan-recovery.md`.

Current 12/20/42 workflow profiles and legacy 42-tool surface remain unchanged.
Local lifecycle/chat plus existing receipt/bridge tests total 43 TAP tests; six
maintenance MCP tests stay green. PRO adds 18 pure chat tests and retains its
308 native maintenance checks. Specialist tools/list: 15,974 characters (max 16,000).
The extracted package also passed a clean-cache dependency installation with the
repository lock and install scripts disabled, including both REST forms and all
three installed profiles. No active/global installation or version change.
Temporary synthetic receipt files are removed by each test's scoped cleanup.
