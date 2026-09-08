# Workflow bridge — development preview

Branch `feat/mcp-workflows` prepares MCP `0.4.0-preview` in package
`@tam-rank/mcp-server`. The shipped entry, npm bin and package version remain
unchanged. This is not a release or a replacement of the active MCP connection.

## Entry and profiles

Run `node index-workflow.js` explicitly with site-local `TAMRANK_PAT` and
`TAMRANK_SITE_URL`. HTTPS is required except literal loopback HTTP for tests.
`TAMRANK_REST_STYLE=query` supports the query-string REST form; default is pretty.
`TAMRANK_TIMEOUT` is milliseconds, 1–120000, default 30000.

The plugin must expose contract 2. Incomplete compatibility is refused unless
`TAMRANK_WORKFLOW_PREVIEW=1` explicitly selects development workflows. The matching
FREE/PRO branches require their server-side read flag; a client cannot enable it.
Do not enable this preview on customer sites yet.

`TAMRANK_TOOL_PROFILE` is `core` (default, 12 names), `specialist` (19 names), or
`legacy` (42 old names, opt-in for the planned 0.4.x minor only). Seven core reads
are connected: site context, capabilities, queue, signals, search, page, diagnosis.
`update_work_item` additionally supports explicit signal pickup, shared notes, research review/complete/reopen and manual complete/reopen
with `tasks:write`; `importance.update` uses the independent `importance:write` grant.
Both require the exact operation to be advertised in server capabilities.
Six optional specialists are connected: `get_gsc_pages`, `get_redirects`,
`get_images_missing_alt`, `get_site_diagnostics`, `get_topical_authority` and
passive `get_scan_status`, as described below. `start_scan` additionally supports
explicit PageSpeed preview and separately authorised private drafts, never execution.
The remaining four core names refuse requests; their presence is not a working
website-write/history implementation. Actual scan execution and Phase 4 remain open.

## Private recovery receipt support (internal only)

The V2 transport now redacts private scan-result receipt fields/packet strings and
the request PAT from returned errors and saved-history responses. An internal,
explicitly configured capture hook can retain an opaque response in a bounded
private local store before reporting an uncertain result-storage error. It never
retries a measurement or grants settlement authority. Existing entry points do
not create this store; no tool accepts the capture option or executes a scan.

The MCP repository document `SCAN-RECEIPTS.md` (branch `feat/mcp-workflows`) records
the exact storage boundary, permissions, failure handling and activation gates.
Test with `node --test test/workflow-scan-receipts.mjs`. This is not a customer
setup instruction: native routes, recovery/maintenance, safe local provisioning
and cleanup still need integration before activation.

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
substitute. Website change-set execution remains disabled.

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
- Bounded responses (512 KiB), bounded error text and token redaction; timeout
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
12/19/42 profiles, both REST forms, preview refusal and unavailable writers/scans
against an inert loopback fixture. It does not replace native WordPress tests.
An unconstrained registry install, other OS/Node versions, client onboarding,
privacy/export/deletion and active deployment remain separate checks. The normal
`npm test` still needs a configured legacy site; do not point it at a customer.

`npm run test:workflow` runs inert handlers and an ephemeral loopback HTTP fixture.
The original `npm test` needs a separately configured legacy site/PAT; it is not
an offline workflow regression test and was not completed against a real site.

For full integration use PRO repository `samkl8/tamrank-pro`, branch
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
Multisite, other webservers/plugins/themes and
external object caches remain separate activation gates.

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
