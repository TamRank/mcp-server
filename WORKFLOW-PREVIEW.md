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
`update_work_item` additionally supports explicit research review/complete/reopen
only when server capabilities advertise the exact operation and `tasks:write`.
The remaining four core names and seven specialist names refuse requests;
their presence is not a working website-write/scan/history implementation. Phase 4 is open.

## Research administration

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

Work changes require explicit user instruction. Completion means research is
finished, not that a page was repaired or SEO recovered. The token owner is checked
by WordPress on every request; browser login or client-supplied actor IDs cannot
substitute. Website change-set execution remains disabled. Ordinary manual-task
lifecycle, pickup, notes and importance are still pending.

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
- Core tools/list: 6932 compact characters including research-write schemas;
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
tables. Never point it at a customer database. The current PRO harness runs 257
read/authentication checks with the transport gate enabled. The additional
`TAMRANK_WORKFLOW_RESEARCH_TEST=1` gate brings the combined total to 292 by testing
35 internal research-write cases. Add `TAMRANK_WORK_HTTP_TEST=1` for **361 combined
checks**, including 69 actual work-route checks and the real research MCP suite.
`TAMRANK_WORK_HTTP_ONLY=1` optionally narrows iteration to the work tests. Write
fixtures whitelist only research storage; posts/metadata/settings remain forbidden.
Multisite, other webservers/plugins/themes and
external object caches remain separate activation gates.

The dependency lock was updated within existing declared ranges. `npm audit fix
--ignore-scripts` reported zero known vulnerabilities at the time of this check;
this is not a guarantee of vulnerability absence. No global install or publication.
