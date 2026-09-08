# Phase 4B — private local recovery receipts

Status, 8 September 2026: local receipt storage and an opt-in transport capture
hook are implemented and tested. They are **not wired into an entry point or
scan execution tool**. Default clients do not create files. Phase 4 remains open.

Source: MCP repository, branch `feat/mcp-workflows`,
`src/scan-receipt-store.js`, `src/workflow-rest.js`,
`test/workflow-scan-receipts.mjs`.
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
input is made here.

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

No redirect forwarding, HTTP retry, automatic dispatch, result settlement or
claim release was added. Missing receipts, timeouts, bad JSON and uncertain
transport stay uncertain. A known stored result must still be read back privately
and settlement must use the server's existing exact-proof/current-authority checks.

## Remaining decisions and integration

Timeouts without evidence cannot be settled as known results. Age alone is not
proof of worker death or permission to free a claim. A subsequent product decision
allows explicit current-admin abandonment with an unknown outcome and separate
chat consent: PRO repository, branch `feat/mcp-workflows`,
`docs/mcp-phase4b-scan-maintenance.md`. That internal disabled path does not change
this receipt store's authority or connect a native maintenance tool.

Before activation: connect native PAT/REST/MCP orchestration to the capture/load
hook, provision the private directory safely, resolve maintenance and cleanup,
verify full WordPress/provider behavior, and finish privacy/export/erasure and
coordinated rollout. No public approve-now/start-later operation is introduced.

## Verification

`node --test test/workflow-scan-receipts.mjs`: 20 scenarios (22 TAP tests including
the two parent groups). Real private temporary files, separate-process reload,
exact retries, cross-site/execution refusal, capacity, unsafe paths/files,
concurrent saves, injected write/directory-sync failures, passive no-write reads,
transport capture/redaction, immutable outgoing context and no HTTP retries.
HTTP/auth/provider responses are synthetic; no real account or Google call.

Existing 12/19/42 workflow profiles and legacy 42-tool surface remain unchanged.
The extracted package also passed a clean-cache dependency installation with the
repository lock and install scripts disabled, including both REST forms and all
three installed profiles. No active/global installation or version change.
Temporary synthetic receipt files are removed by each test's scoped cleanup.
