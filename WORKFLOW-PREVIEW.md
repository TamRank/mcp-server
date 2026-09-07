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
The remaining four core names and seven specialist names refuse requests;
their presence is not a working website-write/scan/history implementation. Phase 4 is open.

## Stored PageSpeed diagnosis

`diagnose_page({post_id, section: "pagespeed"})` reads verified stored lab
evidence for mobile and desktop separately. It retains the exact requested and
measured URLs, device and original timestamps; missing devices/metrics are not
zero. These are Lighthouse lab facts, not real-user Core Web Vitals, an SEO
score or an automatic repair verdict. No extra tool or implicit scan/refresh.
Historical unsigned data is unavailable until a separately authorized normal
test has produced evidence; reading never fills or migrates the cache. See PRO
`docs/mcp-phase4b-pagespeed.md` for integrity, age and compatibility boundaries.

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
- Core tools/list: 8239 compact characters including importance/manual/note/pickup/research schemas;
  instructions remain below 1500 characters.

## Reproduce safely

`npm run test:workflow` runs inert handlers and an ephemeral loopback HTTP fixture.
The original `npm test` needs a separately configured legacy site/PAT; it is not
an offline workflow regression test and was not completed against a real site.

For full integration use PRO repository `samkl8/tamrank-pro`, branch
`feat/mcp-workflows`, `docs/mcp-phase4b-request-wp-harness.php`. Set
`TAMRANK_WORK_READ_CLONE` to the prepared disposable WordPress clone's wp-load.php
and `TAMRANK_MCP_WORKFLOW_PATH` to this checkout. That harness validates its clone
database, creates a random fixture table namespace, passes temporary credentials
through stdin, starts a temporary loopback HTTP server and removes only its own
tables. Never point it at a customer database. The current PRO harness runs 312
read/authentication/producer checks with the transport gate enabled (55 added
for PageSpeed, using mocked Google responses). The additional
`TAMRANK_WORKFLOW_RESEARCH_TEST=1` gate brings the combined total to 347 by testing
35 internal research-write cases. Add `TAMRANK_WORK_HTTP_TEST=1` for **772 combined
checks**, including 69 existing-work, 99 pickup, 75 note, 79 manual and 103 importance source/HTTP checks,
and the real research lifecycle, signal-pickup, shared-note, manual-task and importance MCP suites.
`TAMRANK_WORK_HTTP_ONLY=1` optionally narrows iteration to the work tests. Write
fixtures whitelist only task storage, the journal and the two exact FREE task
option names, plus the existing business-importance marker and two ranking-cache
options. Posts/SEO metadata/other settings remain forbidden.
Multisite, other webservers/plugins/themes and
external object caches remain separate activation gates.

The dependency lock was updated within existing declared ranges. `npm audit fix
--ignore-scripts` reported zero known vulnerabilities at the time of this check;
this is not a guarantee of vulnerability absence. No global install or publication.
