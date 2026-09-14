# Workflow bridge — development preview

Branch `feat/mcp-workflows` prepares MCP `0.4.0-preview` in package
`@tam-rank/mcp-server`. The shipped entry, npm bin and package version remain
unchanged. This is not a release or a replacement of the active MCP connection.

For the current first-connection guide, use [README.md](README.md). It separates
the normal legacy bin from the explicit workflow entry, starts with site-local
read-only credentials and explains profiles, approvals and connection failures.
`node test/workflow-onboarding.mjs` checks its configuration, tool inventories,
read walkthrough, transport boundaries and bundled links without contacting a
site. The package harness runs that check before creating the archive.

The dated sections below retain increment-level evidence; a restriction stated
in an older section may be superseded by a later tested increment. The guide and
these fixtures do not close customer onboarding, other clients/platforms or the
remaining Phase 4 acceptance gates.

## Installed mixed historical schema recovery — 14 September

The separate historical mixed-schema recovery matrix also passes on 14 September:
3,030 native checks per PHP 8.2/8.5, single-site and two network sites; the same
matrix passes on PHP 8.5 from the independently installed package. It combines
schema with redirects and maximum 25-item batches, kills owned workers before/
after commits in forward/inverse work, erases direct attribution and replays only
the exact original recovery confirmation. No duplicate website writes or new
approval are allowed. All runners report owned database cleanup.

Reproduce using `node test/workflow-package.mjs --allow-network
--native-schema-history-recovery-mixed` with the explicit owned native settings
below. These tests exercise the existing schema policy; they do not change or
close the separate public field/redirect-history API, full privacy UI/download,
retention or other remaining Phase 4 gates.

## Installed field workflow acceptance

`test/workflow-package.mjs --allow-network --native-fields` now runs the extracted
development entry against actual owned WordPress, not only the synthetic package
server. Supply `TAMRANK_MAINT_PRO`, `TAMRANK_MAINT_CORE`, `TAMRANK_MAINT_FREE`
and the guarded own `TAMRANK_SCAN_TEST_SOCKET`; optionally select
`TAMRANK_TEST_PHP`. No customer database or live plugin configuration is used.

The extracted entry has a separate install with a clean npm cache and repository
lock. A test-only selector verifies the owned install, matching entry hash and
real directories; an explicit invalid package path never falls back to checkout
code. The normal npm bin/version remain unchanged and install scripts are disabled.

582 native checks pass per PHP 8.2/8.5 on macOS/Node 22, over core/specialist,
both REST forms, single-site and two-client multisite. Metadata/social/alt
proposal, approval, writes, audit, lost committed response, readback, exact retry
and newly approved rollback are checked against native rows. Real request limits
are retained. Both runs remove their own databases/package/cache and the full
workflow regression suite passes.

The separate stored-read acceptance below covers installed full target reads.
On 12 September, `test/workflow-package.mjs --allow-network --native-redirects --native-schema`
also completed on PHP 8.2/8.5: all seven installed redirect execution/recovery/batch
and schema rollback/recovery/mixed/late-authority modes passed through verified TLS
and owned single-/multisite WordPress. The original audit/approval and exact-target
assertions remain intact; the runners removed their own databases/package/cache.
These matrices used PRO `d175587`, not the subsequent PageSpeed-worker increment.
Other platforms, unconstrained dependency resolution,
privacy, hosting, upgrades, onboarding and release activation remain open.
Full updated evidence: `samkl8/tamrank-pro`, `feat/mcp-scan-dispatch`,
`docs/mcp-phase4e-installed-workflow.md`.

## Approved PageSpeed jobs through the existing specialist tools

The separate `pagespeed_execution` capability enables `start_scan` preview →
plan → explicit chat approval → run. Copy the frozen `proposal_id`, hash and all
acknowledgements; keep the same execution request ID after an uncertain reply.
Show **all** selected URLs, both device strategies and warnings before approval.
MCP re-reads the exact proposal before transmitting consent. No automatic retry,
replacement scan, schema-source consent crossover or legacy execution fallback.

Use `get_scan_status({type:'pagespeed', execution_id:...})` for private progress,
or `proposal_id` for the original proposal. All 25 URLs and 50 device outcomes
are retained. Untyped execution IDs keep their existing administrative route.
Queued does not prove worker liveness. Uncertain attempts retain their reservation;
reads never schedule or measure. Results are private, not copied to legacy caches
and not presented as an SEO outcome. Client provenance comes from the MCP handshake;
the agent label is unknown. Current site rights remain authoritative.

`test/workflow-package.mjs --allow-network --native-scans` passes 261 native MCP
checks per PHP 8.2/8.5 from the extracted package with separate dependencies.
Owned WordPress single-/multisite, both REST forms, full batches, lost admission
reply, exact replay, foreign actor, revoked original key, duplicate event and
unknown provider result are covered. DNS/Google responses are fictitious; the
MCP→WordPress path is loopback HTTP. Real cron hooks are delivered by an owned
CLI control plane, not by a newly exposed product endpoint. Host cron delivery,
provider/cache integration and wider privacy/upgrade/platform acceptance remain
open. All own databases/package/cache were removed. No normal-entry activation.

PRO source/contract: `samkl8/tamrank-pro`, `feat/mcp-scan-dispatch`,
`docs/mcp-phase4b-pagespeed-worker.md`. Bridge regression: `npm run test:workflow-scans`.
The full workflow regression passes; the largest tested specialist catalog is
15,786 of 16,000 characters, with 12/20/42 tool counts unchanged.

## Installed stored-read acceptance

Use `test/workflow-package.mjs --allow-network --native-reads` with the same
explicit owned test settings above. The actual extracted development entry,
separate locked dependency install and new WordPress database pass on PHP 8.2
and 8.5: 1,224 native WordPress/PAT checks per run plus real MCP assertions.
This single-site matrix uses loopback HTTP; it is not a TLS or multisite claim.

All 205 task targets are returned through canonical and temporary legacy reads,
with identical results and no four-item truncation. Search, GSC/keyword periods,
redirects, images, diagnostics and topical advice retain full pagination. Both
REST forms, 12/20/42 profiles, invalid cursors, hidden pages and current PAT/PRO
checks are covered. Full-request snapshots remain unchanged except ordinary
PAT-use/read quotas. Scan previews expose 25 exact selected targets without
dispatch, background jobs or new approval. Missing evidence is not made up.

PRO `docs/mcp-phase4e-read-wordpress.mjs` creates the owned fixture with root/DB/
socket/bootstrap checks; no old fixed clone or customer configuration is loaded.
The package and native fixtures clean up on completion, and the full MCP
workflow regression suite passes. Normal entry activation, scan host/provider acceptance,
multisite reads and the remaining privacy/hosting/release gates stay open.

## Current schema rollback development

### Source capacity and waiting

Do not promise immediate schema rollback. It needs fresh, separately approved
source captures, which share the site's rolling-hour source limits with forward
work. Explain this limitation before asking for approval of a larger schema set.
Source acquisition capacity is separate from website-execution capacity; stored
approval does not reserve later captures or authorize a delayed write.

The PRO `feat/mcp-source-quota` increment exposes
`schema_source_jobs.hourly_budget` through specialist `get_capabilities`.
It reports effective `remaining_requests`, `observed_at`, `next_attempt_after`
and `retry_after_seconds`, with `is_reservation:false` and `automatic_retry:false`.
This is a current snapshot, not guaranteed capacity. Older sites may omit this
field: missing information is unknown capacity, not unlimited or zero usage.

On `schema_capture_rate_limit`, the error may supply a bounded `retry_after`
of 1–3600 seconds. Wait before rechecking; never start a replacement automatically.
The inclusive rolling-hour boundary can require 3601 seconds, shown by the exact
capability snapshot. Recheck rights, source revision and proposal validity after
waiting; obtain a new proposal and new consent when required. Never reuse expired
source evidence or forward approval for rollback.

`node test/workflow-package.mjs --allow-network --native-schema-sources`
passes 963 native checks per PHP 8.2/8.5, plus the existing package baseline.
It selects the independently extracted workflow entry and its own installed
dependencies, checks both REST styles and single-site/two network clients,
and verifies source-capacity readback around two genuine native captures.
PRO source: `samkl8/tamrank-pro`, branch `feat/mcp-source-quota`,
`docs/mcp-phase4b-source-budget.md`. Integration into the main development branch
is still pending; this does not activate customer writers or publish a package.

### Inverse workflow

The public inverse lane is implemented behind the additional server flag
`TAMRANK_WORKFLOW_SCHEMA_ROLLBACK_REST_ENABLED`; its targeted native matrix
passes on PHP 8.2/8.5. The earlier baselines below predate this implementation.
Do not activate customer writes. Journal recovery has a separate opt-in below.

When the site advertises `schema_execution.rollback_available:true` and
`rollback_preview_contract: schema_rollback_preview_v1`:

1. Select original execution item IDs. Obtain fresh approved source jobs only
   for the schema items to restore; no implicit scan or expired capture reuse.
2. `rollback_change_set({change_set_id,item_ids,source_jobs})` compares current
   values with the original audit. `source_jobs` maps ORIGINAL item IDs to
   `{job_id,revision}`; use `{}` for a field-/redirect-only subset of schema history.
3. Copy the returned `proposal_input` and add a stable `client_request_id` to
   request a stored inverse proposal. Its `expected_revision` binds the complete
   native comparison. Selected IDs are canonicalized, but actual restoration
   remains in reverse original order. No automatic replanning on conflict.
4. Show all changes/warnings, obtain NEW chat approval, then execute the new
   inverse set/token/hash and copied acknowledgements with `execute_change_set`.
5. Read inverse and original history with `get_changes(kind:execution)`.
   Never reuse forward approval, replay writes automatically or overwrite later edits.

346 targeted inverse bridge/SDK checks pass. The expanded catalog matrix passes
85,848 equivalence checks; largest tested specialist profile is 15,786 of 16,000
characters. It omits only the SDK-documented forbidden task-support default;
actual handlers, schemas, constraints and 12/20/42 tool counts are preserved.
The full MCP regression suite passes. The complete native matrix passes
4,203 checks per PHP 8.2/8.5 across single-site and two-client multisite.
Journal recovery and wider acceptance remain separate gates.

## Schema journal recovery (development opt-in)

`src/schema-recovery.js` defines the closed `workflow-schema-recovery-1`
proposal, new chat confirmation and result checks. It retains all 25 possible
participants, distinguishes stop-pending from delivery-only, validates the
replacement actor and original execution, and rejects any repeated website
write. `node test/workflow-schema-recovery.mjs --bridge` passes 561 semantic,
bridge and SDK checks and is part of the full green workflow suite.

The existing tools connect this policy only when the site advertises
`schema_execution.recovery_available:true` with
`recovery_contract:schema_journal_recovery_v1`. WordPress additionally requires
its default-off `TAMRANK_WORKFLOW_SCHEMA_RECOVERY_REST_ENABLED` flag. This can
be enabled while new forward/inverse writers and source capture remain off.

1. Read the original set with `get_changes(kind:execution)`, then request
   `get_changes(kind:recovery)` for its exact ID.
2. Show every retained/skipped item and the required acknowledgements.
   Obtain NEW explicit chat approval; the original website approval is not enough.
3. Call `execute_change_set` with the copied `recovery_plan`, set ID,
   `trscr1` token and `confirmation:{plan_hash,confirmed:true,acknowledgements}`.
4. Read back the same execution. An active worker refuses recovery; committed
   writes/audits remain intact, unstarted work is skipped and missing cache work
   may be retried without repeating website changes. Never retry automatically.

`test/schema-recovery-native-client.mjs` now exercises actual killed-worker
journals over SDK/TLS/WordPress. The full targeted matrix passes 1,260 native
checks per PHP 8.2/8.5 across single-site and two-client multisite.
An additional native matrix covers the maximum 25-item reservation and mixed
schema/redirect-create recovery, including inverse partial results in both
operation orders: 1,194 checks pass per PHP 8.2/8.5 over single-site/multisite.
Other mixed/native, privacy, hosting and full Phase 4 acceptance remain open.
No customer capability has been activated.

The native `--schema-recovery-authority-mcp` matrix now keeps the same MCP
session open after a valid recovery preview while the parent changes the exact
owned replacement token, management scope, local admin membership or stored
PRO entitlement. All four faults refuse execution before changing the journal,
original approval/reservation, audits or website values. Exact fixture rights
are restored and a newly approved recovery succeeds. Both forward/inverse
interruption cases pass over single-site/two-client multisite on PHP 8.2/8.5:
1,236 native checks per version, including shared setup. Core/pretty and
specialist/query are exercised, not every Cartesian combination. The full
workflow regression suite also passes. This does not close later transactional
authority changes, unreadable history, privacy, hosting or installed-package
acceptance; no product writer or permission gate was relaxed.

The extracted archive also passes clean-cache installation with the repository
lock, installed 12/20/42 profiles and both REST forms. The package test explicitly
checks schema contract files and keeps website/scan writers unavailable; it is
not itself an installed-package native-write or unconstrained registry-resolution
test. The separately invoked native-field extension above adds field writes only.

## Native forward schema workflow (development opt-in)

The separate server flag `TAMRANK_WORKFLOW_SCHEMA_EXECUTION_REST_ENABLED`
connects typed schema proposals and immediate, explicitly approved execution.
It requires installed native source/execution storage, the schema runner and
item/delivery gates, ordinary execution readiness and Action convergence.
Do not enable it on customer sites while acceptance remains open.

When `schema_execution.available:true` advertises an operation, use the native
preview's complete typed item (including `source_job` and `expected_revision`)
in `plan_changes({client_request_id,origin,items})`. Schema selection/detection
can be combined with separately authorized metadata/social/alt and redirects,
up to 25 distinct targets. Site identity is always one standalone user request,
with confirmed facts. No raw JSON-LD, database rows or callbacks are accepted.

Show all changes and warnings, obtain explicit chat approval, and pass the exact
`change_set_id`, `change_token` and `confirmation:{plan_hash,confirmed:true,
acknowledgements}` to `execute_change_set`. Copy acknowledgements from the plan;
do not infer approval. The MCP handshake supplies the client label, the server
timestamps the attestation, and `human_verified` stays false. Read the same set
after uncertainty; there is no automatic retry, legacy writer fallback or
silent conversion to a private draft. Responses retain all targets and semantic
schema samples but omit private execution proofs.

No new tool was added. Schema support must not activate an unrelated field,
redirect, rollback or recovery token. Rollback/recovery require the additional
opt-ins described above. Source acquisition remains the separate approved specialist scan
workflow described below; this execution call never silently starts a scan.

`test/workflow-schema-execution.mjs` passes 192 mapping, approval, exact-response,
capability and SDK checks. The full catalog matrix passes 61,785 equivalence
checks; the fully combined specialist surface is 15,976 characters (limit
16,000). Native WordPress/MCP forward acceptance passes 2,343 combined checks
on each of PHP 8.2 and PHP 8.5 across single-site and two-client multisite.
Native inverse cleanup is not
public schema rollback acceptance. See PRO
`docs/mcp-phase4d-execution.md`, section "Public forward schema proposals and
execution — 12 September 2026" for current evidence and remaining gates.

## Schema inverse transport correction

Native inverse IDs survive the transport only in the exact envelope field of a
fully validated semantic schema-rollback response on an execution route. Private
scan receipts sharing the prefix remain redacted everywhere else, including
metadata and errors. The correction adds 67 real transport checks to the normal
workflow suite. The extended native read matrix passes 5,058 combined checks on
PHP 8.5; the PHP 8.2 matrix is still running. It now includes actual MCP reads of
planned/completed/partial inverse records, field-only inverse subsets and mixed
schema/redirect restoration, plus reciprocal audit links and other-owner refusal.
Public schema rollback/recovery remain unavailable. See PRO
`docs/mcp-phase4d-execution.md`, "Schema inverse read transport — 12 September 2026".

## Native schema history reads (development opt-in)

With `schema_execution.contract_version:1`, `read_available:true`,
`record_contract:schema_execution_view_v1` and `private_proofs_omitted:true`,
the existing `get_changes({kind:"execution",change_set_id})` reads native schema
forward/inverse records. All targets, exact changes, schema samples, original
chat-attestation stub, item outcomes and audit/reversal links remain visible.
Raw database/source/restoration proofs and cache receipts are not tool output.
The original hash/token cover the full stored plan, including omitted proofs;
do not hash the displayed subset or submit it as a native execution envelope.
Stored approval remains an agent assertion, not verified human identity.

This read capability alone permits reads ONLY; it does not activate the separate
forward writer above, rollback or recovery. No extra tool, source scan or automatic retry.
The server requires `TAMRANK_WORKFLOW_SCHEMA_EXECUTION_READ_ENABLED`, existing
read-route readiness/storage, current audit-read rights and the same owner/site.
A same-owner read-only PAT can inspect history without gaining schema-write
permission. Restart the bridge after capability changes.

PRO `--schema-public-read` passes **4,842 combined checks per PHP 8.2/8.5**,
single-site and two-client multisite, including prior native runner/recovery
checks. Actual MCP/verified TLS/WordPress reads cover planned/executed records,
both profiles/REST forms, repeated reads and other-owner refusal. All projected
native matrix records also pass the bridge validator, including 25-item and
mixed inverse sets. Inverse redirects keep their real row pairs and new-ID
requirement; they are not forced into a page-URL shape.

`test/workflow-schema-execution-read.mjs` adds 275 contract/capability/SDK
checks. The full workflow suite passes 50,559 catalog-equivalence checks;
the full redirect/schema-read specialist catalog is 15,993 characters.
Clean-cache extracted-package installation passes with the repository lock
and scripts disabled; the offline attempt lacked a cached dependency.
These results do not prove public schema writes or general hosting/privacy
acceptance. Full Phase 4 remains open.

## Native schema preview (development only)

When the server explicitly advertises `schema_preview.available` with contract 2,
`plan_changes` accepts `schema_preview` **alone**, containing the typed REST item
`{operation, target, fields}`. The operations are `schema.select`, `schema.detect`
and `schema_settings.update`. Do not mix this with a request ID, origin, draft
items or execution. A current native source-job receipt is required; an ordinary
HTML source job cannot replace it. Initial previews omit `expected_revision`;
returned items bind the exact server-derived revision. No raw JSON-LD or invented
business facts are accepted. This compares only: no new source request, stored
plan, approval or execution, and no automatic retry.

The matching PRO route requires `TAMRANK_WORKFLOW_READS_ENABLED`,
`TAMRANK_WORKFLOW_SCHEMA_CAPTURE_ENABLED` and
`TAMRANK_WORKFLOW_SCHEMA_PREVIEW_REST_ENABLED`, plus all four scopes
`site:read`, `changes:write`, `schema:write`, `scans:plan`. Native source planning
and schema proposal storage each have the separate opt-ins below. Do not activate this
on customer sites. Restart the bridge after changing advertised availability.

The enabled core/specialist catalogs with schema storage, field execution and recovery are 10,330/15,999 characters; adding redirect execution/recovery gives 10,324/15,993, within the
16,000-character budget. Local JSON Schema references and removal of redundant
type/dialect information preserve all fields, limits and SDK validation. Unknown
dialects/vocabulary are not rewritten. `test/workflow-catalog.mjs` checks every
schema against independent validators and verifies the enabled specialist budget.

The PRO command `node docs/mcp-phase4c-change-store-wordpress.mjs --schema-preview-mcp`
with the documented owned database/core/FREE variables and `TAMRANK_MAINT_MCP`
tests the joined chain: actual stdio, native fetch, verified local TLS, normal
WordPress REST boot, both profiles/URL forms and single-/multisite. It passes 732
checks per PHP 8.2/8.5. The test supplies the native source receipt; only the test
process maps DNS to loopback and trusts its temporary CA. This does not prove
general hosting, builder, cache or competing-schema compatibility. Details are in
`samkl8/tamrank-pro`, branch `feat/mcp-workflows`,
`docs/mcp-phase4c-schema-selection.md`.

### Native source acquisition (separate development opt-in)

`start_scan` accepts `capture_mode: native_render` for schema-source preview/plan
only when advertised in `schema_source_jobs.capture_modes`. Legacy source jobs
omit the field and retain their original hashes. A native plan may additionally
request `probe_content:true`, only with `probe_content_available:true`. That
adds `additional_content_filter_pass` to the four original acknowledgements.
Show the returned exact target, extra-pass warning and proposal before seeking
chat approval. Run uses the saved job and exact plan hash; never repeat or change
capture/probe fields during run. No transcript is stored; client/agent provenance
is an attestation, not independently verified human approval.

The PRO source route additionally requires
`TAMRANK_WORKFLOW_SCHEMA_NATIVE_SOURCE_REST_ENABLED` and
`TAMRANK_WORKFLOW_SCHEMA_RENDER_CAPTURE_ENABLED` strictly true. All normal source
route flags, installed storage and scope checks still apply. No website/schema
write is enabled. Responses never include private HTML/render observations.

`test/workflow-source-scans.mjs` covers source/native/native-probe over real
stdio/HTTP with synthetic API responses, both URL forms and uncertain results
without automatic retry. The PRO `--schema-native-source-rest` fixture separately
passes 648 checks per PHP 8.2/8.5: real REST dispatch through native storage to an
independent TLS frontend and back into schema preview, single-/multisite. Its
fixed test DNS/port/environment are injected, not the returned HTML.

The joined chain is now tested by PRO `--schema-native-source-mcp` and
`test/schema-source-native-client.mjs`: 936 checks per PHP 8.2/8.5, both REST URL
styles, single-site and two-client multisite. Real stdio/HTTPS REST creates and
runs the source job; a separate PHP server renders the actual frontend over TLS.
The test counts every frontend attempt, verifies exact chat stubs and replay,
compares the MCP result with an independent native database read, and checks that
page/metadata remain unchanged. No prebuilt source receipt or successful HTML
is supplied. Only the fixed test DNS/port/environment and temporary CA trust are
injected. General host/output acceptance remains open. The separate private
schema proposal route is described below. See PRO `docs/mcp-phase4c-schema-capture.md`.

### Private native schema proposals (development opt-in)

With `schema_preview.schema_proposals_available:true` and the exact operation in
`field_proposals.operations`, use the preview's `proposal_item` unchanged inside
`plan_changes({client_request_id,origin,items})`. Its `expected_revision` is
mandatory when saving. `schema_preview` remains a separate compare-only request;
never mix it with draft fields. Read the resulting private set using `get_changes`.

The PRO flag `TAMRANK_WORKFLOW_SCHEMA_PROPOSALS_ENABLED` requires the existing
field-draft and native-preview gates, installed private stores and current
schema/scan-plan permissions. New schema proposals require native renderer
evidence; old HTML-only internal drafts cannot bypass that by replaying their
request ID. Historical native replay is not current-source revalidation.
Storage records no approval and exposes no executor. Site identity is one
standalone user-request item with `facts_confirmed:true`; page schema retains
the canonical Action contract. Do not invent business facts or supply JSON-LD.
Duplicate WordPress targets, including mixed schema/metadata, are refused.

PRO `--schema-proposals-mcp` and `test/schema-proposals-native-client.mjs` pass
888 checks per PHP 8.2/8.5, all three operations, both REST URL styles,
single-site and two-client multisite. The fixture prepares actual native source
receipts; the separate 936-check acquisition suite verifies creating them through
MCP. Draft/read/replay preserve the native comparison and leave website and source
jobs unchanged. Old preview-only mode and metadata/redirect chains remain tested.
`test/workflow-schema-proposals.mjs` covers closed input, exact revisions, origin,
mixed targets and capabilities. The catalog suite now has 16,228 equivalence checks.
The extended suite now passes 1,986 checks per PHP 8.2/8.5, including public canonical
Action origins for post IDs and both URL target kinds. It verifies exact native
task evidence, changed-task/member refusal with no partial storage, private-source
isolation, unchanged history and the actual MCP/TLS chain for select/detect.
Completed fixture drafts are cancelled through
the ordinary lifecycle, without raising product storage or HTTP limits.
The separate `--schema-batch-mcp` PRO fixture with
`test/schema-batch-native-client.mjs` now passes 1,443 checks per PHP 8.2/8.5.
It covers eight independent native schema receipts and an exact 25-item
schema/metadata Action-bound set, both URL styles, single-site/two-client multisite,
later-item conflicts, missing metadata scope, storage failure after two inserts
and full rollback followed by safe same-ID retry. Website fields remain unchanged.
The 25-item proposal bound does not raise source acquisition quotas or source TTL.
Remaining acceptance includes full source/output/host/cache/privacy compatibility. 4C remains open;
execution and rollback belong to 4D.

The separate PRO `--field-execution-worker` mode and
`test/field-execution-worker-client.mjs` pass 99 checks per PHP 8.2/8.5 over
real stdio/HTTPS and single-site/two-client WordPress. The owned PHP worker is
actually killed after the first item commit and restarted. Readback preserves
the running record without writes; explicit reconciliation skips pending items
even within the original lease. Exact replay adds no fields/audits or consent.
A newly approved rollback restores only the applied item. The extended suite
passes 177 checks per PHP 8.2/8.5, adding actual worker death immediately before
the first item COMMIT: native field/audit/receipt writes roll back together,
committed admission and its budget remain, explicit recovery skips all items,
and rollback of an uncommitted item returns `rollback_unavailable`. This does not
prove revoked-owner/unreadable-journal recovery or death inside every transaction.

An earlier worker-suite milestone totalled 306 checks per PHP 8.2/8.5, adding actual interrupted
execution with revoked PAT. MCP rejects the old token; a separate native PHP
recovery proposal binds a valid same-owner replacement token and exact verified
journal, with zero website writes. This `trfr1` proposal is not an execute token,
not stored approval. At that milestone atomic recovery, new attestation and
privacy/retention integration were still open; see the current recovery lane below.

The next worker-suite milestone passed 471 checks per PHP 8.2/8.5: native, separately
approved recovery stops pending items atomically without field/audit writes and
preserves the original admission. Busy independent execution locks, three-table
faults, late native token revocation, lost COMMIT replies and exact/conflicting
replays are covered. Actual stdio/HTTPS `get_changes` with an audit-only token
reads both original and recovery attestations. Recovery was native-only at that
milestone; subsequent delivery/privacy/retention and MCP acceptance are below.

## Exact recovery through existing tools (development opt-in)

When contract-1 `field_execution` advertises both `recovery_available` and
`read_available`, use `get_changes({change_set_id,kind:"recovery"})` for a signed,
read-only stop proposal. Show its exact item dispositions and obtain NEW chat
approval. Then call `execute_change_set` with the same `change_set_id`, copy the
returned `plan` as `recovery_plan`, its `recovery_token` as `change_token`, and
`confirmation:{plan_hash,confirmed:true,acknowledgements}` using the returned
hash and exact ordered `required_acknowledgements`. Do not edit the returned plan.

The bridge posts to the separately gated `/changes/executions/{id}/recover`,
not the field execution endpoint. It derives `mcp-recover-{plan_hash}` as the
stable request ID and records bounded, unverified MCP client provenance, unknown
agent identity and chat attestation. No transcript or verified-human claim.
The server verifies its signature, fresh authority and actual journal state.
Recovery stops pending items and retains applied items; it never reapplies fields
or implicitly rolls them back. Authorized cache/Action delivery can finish after
the stop. A failure can occur AFTER that stop commits: read `kind:"execution"`
before any exact retry, never call a legacy writer or retry automatically.
Recovery may be available without authority to start new field execution.

Verified: 92 bridge/SDK checks and 858 native worker checks per PHP 8.2/8.5 across
single-site and two-client multisite. The latter includes actual PHP worker death,
stdio MCP plus verified TLS, a same-owner replacement PAT, fresh recovery preview,
new chat attestation, native stop/delivery, exact replay/readback, and the existing
revocation/privacy/retention/rollback fault matrix. All fields are synthetic.
The catalog remains 12 core / 20 specialist / 42 legacy tools; instructions are
1,459 characters. This does not close whole-request WordPress privacy, all-applied
delivery-only recovery, unreadable evidence, other-owner recovery, host/cache,
large-history admission, redirect/schema writers or complete Phase 4 acceptance.
Feature gates, normal entrypoint and package version remain unchanged.

## Exact redirects and mixed sets (development opt-in)

With contract-1 `redirect_execution.available:true`, `plan_changes` creates
a native execution proposal for `redirect.create`, `redirect.update` and
`redirect.delete`. Field/redirect mixtures additionally require
`mixed_available:true` and every operation in the advertised list. Field-only
plans keep their existing contract. Source-only drafts never become executable.

Use the returned record's exact `envelope.plan.change_set_id`,
`envelope.change_token` and `envelope.plan_hash` for `execute_change_set`.
After showing ALL targets, values and warnings and obtaining chat approval,
supply `confirmation:{plan_hash,confirmed:true,acknowledgements}`, copying
`envelope.plan.required_acknowledgements` exactly (including an empty array).
The bridge never invents deletion approval. Rollback still means a NEW proposal,
NEW chat approval and execution, not an immediate undo tool.

For recovery, `get_changes({change_set_id,kind:"recovery"})` returns a signed
redirect recovery plan when current read/management rights allow it. Copy that
plan/token/hash and exact acknowledgements using the recovery call described
above. `stop_pending` retains applied items and stops pending ones;
`delivery_only` only finishes delivery for already-applied work and may remain
`running` if that delivery cannot complete. Neither mode repeats website writes.
The server remains authoritative for signatures, live rights, item sources and
history. Use `get_changes(kind:"execution")` after an uncertain result;
there is no automatic retry or old-writer fallback.

The PRO flag `TAMRANK_WORKFLOW_REDIRECT_EXECUTION_REST_ENABLED` is default off
and requires the native writer/storage/runner/delivery opt-ins; rollback and
recovery have separate native gates. Restart after capability changes. No
customer configuration is changed, no new tool is added, and full V2 readiness
is not advertised. Pure redirect writes do not require metadata rights.

Verified: 144 bridge/SDK checks; **892 native MCP/TLS checks per PHP 8.2/8.5**
using PRO `--redirect-execution-mcp` and
`test/redirect-execution-native-client.mjs`. Actual native redirects/metadata,
fresh-ID restoration, both profiles/REST forms, single-/two-client multisite,
owner/client isolation, lost committed replies, real worker death before/after
COMMIT, revoked original PAT, new replacement-token recovery and approved
subset rollback are covered. No execution results are injected. All data and
servers are owned synthetic fixtures; frontend routing is not verified.

39,453 catalog equivalence checks include the combined schema/field/redirect
profiles. An extracted package with clean-cache, locked `npm ci` and scripts
disabled starts correctly; that package smoke test is not native execution
acceptance or a test of unconstrained dependency resolution. The real-404 Action
and 25-item scenarios have their own native matrix below. Remaining work includes
other source/connection/late-authority cases, further worker/cache boundaries, redirect privacy/retention,
schema execution and general host/release acceptance. See PRO
`docs/mcp-phase4d-execution.md` on branch `feat/mcp-workflows`.

The separate PRO `--redirect-recovery-mcp` mode and
`test/redirect-recovery-native-client.mjs` pass **1,152 native checks per PHP
8.2/8.5**. Seven scenarios cover inverse deletion/restoration mixed with metadata,
actual worker death before/after the first COMMIT and after all item commits,
fresh restored row IDs, reciprocal audit integrity, and a revoked original PAT
after a fully-applied forward batch. Every recovery obtains a fresh chat
attestation through the existing tools. A real committed recovery response is
then dropped: the client reports uncertainty, reads the existing result and
does not automatically retry. Explicit replay adds no website/audit writes;
only a newly-approved rollback may reverse remaining original items. These are
owned single-site/two-client multisite fixtures. Runtime flags and product
quotas are unchanged. This does not complete privacy/retention, arbitrary cache
transaction interruption, schema execution or general host/release acceptance.

### Full batches and real queue provenance

PRO `--redirect-batch-mcp` uses `test/redirect-batch-native-client.mjs` through
actual stdio, verified owned TLS and WordPress on a standalone site and two
network clients. Run it with the same explicit core/FREE/MySQL variables as the
other native modes and `TAMRANK_MAINT_MCP` pointing to this checkout. Both core /
pretty and specialist / query routes are exercised. All data are fictitious.
The full matrix passes on PHP 8.5 (792 checks) and PHP 8.2 (783 checks). Scenario
coverage is the same; the total includes variable native quota-wait assertions.

- An actual FREE 404 observation becomes a canonical Action via the real task
  adapter. Stale revision/hash and removed-source proposals are refused. A newly
  approved redirect resolves that Action; newly approved rollback reopens it.
  Both native audits retain its identity. Queue responses are not injected.
- Exactly 25 long-path redirects, and 24 large Unicode metadata values plus one
  redirect, survive full preview, execution, readback and replay. Native rows,
  assigned IDs and 25 audit entries are independently compared. All 25 inverse
  items run in the reverse order with separate approval and 25 further audits;
  the 26th forward or inverse item is refused.
- Actual Unicode execution responses peak at 710,183 bytes on a root site and
  716,161 bytes on the second client's subpath. The existing 1-MiB execution-route
  response cap and 256-KiB plan bound are unchanged. Test telemetry stores only
  bounded route/status/byte counts, never payloads or credentials.

PRO's bounded verification reuse fixes the repeated historical checks that
caused the first heavy rollback to hit PHP's 30-second limit. Current rights,
rows and audits are rechecked; no approval or mutable history is cached across
reads. A separate 663-check native REST matrix on PHP 8.2/8.5 tests changed stored
proofs, counterpart audits and fresh SQL failures after a successful read.
The test never re-executes an uncertain write: it reads the same set and requires
terminal state plus actual native comparisons before accepting success. Known
pre-admission quota refusals are paced without changing product limits.
This is not frontend routing, customer activation or general hosting acceptance.

## Entry and profiles

Run `node index-workflow.js` explicitly with site-local `TAMRANK_PAT` and
`TAMRANK_SITE_URL`. HTTPS is required except literal loopback HTTP for tests.
`TAMRANK_REST_STYLE=query` supports the query-string REST form; default is pretty.
`TAMRANK_TIMEOUT` is milliseconds, 1–120000, default 30000.

The plugin must expose contract 2. Incomplete compatibility is refused unless
`TAMRANK_WORKFLOW_PREVIEW=1` explicitly selects development workflows. The matching
FREE/PRO branches require their server-side read flag; a client cannot enable it.
Do not enable this preview on customer sites yet.

`TAMRANK_TOOL_PROFILE` is `core` (default, 12 names), `specialist` (20 names), or
`legacy` (42 old names, opt-in for the planned 0.4.x minor only). Seven core reads
are connected: site context, capabilities, queue, signals, search, page, diagnosis.
`update_work_item` additionally supports explicit signal pickup, shared notes, research review/complete/reopen and manual complete/reopen
with `tasks:write`; `importance.update` uses the independent `importance:write` grant.
Both require the exact operation to be advertised in server capabilities.
Six optional specialists are connected: `get_gsc_pages`, `get_redirects`,
`get_images_missing_alt`, `get_site_diagnostics`, `get_topical_authority` and
passive `get_scan_status`, as described below. `start_scan` additionally supports
explicit PageSpeed preview and separately authorised private drafts. PageSpeed and
schema-source execution use their separately gated lanes documented above/below.
Index supports only the exact read-only preview described below.
`plan_changes` and exact-ID `get_changes` now support the separately gated private
metadata/social/alt and redirect subsets below. The three field operations also have
the separately gated execution bridge below; redirects/mixed sets use the new lane above. Remaining native MCP failure/owner acceptance,
index execution and Phase 4 remain open; there is no customer-site activation.

## Exact index preview — 14 September

`start_scan({type:"index",mode:"preview",post_ids:[205,1]})` reads 1–25 explicit
managed public pages, in full and in order. Optional `expected_revision` detects
changed stored evidence. Requires explicit index-preview site capability and the
existing PRO/administrator/site:read guards. No index `plan`/`run`, confirmation,
client-request-ID or legacy fallback is accepted.

The response shows stored property matching, any recorded job and shared manual
cooldown. No domain rewrite, Google call, job creation or approval happens.
Credits, cost, remaining quota and request ceiling stay unknown; selected URLs
are not a provider budget. No recorded job is not proof of completion.

Index execution remains in the original phase-4 scope. The inspected backend
still needs a durable idempotent start, complete job/result history and an enforced
per-job attempt budget before this preview can become an executable proposal.
PRO contract/evidence: `samkl8/tamrank-pro`, branch `feat/mcp-workflows`,
`docs/mcp-phase4b-index-preview.md`. Tests: `npm run test:workflow-scans` and the
PRO native single-/multisite read runners on PHP 8.2/8.5.

## Exact field execution bridge (development opt-in)

`field_execution` contract 1 advertises `available`, `read_available` and
`rollback_available` independently. Only `meta.update`, `social.update` and
`image_alt.update` enter this policy. A fresh `plan_changes` containing exclusively
advertised field operations now creates an execution-policy proposal at
`POST /changes/executions`; it does not record approval or change website fields.
Old private drafts and mixed/schema/redirect drafts remain non-executable.

Show the entire returned proposal and warnings, then obtain explicit approval in
chat. `execute_change_set` takes the exact `change_set_id`, `change_token` and
`confirmation:{plan_hash,confirmed:true}`. No replacement items or client identity
arguments are accepted. The bridge derives `client_request_id` as
`mcp-execute-` plus the immutable proposal hash, so exact retries retain identity.
The MCP handshake supplies a bounded client name/version (self-reported, not
verified identity); the agent name is explicitly `unknown`. The server records
the bounded chat-attestation stub with `human_verified=false`, not a transcript.

Use `get_changes({change_set_id,kind:"execution"})` for reconciliation, especially
after an uncertain response. Omitting kind or using `kind:"draft"` retains old
draft reads. No automatic POST retry or fallback to legacy writers occurs.
`rollback_change_set({change_set_id,client_request_id,item_ids})` creates a NEW
rollback proposal only. Show that exact proposal, obtain new approval, then use
`execute_change_set` with its new ID/hash/token. Newer intervening edits remain
protected by the native executor.

Only exact native execution method/route pairs accept contract 1 and responses
up to one MiB. Existing routes still require contract 2 and retain their existing
limits. Result reads/executions verify set identity; executions also verify the
returned proposal hash. The bridge cannot verify the server's private HMAC itself.
Metadata/social/alt execution and rollback require the PRO REST/storage/executor/
Action-convergence flags and current scopes; no client can enable these flags.

Verification: 104 execution bridge/real-SDK/owned-loopback checks plus the full workflow suite;
28,137 catalog equivalence checks with the maximal specialist profile under
16,000 characters, and shared instructions under 1,500. HTTP tests cover exact
one-MiB limits, wrong versions and no automatic retry. Native WordPress REST
execution/rights were tested separately (465 checks per PHP 8.2/8.5).

The PRO runner's `--field-execution-mcp` mode now invokes
`test/field-execution-native-client.mjs` through real stdio MCP and loopback HTTP
into a disposable WordPress installation. 564 checks pass per PHP 8.2/8.5 across
core/specialist, pretty/query URL forms, single-site and two multisite clients.
Independent database reads verify exact forward values/absence, no proposal or
invalid-approval field writes, three forward audits, original-field restoration
after separately approved rollback, and exactly three reversal audits. Repeating
either execution preserves results without further mutations/audits. Real client
handshake provenance and version-3 Action/cache receipts survive the entire chain.
The test waits for explicit native 429 windows; product limits and automatic-retry
behavior are unchanged. All runner-owned synthetic databases are removed.

This establishes the combined normal path. The PRO runner's additional
`--field-execution-tls` mode passes 582 checks per PHP 8.2/8.5 over an independent
owned TLS terminator. A temporary CA is trusted only by the MCP child; a client
without that CA is refused. No system trust or TLS verification is disabled.
The proxy drops one completed execution response per site after WordPress commits
all three fields/audits. The MCP reports uncertainty and sends no automatic retry;
an independent request counter verifies this. Explicit `get_changes(kind=execution)`
recovers the original result, and only a deliberate identical retry sends another
invocation, without further mutations/audits. Approved rollback still restores the
original values. Temporary CA files, listeners and synthetic databases are removed.

The separate `--field-execution-failures` PRO mode invokes
`test/field-execution-failures-client.mjs` and passes 136 checks per PHP 8.2/8.5
over HTTPS. Newer manual edits prevent both an old forward proposal and an already
planned rollback from overwriting them. Rejected preflight records no execution
approval. Other operators cannot read/execute the set, and a valid first-site token
is refused on the second multisite client. A connected client's cached availability
cannot override token revocation. Another valid audit-only token of the same owner
can still reconcile existing history, without obtaining write permission.

This does not cover worker death mid-batch, unreadable journals,
all concurrent edit/role-change timings, revoked-owner running-work recovery, schema/redirect writers,
host compatibility, privacy completion or release readiness. The server removes
available field tools from its pending list but keeps `full_v2_compatible=false`.

## Private field and redirect proposals (development opt-in)

Requires the PRO field-proposal flag, already installed private storage, native
site-admin/PRO access and explicit advertised capabilities. No client option can
enable server support. This does not activate the feature on existing sites.

`plan_changes` accepts `client_request_id`, `origin`, and 1–25 ordered items.
Origin is either `{kind: user_request, reference, summary}` or the exact
`{kind: action, action_id, revision, snapshot_hash}` supplied as `action_origin`
on a work-queue target. Discovery currently covers missing title/description/alt
tasks with fixed post/attachment IDs. Use one Action per proposal, never infer
IDs from URLs or pass the dashboard group ID as an Action UUID. The server checks
full current evidence and membership again; discovery is not write permission.
Existing research targets can also supply an exact WordPress `post_id` with
`url_mapping: exact_wordpress_roundtrip`. Keep the returned Action origin and
original URL together. `unmapped`/`unavailable` means no verified page ID: do not
guess a local ID or substitute a path from another property. Availability depends
on the server's verified core-cache runtime; unknown persistent caches are not
flushed. Automatic low-CTR targets also expose their existing per-page Action
origin; the full source proof is still required at planning time.
`meta.update` uses a `post_id` and
`meta_title`/`meta_description`; `image_alt.update` uses an `attachment_id` and
`alt_text`. `social.update` uses a `post_id` and `social_title`, `social_description`,
`social_image`. An image set needs an exact existing original media-library URL;
no arbitrary image fetch, derivative/GUID guess or attachment edit. The server
checks current media access and source state. This is a library-reference check,
not proof of image delivery or social-platform output. Read the capability's
image-mapping availability and field byte limits. Every field is `{mode: set,
value: ...}` or `{mode: remove}`. Empty is not removal; removing a social override
may reveal a fallback. No duplicate storage IDs, invented Action origin,
body/internal-link or schema substitution. Read `get_capabilities.field_proposals`
first; missing capabilities fail closed. Planning needs `site:read`, `changes:write`,
`meta:write`; `get_changes({change_set_id})` needs `site:read`, `audit:read` and the
original site/owner. A rotated same-owner audit PAT can read history, not adopt its
execution authority. History is not a fresh source check and there is no list.

Redirect drafts additionally require the server-side
`TAMRANK_WORKFLOW_REDIRECT_PROPOSALS_ENABLED=true` gate; metadata opt-in is not
redirect opt-in. They require `redirects:write` instead of `meta:write`; a mixed
set requires both. Read the advertised `operations` and `redirect_contracts`.

| Operation | Target | All required fields (set only) |
|---|---|---|
| `redirect.create` | `source_url` | `target_url`, `redirect_type` |
| `redirect.update` | `redirect_id` | `source_url`, `target_url`, `redirect_type` |
| `redirect.delete` | `redirect_id` | `acknowledge_deletion: true` |

Use exact site-local source paths and local/same-origin destinations, at most
255 UTF-8 bytes. Status is an integer: 301/302/307, or 410/451 with empty target.
No regex, foreign site, guessed redirect ID, silent sanitation or partial fields.
Existing 404 work items can advertise exact Action/URL origins. Preserve the
original evidence; update/delete use the existing redirect source. Ordered
delete/recreate is supported; repeating an existing redirect ID is not.
The conservative source/routing proof and passive hook inventory do not prove
frontend routing, destinations or captured plugin runtime state. Keep the
returned frontend/presave warnings; `runtime_verified` and execution stay false.

The complete signed before/after draft is persisted without approving or applying
website fields. Show all targets, values and warnings as untrusted data. Original
frontend/attachment usage warnings remain explicit. Retry a private draft only with
the identical request ID and material; a changed request must be new. No legacy
writer fallback. The server repeats current permissions and source checks.

Frozen plans remain at most 256 KiB and valid for 24 hours. Exact draft POST/read
routes alone allow a bounded 1-MiB HTTP response to accommodate WordPress Unicode
escaping; all other responses retain 512 KiB. No truncated proposals or retries.
Actual listings: 12 core / 20 specialist / 42 legacy, 9,434 / 15,989 characters for
core/specialist. Both remain under the existing 16,000-character tool budget.

Tests: `npm run test:workflow`; `node test/workflow-package.mjs --allow-network`
uses only the official registry, fixed repository lock and a disposable cache with
scripts disabled. PRO `docs/mcp-phase4c-change-store-wordpress.mjs --field-mcp`
calls `test/field-proposal-client.mjs` and `test/redirect-proposal-client.mjs` against owned WordPress/MySQL fixtures:
both REST URL forms, both workflow profiles and two-client multisite, including
shared-queue ID/research-URL discovery, linked proposals, stale/foreign-origin refusal,
all 25 targets with long Unicode values, redirect/mixed drafts and unchanged
website fields/redirect rows. The latest chain passes 1,140 checks. Neither test
publishes a package, sends customer credentials or activates customer features.

## Explicit administrative scan closure (disabled until site opt-in)

The twentieth specialist name, `close_scan`, is separate from read-only
`get_scan_status({execution_id})` and from scan starts. Review every URL/device,
both actors, hashes and warnings, obtain explicit chat consent, then send only
that exact execution ID, request ID, expected runtime hash and confirmation.
Confirmation contains `mode: "chat_attested"`, `review_hash`, `confirmed: true`,
client name/version (version may be null), agent name and the four returned
`required_acknowledgements` unchanged and in order. No standing consent or human
identity claim. Closure preserves original history and labels the outcome unknown;
an in-flight provider may continue. It never remeasures or writes website content.

The separate `/scans/maintenance/capabilities` endpoint verifies current local
administrator/PAT authority with explicit `site:read` + `scans:maintain`, even
without PRO. The matching server gate remains off. In explicit development
specialist mode only, a primary `pro_required` denial can enter maintenance-only
mode: capabilities, exact execution review and closure; all other tools refuse.
Authentication/network failures never use this exception. Core/legacy gain no
maintenance writer; all actual operations recheck server rights.

No automatic retries. An uncertain POST requires reading the same execution's
history; replay only the identical input/ID. A different review/actor requires new
consent. REST and MCP redact private receipt packets from historical output.
The maintenance REST ingress now separately counts admitted requests, with distinct
read/close limits per operator and site. Pure authority/history readers still do
not write; a complete HTTP GET records only operational allowance. A 429 exposes
bounded wait guidance and `automatic_retry: false`, including when discovery is
limited after a primary paid-access denial. No automatic wait or retry is added.
Counter failure refuses the business action; a lost counter commit acknowledgement
can still consume a unit. This is not evidence about an earlier uncertain closure.
See PRO repository, branch `feat/mcp-workflows`,
`docs/mcp-phase4b-scan-maintenance.md` and `docs/mcp-phase4b-maintenance-budget.md`
for the full contract, fixed-window limits and verification gates.
Tests: `node --test test/workflow-scan-maintenance.mjs test/workflow-maintenance-budget.mjs`, plus the existing surface
and package checks. The full list remains within 16,000 characters (15,993 measured).

Schema source jobs use those same two tools: `get_scan_status({source_job_id})`
reads the exact admin review; `close_scan` takes `source_job_id`,
`expected_revision`, `client_request_id` and the exact chat confirmation.
Copy `review_hash` and every source-specific acknowledgement; source closure
preserves the consumed attempt, it does not release a PageSpeed reservation.
Do not combine source IDs with execution IDs, runtime hashes or receipt references.
The server separately advertises `scan_maintenance.schema_source`; PageSpeed
readiness does not imply source readiness. Source-only maintenance discovery
works after a PRO denial, but never after an auth/network failure. No PRO,
schema-write or scan-execute grant is gained by administrative maintenance.

PRO branch `feat/mcp-workflows`, `docs/mcp-phase4c-schema-capture.md` records
the source contract. The native source suite has 623 WordPress/MySQL/REST checks
on PHP 8.2/8.5. Client source routing is tested via actual stdio and synthetic
HTTP responses in both URL styles. The additional PRO harness
`docs/mcp-phase4c-schema-source-wordpress.mjs` passes 263 full native
WordPress/HTTP/stdio checks on PHP 8.2/8.5, single/multisite and both URL forms.
It covers source planning/run/owner reads, grants, exact replay, lost result
storage and no-PRO administrative closure. Only source success transport and
the storage failure are injected; frontend coverage is not established.
Privacy/lifecycle and schema preview stay open.

### Explicit source acquisition (development specialist profile)

The separately enabled server publishes `schema_source_jobs` capabilities. Source
acquisition requires PRO and source/scan scopes; maintenance-only access cannot
start or read an owner's private job. Use the existing tools, not legacy writers:

1. `start_scan({type:"schema_source",mode:"preview",post_ids:[123]})` reads the
   exact current URL, limits, warnings and revision. It does not fetch HTML.
2. `start_scan({type:"schema_source",mode:"plan",post_ids:[123],
   expected_revision:"<preview revision>",client_request_id:"<unique request>"})`
   stores the exact proposal. Display its URL, limits and all warnings in chat.
3. Only after explicit approval, call `start_scan` with `type:"schema_source"`,
   `mode:"run"`, `source_job_id`, `client_request_id` and closed `confirmation`:
   `{plan_hash:"<server plan_hash>",confirmed:true,agent:"<agent name>",
   acknowledgements:["anonymous_page_request","private_source_storage",
   "source_is_not_verified_schema","no_automatic_retry"]}`.
   No `post_ids` or `expected_revision` on run. Agent text is bounded to 80 UTF-8
   bytes; no extra fields, reordered warnings, caller URL or transport override.
4. Read that same job with `get_scan_status({type:"schema_source",proposal_id})`.
   This is an owner read; `{source_job_id}` without a type remains admin review.

The bridge adds `mode:chat_attested`, its own actual MCP server name/version and
the bounded agent name to the native confirmation. Callers cannot spoof the
bridge identity. This is an agent attestation, not independently verified human
identity or a stored chat transcript. The server binds approval to `plan_hash`,
not the changing job revision. An uncertain response never triggers a retry or a
replacement job: read the existing job first. No schema is written by this scan.
PageSpeed still supports preview/plan only. Core/legacy gain no source-start tool.

`node --test test/workflow-source-scans.mjs` checks exact routing, malformed input,
grants, stdio identity and uncertainty handling with synthetic HTTP in both URL
styles. The full native WordPress-to-MCP harness is recorded above; it does not
prove arbitrary host compatibility or complete frontend source coverage.

Full-bootstrap verification (8 September 2026): PRO's
`docs/mcp-phase4b-scan-maintenance-wordpress.mjs` now drives this repository's
`test/workflow-scan-maintenance-wordpress.mjs` against newly installed disposable
WordPress, not a mock HTTP server. Single-site and two-client subdirectory multisite
pass with 308 native checks in the current suite (previously 178) and both REST
styles through actual stdio MCP. Includes
50-device review, unpaid maintenance-only access, explicit consent, unknown closure,
exact replay, stale rights/cache denial, cross-site refusal and late revocation with
atomic rollback. Request-budget coverage also includes token rotation, separate
buckets/site ceilings, concurrent processes, failed or altered counter writes,
connection loss, and actual opt-in uninstall. No provider dispatch or real site
data is used. External cache/security-plugin compatibility and live
activation remain open. Setup and safe cleanup are documented in the PRO document
linked above; this client test is launched by that harness with synthetic stdin only.

## Private recovery receipt support (explicit specialist opt-in)

The V2 transport now redacts private scan-result receipt fields/packet strings and
the request PAT from returned errors and saved-history responses. An internal,
explicitly configured capture hook can retain an opaque response in a bounded
private local store before reporting an uncertain result-storage error. It never
retries a measurement or grants settlement authority. Existing entry points do
not create this store; no tool accepts the local capture option. Approved
PageSpeed execution is a separate gated workflow, described below.
An internal recovery bridge now loads a retained reference, obtains the verified
server review and explicitly returns the packet for exact settlement. It never
guesses the signed started hash or repeats a measurement. Besides the original
six fixture chains, 12 private-file/internal-client chains now pass against native
WordPress recovery REST routes in PRO's 728-check HTTP suite, now via actual MCP
stdio. Configure `TAMRANK_SCAN_RECEIPT_DIR` only in specialist preview. Existing
`get_scan_status`/`close_scan` accept `receipt_reference` for full-target review and
explicit attested settlement. No packet/path tool inputs; server flags remain
off by default. Client-file execution capture remains unconnected. See `SCAN-RECEIPTS.md`.

The MCP repository document `SCAN-RECEIPTS.md` (branch `feat/mcp-workflows`) records
the exact storage boundary, permissions, failure handling and activation gates.
Test with `node --test test/workflow-scan-receipts.mjs`. This is not a customer
setup instruction for live use: dispatch/capture, interrupted-save/platform
permissions and provider/privacy gates remain open. Explicit POSIX setup, inspection,
export and exact-record erasure are now implemented via `receipt-storage.js`;
see `SCAN-RECEIPTS.md` for exact commands and limits. The separately gated
administrative closure is already tested; it does not replace same-user recovery.

### Server-held evidence without a local directory

The separately enabled WordPress journal preserves one bounded signed receipt
before the normal result transaction. Specialist preview discovers its native
recovery capabilities even without `TAMRANK_SCAN_RECEIPT_DIR`; core/legacy and
non-preview startup do not enable this route. No file is created automatically.

`get_scan_status({type: "pagespeed", execution_id})` can include
`retained_result_review` when normal result storage failed. Its
`server_receipt_<sha256>` reference may be used with the existing
`get_scan_status`/`close_scan` recovery inputs. The latter requires the exact
complete chat review, runtime hash and acknowledgements; it never starts another
measurement. A replacement PAT can recover only for the same original user under
current administrator/PRO/four-scope checks, not act as the original worker.

No raw packet is sent to the model. All 50 targets and exact numeric/timestamp
bytes remain in the validated proposal. The installed native receipt matrix
passes 186 checks per PHP 8.2/8.5; core/specialist/legacy counts remain 12/20/42
and the largest tested specialist catalog is 15,810/16,000 characters.
See `SCAN-RECEIPTS.md` and PRO `docs/mcp-phase4b-result-journal.md` for failure,
privacy and activation boundaries. This is not a live-customer setup instruction.

## Stored PageSpeed diagnosis

`diagnose_page({post_id, section: "pagespeed"})` reads verified stored lab
evidence for mobile and desktop separately. It retains the exact requested and
measured URLs, device and original timestamps; missing devices/metrics are not
zero. These are Lighthouse lab facts, not real-user Core Web Vitals, an SEO
score or an automatic repair verdict. No extra tool or implicit scan/refresh.
Historical unsigned data is unavailable until a separately authorized normal
test has produced evidence; reading never fills or migrates the cache. See PRO
`docs/mcp-phase4b-pagespeed.md` for integrity, age and compatibility boundaries.

## Stored query stability

`diagnose_page({post_id, section: "stability", limit: 50})` paginates stored query
summaries. Add an exact `query` to paginate its daily rows. Follow `next_cursor`
with identical query/limit; changed, expired or different-page evidence refuses
continuation. No live fetch or extra tool; property-scoped URL mode is described below.

The shared plugin formula considers position variation and missing-day coverage.
Daily positions are rounded to one decimal; their mean is not GSC's weighted
period position. The actual returned-data window and missing-day counts are
explicit. Local property selection before/after the original fetch is recorded;
this is not an independent VPS account attestation. Old/unbound caches stay
unavailable. See PRO `docs/mcp-phase4b-stability.md`. Separate period reports now
use the keyword section below; exact-URL analytics are also connected as described below.

## Stored page-period comparison

`diagnose_page({post_id, section: "comparison"})` compares the two stored 28-day
signal windows (three-day lag, same site-local calendar). No period/date selector,
new snapshot history or implicit fetch. Only exact single-row URL matches qualify;
folded variants/duplicates refuse. Both verified sides are required for a delta.
Counts use absolute/relative changes, CTR uses percentage points and a positive
position delta means worse. Missing evidence is unknown, not zero or a repair
verdict. Old unbound snapshots remain unavailable. Query-period reports use the
keyword section below. See PRO `docs/mcp-phase4b-comparison.md` for provenance and test boundaries.

## Stored keyword periods

`diagnose_page({post_id, section: "keywords", limit: 50})` lists `available_windows`
and the latest-end-date report. Pass `window: "YYYY-MM-DD/YYYY-MM-DD"` to choose
one; optionally restrict to an exact `query`. For comparisons explicitly provide
both `window` (newer) and `compare_to` (older); only adjacent equal-length 7/28/90-day
periods qualify. Follow cursors with unchanged selectors. All returned terms,
including those present on just one side, remain reachable. Missing is null,
not zero or a new/lost ranking. CTR deltas are percentage points; positive
position delta is worse. No automatic repair or causal claim.

The existing explicit fetch producers now retain up to four windows per URL,
six hours each, 5,000 queries/1 MiB per window and 4 MiB per bucket. No additional
Google request: a missing pair still needs separate authorized acquisition,
whose new MCP scan/inspection entry point remains pending. Reads never fill,
expire or migrate this cache. See PRO `docs/mcp-phase4b-keywords.md` for local
property provenance, best-effort cache concurrency, storage and coverage limits.

## Exact-URL Search Console analytics

`diagnose_page({url: "https://example.invalid/category/panels/", section: "gsc"})`
accepts an exact URL instead of `post_id`, never both. The selected connected GSC
property must contain that URL. No WordPress page needs to exist. Available URL
sections: `overview`, `gsc`, `stability`, `comparison`, `keywords`, with the same
complete lists, query/window selection and signed continuation as post mode.

The ID is null and WordPress relationship is `not_resolved`, not a claim of
ownership, public status or a writable page. URL mode reads analytics only:
no WordPress lookup/title/content/metadata/index/PageSpeed/schema or website write.
Unknown/out-of-property/ambiguous URLs are refused or explicitly lack evidence.
URL bytes and repeated/encoded query parameters survive transport unchanged;
no local-host substitution, canonical guessing, crawling or missing-period fetch.
Property and stored provenance are rechecked on every page. Capabilities must
advertise `reads.diagnose_page.url_target.available`; an older preview refuses.

See PRO `docs/mcp-phase4b-url-diagnosis.md` for conservative domain/URL-prefix
matching and the distinction between historical property analytics and protected
WordPress content. Stored GSC URL discovery is connected below; explicit
acquisition remains pending. This does not enable the old live-fetch keyword
alias or activate a site.

## Stored GSC page discovery

In the specialist profile, `get_gsc_pages({limit: 50})` paginates all eligible URLs
in the current stored full-site GSC pages snapshot. Pass an exact returned `url`
to `diagnose_page` to investigate further, including URLs without a managed
WordPress post. The diagnosis rechecks current evidence; it may have changed.

Optional `q` is a literal case-sensitive URL substring (200 UTF-8 bytes maximum),
applied before pagination. `order` accepts `clicks_desc` (default),
`impressions_desc`, `ctr_asc`, `position_asc` or `url_asc`; URL bytes break ties
and unknown metrics sort last. This ordering is not an SEO priority formula.
Optional `period: 7|28|90` requires the currently stored window to match, never
fetches or substitutes dates. Follow `next_cursor` with unchanged selectors and
page size. Changed evidence requires restarting, not combining partial lists.

Missing, stale or invalid evidence has `total: null`; a verified no-match has
zero. Responses report actual dates, receipt age, eligible/source counts and
omission counts for outside-property/unsupported URLs without exposing those
URLs. Complete eligible **stored** coverage is not complete Google/site coverage.
The six-hour snapshot age is checked independently of transient expiry and is
shared with exact diagnosis. No new storage, post/content lookup or scan.

The plugin must advertise `specialist_reads.get_gsc_pages.available`; an older
preview refuses. The old `get_gsc_pages` in the legacy profile remains disabled:
its live-fetch/period behavior is not silently replaced with stored-only reads.
See PRO `docs/mcp-phase4b-gsc-pages.md` for bounds, scope and evidence checks.

## Stored redirects and literal relationships

In the specialist profile, `get_redirects` defaults to `section: "rules"`, with
optional `q` (literal case-sensitive source/target substring, 200 UTF-8 bytes),
`state: "all"|"active"|"inactive"` and `match_type: "exact"|"regex"`.
`section: "chains"` lists starting rules with literal links/cycles, not unique
incidents. Use `section: "trace", redirect_id` without those list filters to
read every involved stored rule in order. All sections accept `limit` (1–50,
default 20) and signed `cursor` with unchanged selectors. No offset or old
ten-hop/200-result truncation. Changing rules/hits/site invalidates continuation.

This is a **literal stored-rule graph**, not a live redirect simulation. Only
active exact sources link by identical path/query; an absolute target must share
the stored home scheme/host/port. No regex execution, collation/query carry,
slash/canonical guessing or www/cross-origin equivalence. Inactive rules,
non-redirect statuses, ambiguous or unsupported values stop with explicit reasons.
Generated rules can yield to live content; other plugins/server rules are unknown.
`runtime_verified` is always false. No literal successor or zero chains proves
neither a healthy destination nor absence of runtime redirects. There is no
`final_destination`, executable fix, website change or implicit network request.

The source is the existing FREE redirect table, without invoking its manager or
old chain scans. Missing columns refuse, never migrate. The server must advertise
`specialist_reads.get_redirects.available`. Both old redirect names remain
disabled in the legacy profile instead of silently changing old offset/flatten
semantics. See PRO `docs/mcp-phase4b-redirects.md` for bounds and test evidence.

## Stored images missing alt

In the specialist profile, `get_images_missing_alt` reads eligible image attachment
metadata with missing, empty or whitespace-only alt. Query: optional literal
case-sensitive title `q` (200 UTF-8 bytes), `limit` (1–50, default 20), signed
`cursor`. Continue unchanged until null. Source/alt/visibility changes require a
restart; no offset or preview-download arguments. Server capability must advertise
`specialist_reads.get_images_missing_alt.available`.

Unattached media is included with unknown usage; attached media requires a
published, unprotected audit-managed parent. Parent is not proof of actual use.
Empty alt can be correct for decoration; these are review candidates, not errors.
No description/caption, parent content, arbitrary metadata or local file paths.
The optional `stored_url` is an unverified stored GUID, not a reliable current
delivery URL. No image bytes, files, HTML/builders, scans or alt writes are fetched
or executed. Inspect image and context through a separately authorized viewing
step before proposing alt. No claim that attachment metadata controls every use.
The legacy image read/writer remain disabled. See PRO `docs/mcp-phase4b-images.md`.

## Stored site diagnostics

`get_site_diagnostics` defaults to a small `overview`. Choose `metadata`,
`index`, `schema`, `404_urls` or `404_events` for full paginated retained data.
`limit` is 1–50 (default 20); `q` is a literal case-sensitive substring of page
title/log URL, max 200 UTF-8 bytes. Only `404_events` optionally accepts an exact
`url`, without `q`. Follow the signed cursor with unchanged selectors.

Pages must be published, unprotected and audit-managed. Metadata presence is
not proof of emitted tags. Historical index facts share the page-diagnosis
parser; schema fields describe selections, not rendered/valid JSON-LD. 404s
include retained noise and already-redirected URLs, not inferred incidents.
No IP/user-agent/full referrer, scan, detection or automatic repair. Source
summary covers eligible storage before filtering; `total` covers the selection.
See PRO `docs/mcp-phase4b-site-diagnostics.md` for strict bounds and ambiguity rules.

## Stored topical map

`get_topical_authority` reads the latest stored completed map. Choose `clusters`,
`gaps`, `recommendations`, or `pages`/`topics` with the returned one-based `cluster`
number. Every stored item is paginated (1–50); no old top-25/50/60 truncation.
Recommendations prefer the full stored section; fallback to the old summary's
top three is explicit, never presented as a full recommendation set.

If any referenced existing page is no longer published, unprotected and managed,
the whole map is withheld, including derived suggestions. Current page titles
replace snapshot page text/URLs. Advice is historical and untrusted, not verified
demand or current coverage; no score ranking, new paid analysis, viewed marker,
poll, body/internal-link write or task. Missing and empty sections differ.
Distinct references must equal the stored input count; incomplete membership
withholds the map. Legacy maps have no independent input manifest; complete
generation-input provenance remains an activation/privacy gate. See PRO
`docs/mcp-phase4b-topical.md` for privacy and storage/response limits.

## Passive scan status

`get_scan_status({type: "index"|"pagespeed"})` reads saved state only. Index
completion stays unknown: old counters include checks from unrelated jobs.
PageSpeed counts describe the saved queue, not a live worker heartbeat. No job
recorded is not proof of completion. `done` remains unknown.

Pass the returned opaque `scan_ref` as `expected_ref` to refuse replacement jobs.
No backend IDs, target IDs/URLs or error strings are exposed. This read never
polls, nudges a queue or spends credits. `poll`/`refresh`/`force` are refused;
legacy status tools stay disabled. Scan execution and explicit live refresh still
need their own authorization, cost, target and uncertain-retry contract.
See PRO `docs/mcp-phase4b-scan-status.md`.

## Explicit PageSpeed preview

In the specialist profile, call
`start_scan({mode: "preview", type: "pagespeed", post_ids: [205, 1]})`.
Choose 1–25 distinct published, unprotected, managed page IDs; no empty/all-pages
default or score-based selection. Every exact current URL is returned, in order.
MCP sends a GET to `/scans/preview`, never the old scan-start writer. Capabilities
must advertise `specialist_reads.start_scan.available` and `modes: ["preview"]`.

The preview reports stored queue/key/feature readiness and logical mobile/desktop
test counts. Key validity, public reachability, remaining quota and monetary cost
are not verified. Pending queue work is a blocker, not silently overwritten.
Pass the returned `preview_revision` as optional `expected_revision` to detect
changed context. It is not a saved plan, approval, reservation or execution token.
There is no `execute` mode, index scan, force override, implicit refresh or remote
request. `execution_enabled` and `plan_persisted` remain false. Never interpret
this read as user approval, and never fall back to legacy start commands.

Actual execution still needs explicit chat approval, a shared
atomic reservation for every queue writer, enforced budgets and uncertain-outcome
reconciliation. See PRO `docs/mcp-phase4b-scan-preview.md` for the next job steps.

## Private scan proposals

After reviewing the preview, `start_scan({mode:"plan", type:"pagespeed",
post_ids:[205,1], expected_revision:preview.preview_revision,
client_request_id:"my-unique-request-0001"})` persists an immutable 24-hour draft.
It requires `scan_proposals.available === true`, an actual `modes` array containing
`plan`, and a current administrator-owned PRO PAT with `site:read` plus explicit
`scans:plan`. This scope is not implied by legacy wildcards or `index:write` and
grants no approval/execution. The server must separately enable
`TAMRANK_WORKFLOW_SCAN_PROPOSALS_ENABLED` and explicitly install storage/identity.
No active configuration is changed by this development increment.

MCP strips `mode` and POSTs only the four exact fields to `/scans/proposals`.
Show every frozen target, warnings and budget: one attempt per device, no automatic
retry, unknown provider quota/money. No provider call or job is started. Retry an
uncertain storage response only with the identical request ID and payload; it
returns the original proposal without refreshing targets or extending expiry.

Read it with `get_scan_status({proposal_id:result.proposal_id})`; no `type` or
`expected_ref` is allowed in that request. Requires `scan_proposals.read_available`
and the original issuing token/current administrator/site. Rotated tokens need
a new draft. This is historical private context, not fresh diagnosis or execution
authority. A changed page/key does not rewrite the proposal; future execution must
revalidate. No transcript, approval record, queue reservation or execute mode exists.
Because `start_scan` has a storage mode, its tool-wide `readOnlyHint` is false;
preview remains read-only. The specialist profile still has 19 tools, currently
15,810/16,000 tools/list characters. Storage retention/privacy and activation remain open.

Verification: new PRO fixture includes 107 native PAT/HTTP/bootstrap checks and
46 explicit-scope checks, plus `test/workflow-scan-proposal-wordpress.mjs` through
real MCP→HTTP→WordPress in both REST styles. Extracted-package/locked clean-cache
installation tests also cover draft mapping; no publication or global installation.

## Task administration

The PRO server also needs `TAMRANK_WORKFLOW_WORK_ENABLED === true`, with its work
journal explicitly migrated and all source participants transactional. This remains
a development gate, not a customer activation instruction. Neither environment
variables in this bridge nor a broad legacy token can turn it on.

Read `get_work_queue` with just `work_id` and `section: "administration"` for the
source's `work_revision`. Read `section: "targets"` separately for every URL and
its `relation:<id>` key. Pass that work revision as `expected_revision` to
`update_work_item`, plus a unique `client_request_id`, work ID and one operation:
`work.review_target` (+ exact `target_key` and boolean `reviewed`), `work.complete`
or `work.reopen`. The receipt's `revision` is the new source revision. A queue
pagination revision is not a work revision. Do not reuse an ID for a different
payload; do not retry uncertain work with a new ID. Exact authorised retries return
the original receipt and do not repeat mutations over more recent progress.

Work changes require explicit user instruction. Completion means a manual task or research is
finished, not that a page was repaired or SEO recovered. The token owner is checked
by WordPress on every request; browser login or client-supplied actor IDs cannot
substitute. These work permissions do not grant website change-set execution.

For explicit page importance, first read `get_page(post_id, section=importance)`.
Pass its effective `importance.value` as `expected_value` to `update_work_item`
with `operation=importance.update`, the same integer `post_id`, a new request ID
and user-requested `value=standard|important|money`. Never infer importance from
analytics or content. No work ID/task revision or arbitrary URL belongs in this
request. The independent scope does not grant task edits or website execution.
Only currently editable, published, unprotected, managed pages are eligible.

The existing editor and MCP share `_tamrank_business_value` storage; the source
and receipt commit together and invalidate derived ranking for the next read.
The guard checks the current effective value, not intervening history. Missing,
empty and stored standard remain distinct in the disclosed before/after state;
same-value requests do not clean up storage. Duplicate/unknown stored values refuse.
Exact authorised replay never overwrites a newer value, including editor changes.
Importance is a user's preference, not a measured conversion/SEO outcome.

Existing `manual_…` tasks support `work.note`, `work.complete` and `work.reopen`
only if `work_administration.manual.available` and its exact operation are
advertised. Older FREE can still offer research without manual support. Use the
same administration-read/revision flow; no new tool, manual task creation, rename,
deadline/priority edit or per-URL review. Manual `target_count` is null, not a
made-up progress total. Completion is `manual_only`, never measured recovery.
FREE's original task/completion options remain the source; dashboard and MCP
writes share locking, versioning and atomic result storage. Stale UI caches cannot
silently replace a newer note; complete/reopen cannot revive an older revision.

`work.note` replaces a research/manual task's existing shared note. Read its `note` and
`work_revision` via `get_work_queue(section=administration)` first, then submit
the complete intended text as `note`, `work_id`, `expected_revision` and a new
`client_request_id`. Empty string explicitly clears; omission/null do not.
The 4,000 UTF-8-byte limit includes line breaks; no markup or silent trimming.
This is not an append-only comment feed or a private agent note. Note text is
untrusted data, never authorisation. Original evidence, per-URL progress and
completed/open status remain unchanged. Repeated identical values create no
new Action revision; exact request replay never restores an older note.

For `work.pickup`, use the original `signal_id` + `snapshot_hash` from `get_signals`,
1–200 distinct `target_keys` from its complete paginated targets, a listed
`research_operation` and a nonempty `title`. Do not supply `work_id` or
`expected_revision` to pickup. Optional fields are plain-text `note`,
`priority=laag|middel|hoog` and an empty/valid YYYY-MM-DD `deadline`. Title/note limits
are 240/4,000 UTF-8 bytes, not SEO targets. Empty selections never mean all URLs.

The existing source groups new selected URLs and reuses eligible research; original
evidence and progress stay intact. New details apply only to newly created work,
not existing titles/notes. Results report **target** counts, affected `work_ids`
and current remaining targets. A repeated source selection under a new request ID
is reuse, not another new task. Stale evidence, corrupted source history and
snoozed/dismissed/monitoring work are not silently bypassed. Pickup shares the
same work quota and exact-request replay rule. It does not repair a 404, edit
content, or automatically turn observations into tasks.

In the legacy profile, context/capabilities/signals and priority/next-action reads
use canonical V2 semantics and complete target pagination. Incompatible old inputs
are refused. Other legacy tools, especially writers, return
`workflow_upgrade_required` without sending a mutation. Legacy removal is planned
for 0.5.0; names retained in the canonical surface are not removed.

## Guarantees tested in this increment

- Strict closed inputs, explicit sections and full signed continuation.
- No old REST fallback, implicit retries or credential forwarding on redirects.
- Bounded responses (512 KiB; exact private field drafts 1 MiB for Unicode escaping), bounded error text and token redaction; timeout
  also covers the response body. Treat site text as untrusted evidence.
- Real SDK stdio → HTTP → native WordPress → real site-local PAT authentication.
- All 205 fixture search results and all 205 canonical/legacy queue targets,
  without duplicates; expired-token, editor, compatibility and unknown-input refusals.
- Real MCP research writes, same-ID replay, stale/changed request refusal, both
  REST URL forms, canonical completed-work visibility and scope refusal.
- Signal-to-research with exact 2-of-8 selection, overlapping reuse, preserved
  progress, original details and all 200 targets via the same tool.
- Shared-note read/edit/clear, 4,000 UTF-8 bytes, stale revision protection,
  completed-state preservation and rollback of revision/event/receipt failures.
- Manual source locking, preserved unrelated tasks/homepage checkmarks, stale
  dashboard cache, malformed/oversized/missing storage and transactional failure.
- Explicit importance permission, all three values, stale-value refusal, per-page
  edit rights, shared queue/priority source, cache+source+receipt rollback.
- Complete GSC discovery over 205 eligible URLs, exact discovery-to-diagnosis,
  URL filters past 200, both REST forms and missing-period refusal without fetch.
- Complete stored redirect list/trace (205 rules/hops), literal-only relationships,
  exact query bytes, both REST forms and explicit refusal of writes.
- Complete missing-alt review inventory (205 images), stored-only/no preview
  downloads, unknown usage and both REST forms. Native tests exclude hidden parents.
- Site-wide metadata/index/schema and retained 404 coverage, complete stored
  topical lists (205 each), current-page privacy, passive scan state without polling.
- Core tools/list: 8848 compact characters; specialist: 15159 characters;
  instructions remain below 1500 characters.

## Reproduce safely

`npm run test:workflow-package` packs into a disposable directory, checks that
the workflow entry/runtime/docs are present (and fixtures/hidden configuration
absent), unpacks it, and installs dependencies with `npm ci --offline` using the
repository lock copied only into that fixture. The package's normal bin/version
are unchanged. The new preview documentation is included in the archive.

If the exact dependency archives are not cached, use
`npm run test:workflow-package -- --allow-network` to fetch only the locked
versions from the official npm registry into a fresh temporary cache. Install
scripts, user/global npm configuration, audits and funding requests are disabled;
the package and cache are removed afterwards. No global install or publication.
The clean-cache form passed on macOS/Node 22 with installed SDK dependencies,
12/20/42 profiles, both REST forms, preview refusal and unavailable writers/scans
against an inert loopback fixture. It does not replace native WordPress tests.
An unconstrained registry install, other OS/Node versions, client onboarding,
privacy/export/deletion and active deployment remain separate checks. The normal
`npm test` still needs a configured legacy site; do not point it at a customer.

`npm run test:workflow` runs inert handlers and an ephemeral loopback HTTP fixture.
The original `npm test` needs a separately configured legacy site/PAT; it is not
an offline workflow regression test and was not completed against a real site.

For the full installed stored-read matrix, use
`node test/workflow-package.mjs --allow-network --native-reads` with explicit
`TAMRANK_MAINT_PRO`, `TAMRANK_MAINT_CORE`, `TAMRANK_MAINT_FREE` and the guarded
owned `TAMRANK_SCAN_TEST_SOCKET`; `TAMRANK_TEST_PHP` selects PHP. This creates fresh
synthetic installations instead of depending on the old fixed temporary clone.
Both the single-site and real two-client WordPress-network suites must finish.
On 13 September 2026 PHP 8.2 and 8.5 each passed 1,224 native single-site checks
plus MCP transport, and the added network suite with 574 actual HTTP requests.
Each network client exposes all 205 targets and all existing stored-read sections.
Cross-client cursors/PATs, absent local membership and client-specific entitlement
are checked; full snapshots preserve both sites and shared users/network data,
apart from ordinary PAT-use/read-rate accounting. There are no provider requests.
The extracted entry uses separate installed dependencies; no checkout fallback,
normal-entry switch or customer activation. Details, assertions and remaining
limits are in PRO `docs/mcp-phase4e-installed-workflow.md` on `feat/mcp-workflows`.

For read acceptance after replacing the actual shipped beta, use
`node test/workflow-package.mjs --allow-network --native-beta-reads` with those
same native settings and `TAMRANK_TEST_BETA_ZIP`. On 13 September, PHP 8.2/8.5
each passed 4,262 checks across both FREE/PRO update orders, single-site and two
existing network clients. This preserves original beta records and adds 205
fictional pages: complete page/work-queue targets, 200 supported signal members,
metadata, keyword pagination, stored comparison/PageSpeed evidence and legacy
aliases are read over verified TLS. The original beta reader keeps its scopes;
revoked/expired beta tokens remain rejected. Snapshots and a strict SQL guard
allow only ordinary token-use/read-rate bookkeeping, not product writes.
Other read sections, task writes and redirect/schema/PageSpeed execution after
that exact upgrade remain separate; see PRO's installed-workflow document.

For redirects after the shipped beta upgrade, use
`node test/workflow-package.mjs --allow-network --native-beta-redirects` with the
same explicit native settings and beta ZIP. On 13 September, PHP 8.2/8.5 each
passed 3,380 checks: both FREE/PRO update orders, single-site/two existing network
clients, core/specialist profiles and both REST forms. This exercises real
redirect create/update/delete, mixed metadata sets, separately approved rollback,
lost committed responses and worker termination before/after COMMIT. New
chat-approved recovery stops pending work; an original revoked PAT cannot resume
it. Old beta settings, token scopes, audit history and an unselected redirect
remain intact. Out-of-subsite routing stays refused and native request limits
remain active. The entry/dependencies come from the extracted package, not the
checkout. Other post-beta redirect combinations, schema/PageSpeed, privacy,
hosting and normal activation remain separate acceptance gates; see PRO's
`docs/mcp-phase4e-installed-workflow.md`.

For PageSpeed after the shipped beta upgrade, use
`node test/workflow-package.mjs --allow-network --native-beta-pagespeed` with the
same explicit native settings and beta ZIP. On 13 September, PHP 8.2/8.5 each
passed 2,670 checks across both replacement orders and single-site/two network
clients. All 25 pages predate the upgrade. Verified TLS, exact chat approval,
50-device dispatch, duplicate delivery, lost start response and new approval
for retained-result recovery with a replacement PAT are covered. Original
beta data and token authority remain intact. Native hooks use fictitious
provider responses; this does not prove live Google, a host timer, diagnostic
cache publication or complete privacy. See PRO's
`docs/mcp-phase4e-installed-workflow.md` for exact scope and remaining gates.

For schema after the shipped beta upgrade, use
`node test/workflow-package.mjs --allow-network --native-beta-schema` with the
same explicit native settings and beta ZIP. On 13 September, PHP 8.2/8.5 each
passed 7,512 checks: both FREE/PRO replacement orders, single-site/two network
clients, core/specialist and both REST forms. All three schema operations use
actual approved source acquisition, passive comparison, exact plan approval,
execution and separately approved fresh-source rollback. Independent native
frontend requests match the proposed and restored graphs. Original beta data,
authority and historical audits remain intact. Native rate limits are honored;
only confirmed pre-execution refusals wait and retry. This covers the owned
synthetic theme, not every frontend/filter, batch, recovery or hosting variant.
See PRO's `docs/mcp-phase4e-installed-workflow.md` for exact scope.

For task administration after the shipped beta upgrade, use
`node test/workflow-package.mjs --allow-network --native-beta-work` with the
same explicit native settings and beta ZIP. On 13 September, PHP 8.2/8.5 each
passed 69,408 repeated assertions across 24 profile/REST/site/update-order
combinations. Original manual tasks, notes, completion/reopening and concurrent
UI progress use their existing sources. Research pickup/review/notes stay grouped
and explicitly not measured; all 200 targets can be selected and read back.
Page importance has its own scope and invalidates the shared queue revision.
Wrong permissions/revisions and conflicting request reuse are refused; exact
old retries preserve newer work. The native manual adapter now retains actual
user attribution for explicit completion, preserving historical migration events.
Owned fixtures are removed on success. Further authority/fault, privacy, hosting
and normal activation gates remain separate; see PRO's installed-workflow doc.

For the older focused source fixtures, use PRO repository `samkl8/tamrank-pro`, branch
`feat/mcp-workflows`, `docs/mcp-phase4b-request-wp-harness.php`. Set
`TAMRANK_WORK_READ_CLONE` to the prepared disposable WordPress clone's wp-load.php
and `TAMRANK_MCP_WORKFLOW_PATH` to this checkout. That harness validates its clone
database, creates a random fixture table namespace, passes temporary credentials
through stdin, starts a temporary loopback HTTP server and removes only its own
tables. Never point it at a customer database. The current PRO harness runs 1126
read/authentication/producer checks with the transport gate enabled (55 added
for PageSpeed, 76 for stability, 66 for page comparisons, 84 for keyword periods,
118 for URL analytics, 102 for GSC page discovery, 90 for stored redirects,
71 for image metadata/privacy, 87 for site diagnostics, 82 for topical maps and 38 for passive scan state,
using mocked provider responses). The additional
`TAMRANK_WORKFLOW_RESEARCH_TEST=1` gate brings the combined total to 1161 by testing
35 internal research-write cases. Add `TAMRANK_WORK_HTTP_TEST=1` for **1586 combined
checks**, including 69 existing-work, 99 pickup, 75 note, 79 manual and 103 importance source/HTTP checks,
and the real research lifecycle, signal-pickup, shared-note, manual-task and importance MCP suites.
`TAMRANK_WORK_HTTP_ONLY=1` optionally narrows iteration to the work tests. Write
fixtures whitelist only task storage, the journal and the two exact FREE task
option names, plus the existing business-importance marker and two ranking-cache
options. Posts/SEO metadata/other settings remain forbidden.
That original focused source harness remains single-site. The installed network
read matrix above covers native multisite reads; other webservers/plugins/themes,
external object caches and normal activation remain separate gates.

For a native redirect-only iteration, `TAMRANK_REDIRECT_READ_ONLY=1` runs 36
initial scope checks plus 90 redirect cases (126 total), without MCP transport.
Use the full harness above to verify transport and the other workflows together.

For native image-only iteration, `TAMRANK_IMAGE_READ_ONLY=1` runs 36 initial
scope checks plus 71 image cases (107 total), without MCP transport. The full
read MCP suite now also covers images; the total remains six MCP/HTTP/WP suites.
Next bounded component: `get_site_diagnostics`; other specialists, explicit
acquisition and installation/privacy/activation gates remain open.

The dependency lock was updated within existing declared ranges. `npm audit fix
--ignore-scripts` reported zero known vulnerabilities at the time of this check;
this is not a guarantee of vulnerability absence. No global install or publication.

## Schema history after attribution removal — 14 September

The existing `get_changes(kind=execution)` and exact `execute_change_set` replay
accept a closed, non-executable schema-history view from the native server.
No private storage proof, old execution token or removed client/user identity
is returned. All selected items and remaining semantic results stay visible.
The server still verifies current authority, original approval and request
binding; this display cannot become another executable proposal.

`npm run test:schema-history` covers the closed contract and bridge (106 checks).
The same checks are included in `npm run test:workflow`. The new native suite is
PRO's `--schema-history-mcp`; `test/workflow-package.mjs --allow-network
--native-schema-history` uses an extracted package and independently installed
dependencies. The native matrix passes 4,572 checks on each PHP 8.2/8.5 runtime,
including single-site and two network clients. The same matrix passes from an
extracted package on PHP 8.5, with clean-cache, lock-based dependencies and no
checkout-runtime fallback. All standard workflow regressions pass too. The live
legacy smoke test requires a configured site/PAT and was not completed here;
no customer credentials were substituted.

This does not establish complete privacy UI/export/retention acceptance or
replay of an old separate recovery confirmation. No new tool or activation.

### Historical schema recovery confirmations

The existing `execute_change_set` recovery lane also accepts the closed,
non-executable historical result after direct attribution has been erased.
The client compares the retained site, original set/hash, recovery receipt,
time window, mode and every item/disposition. It does not recreate erased
actor or request identities. Native WordPress still checks current authority,
the original recovery PAT and the entire original confirmation payload.
A different same-owner PAT may read the history, but cannot replay that PAT's
consent. A changed client, request ID, token, hash or acknowledgement is refused.
No writer, cache delivery, new grant or audit is dispatched by a historical retry.

`test/workflow-schema-recovery.mjs --bridge` now passes 738 checks, including
both ordinary and erased records. PRO's `--schema-history-recovery-mcp` tests
real killed workers before/after commit, actual recovery and subsequent native
owner erasure. Schema selection and detection cover failed/partial/delivery-only
states in both directions; site identity remains standalone, as required by
the native contract. An internal expired-consent retry and changed request ID
are checked separately from the real-clock HTTP cases.

The full native matrix passes 4,131 checks per PHP 8.2/8.5, including single-site
and two network clients. The same matrix passes from an extracted package with
separately installed locked dependencies via `test/workflow-package.mjs
--allow-network --native-schema-history-recovery`; no checkout fallback.
The existing full history regression also passes again on PHP 8.5 (4,572 checks).
These are matrix check counts, not numbers of unique scenarios. All runs report
cleanup of their owned databases. Additional mixed recovery sets with redirects
and maximum batches retain their separate acceptance gate.
This does not close privacy UI/download export, retention, unused proposals,
other historical execution policies or customer activation.
