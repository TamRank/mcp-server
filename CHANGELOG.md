# Changelog

All notable changes to `@tam-rank/mcp-server` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> This package has not been published by these repository changes. The reviewed
> first beta version is `0.4.0-beta.1`; a stable release remains a later decision.

## [Unreleased]

### Changed
- Hosted `update_work_item`: a 409 for an outdated request (`workflow_work_changed`, `importance_value_changed`, `signal_pickup_snapshot_changed`, `pickup_note_origin_changed`) is now `work_item_changed` with `outcome_unknown: false`, and says to read again and send a new request, instead of `site_unavailable` with an unknown outcome.
- `update_work_item` refusals name the rule (pickup needs `title` and refuses `expected_revision`; other operations need `work_id` and `expected_revision`; importance has its own fields), and the tool descriptions state it.
- A pickup answer no longer shows `source_selection_reused` and `details_applied_to_new_work_only`; reused work gets an `assistant_note`.

- Launch-readiness test of 20 Oct 2026 (tamrank.com, PRO 0.9.57):
  - `get_changes` without `kind` reads the execution record where the site offers execution
    reads (a plan from `plan_changes` is readable there in every state, `planned` too) instead of
    the draft, which PRO 0.9.57 answers with `change_store_integrity` for every plan. A draft read
    that still gets that answer returns `change_draft_unavailable` (`site_code` keeps the site's
    code) and says the plan and the site are not damaged. A refused execution read says what the
    site answered instead of "may or may not have been applied".
  - `get_changes(kind=execution)` leaves out internal bookkeeping (site binding, `token_id`,
    `operator_id`, leases, budgets, audit ids, dependency/source hashes) and adds `summary`,
    `warnings` and `assistant_note`. Everything a later step uses stays (`change_set_id`,
    `plan_hash`, `change_token`, `policy_version`, item ids, states, before/after, delivery
    result). Schema execution records are unchanged (already a curated view).
  - `plan_changes` and `rollback_change_set` add `warnings`: per warning code a plain sentence
    (`warning_codes` stays as it was).
  - `plan_changes` with two items on the same page, image or redirect (for example `meta.update`
    and `social.update` on one post) is refused with PRO's own code `change_plan_duplicate_target`
    and "One item per page per plan: ... Split them into two plans." (`assistant_note` names the
    target and how to group fields), instead of a bare `invalid_request`. PRO refuses it too.
  - PRO `fix/mcp-launch-fixes` contract: a draft read (`GET /changes/{id}`) of a plan from
    `plan_changes` may answer with the execution body (`contract_version: 1`); that one route now
    accepts v1 and shows it through the same view. PageSpeed progress passes `measuring` and
    `reconcile_after`; `reconciliation_required` while `measuring` is true says "Measuring, read
    again shortly." and skips the retained-result review. Builder/template reasons on `get_page`
    content and `action_origin_target_count` / a UUID `action_id` in the work queue pass through.
  - Argument refusals name the argument and the form it takes (`since must be a date as
    YYYY-MM-DD ...`), hosted too (the SDK's pre-handler validation), without echoing the value.
  - `get_outcomes` and `list_changes` return an opaque `next_cursor` (`pc1.<page>.<tag>`) bound to
    the filters, like the other reads; a cursor used with other filters is refused. A bare page
    number is still accepted. Guarded by `test/hosted/launch-fixes.mjs`.
  - `HOSTED-MCP.md` (and its handoff copy) matches what runs hosted: ten scopes, redirect writes,
    PageSpeed and index measurements, up to 22 library tools plus `list_sites` from the VPS.
- Everything the assistant can pass on to a user is plain language. Refusal messages no longer
  name internal terms (workflow, hosted, legacy writers, specialist, token, scope ids), tool
  names or HTTP statuses; what the assistant must do next (for example reading a set with
  `get_changes(kind=execution)`) moves to a separate `assistant_note`. Tool descriptions and
  server instructions drop internal codenames. A WordPress `rest_*` refusal over stdio says the
  plugin may be inactive or out of date instead of forwarding WordPress' route text.
- `update_work_item.priority` takes `low`, `medium` or `high`. The old Dutch values are still
  accepted, and the site keeps receiving its own values. Guarded by `test/hosted/model-text.mjs`.

### Added

- `get_outcomes` (read-only, `site:read`): what applied changes did in Google Search. Per change
  the clicks, impressions, CTR and average position in the 14 days before and after, the
  site-wide trend, and a plain-language explanation of the status (`pending` says when the first
  result is expected, 14 days plus 3 days Search Console delay). Filters `change_set_id`,
  `status`, `since` (a date); pages with `next_cursor`. Reads the site's existing
  `/tamrank/v2/outcomes`; hosted lists it only when the site advertises
  `reads.get_outcomes.available`. (Counts as of 20 Oct 2026: stdio core 15 tools, specialist 23;
  hosted at most 22 library tools, plus `list_sites` from the VPS = 23 live.)
- `get_capabilities` says how old it is: `as_of` (ISO time the capabilities were read from the
  site) and `cache_age_s`. Local sessions read live (`cache_age_s: 0`); hosted shows the API's
  `as_of` and counts the age per call, since the session keeps the copy it opened with.
- Hosted tool descriptions say what each tool can do and when to use it. Local sessions keep
  the short descriptions; the shared catalog budget in tests is now 16,500 characters
  (`test/catalog-budget.mjs`; a full specialist catalog measured 16,472).
- Historical change reads accept a rollback a site administrator confirmed in WordPress
  admin (`wp_admin_confirmed`, `human_verified: true`; TamRank PRO). A recovery
  attestation stays `chat_attested` only, and everything the bridge sends (plan,
  execute, rollback) remains chat-attested.

### Fixed

- Hosted connections and a clamped `workflow-v2-1` stdio profile no longer see recovery in
  `tools/list`: `get_changes` lists `kind` as `draft`/`execution` with a non-recovery
  description, and `execute_change_set` lists no `recovery_plan` or recovery tokens. A
  direct recovery call is still parsed and refused by the authorizer
  (`operation_unavailable`). A stdio site that offers recovery keeps it.
- `get_site_diagnostics`, `get_topical_authority` and `get_redirects` describe their
  section rules (`overview` takes `section` only; `trace` needs `redirect_id`), and a
  refused call names the argument instead of the generic `invalid_request` text.
- `get_redirects` with `section: "trace"` names where `redirect_id` comes from in its
  description and in the refusal when it is missing: an id from `section: "rules"`, e.g. `12`.

### Changed

- A site on the `workflow-v2-1` release profile (TamRank PRO 0.9.22+, reporting
  `full_v2_compatible: false`) now connects over stdio instead of getting
  `workflow_upgrade_required`, as the hosted bridge has since 28 September 2026. It is
  served with the `safe-beta-1` tool profile: its capabilities pass the hosted allowlist
  (no schema execution or preview, scans, recovery or mixed sets), `tools/list` shows
  what hosted shows for that site, and `get_capabilities` reports the clamped view.
  A `specialist` session on such a site gets the same clamped toolset and instructions
  as `core` (no scan tools that the clamp would refuse); `legacy` is unchanged. The
  profile gate in `WORKFLOW-PREVIEW.md` now describes this admission.
  `safe-beta-1` sites, full v2 sites and explicit development previews are unchanged;
  any other profile still needs an upgrade.

## [0.4.0-beta.1] - 2026-09-15

### Changed

- The canonical safe workflow is now the package main, `tamrank-mcp` bin and
  `npm start` entry. The old `index.js` path forwards to that same workflow.
- A site with the explicit `safe-beta-1` release profile can connect without a
  hidden development-preview environment variable.
- The temporary 42-name legacy profile keeps only five safe read aliases; all
  other legacy names fail closed without invoking their former implementations.

## [Unreleased]

V1.1 — the repairs the dogfood session of 1 September 2026 turned up, in two parts:
the bridge (part A) and the PRO REST layer it talks to (part B). A part-B entry needs
the matching PRO release on the site; against an older PRO the new tools answer 404
and the new arguments are ignored, so an existing agent keeps working either way.

### Added

- `get_signals` — the open rows of the site's signal store: what a detector saw move,
  each with an explicit window (start and end), its delta as a number with a unit,
  the evidence the dashboard card carries, `impact`/`confidence`/`score`, and the
  tool that acts on it with its arguments pre-filled from that window. Until now no
  tool on this surface read the store at all, so an agent could not see the one thing
  the site had flagged. Reading never marks a signal as shown; the translated card
  prose is deliberately not returned. A site whose TamRank predates the store answers
  409 `signals_unavailable` and every other tool keeps working. *(needs PRO with the
  `/signals` route)*
- `update_meta_batch` — one dry run and one execute for 1 to 25 posts. The single
  `change_token` binds the whole reviewed set, so changing any value, adding or
  dropping an item, or reordering them is refused with 409 and writes nothing. Each
  applied item still gets its own `audit_id`, so `rollback` keeps working per post.
  There is no batch rollback in this version. *(needs PRO)*
- `since` and `sort` on `get_404s`, and `first_seen` plus `is_new` on every row.
  `since` defaults to the moment of the last signal scan, so "new" means the same
  thing here as it does in a signal; `sort=newest` puts the URLs that just appeared
  above months-old noise with more lifetime hits. The default sort is unchanged.
  *(needs PRO for the new fields; the arguments are ignored by older builds)*
- `rescore` on `update_meta` and `update_meta_batch` — an opt-out, default on. See
  under Changed for what the default now does. *(needs PRO)*
- `verbose` on `get_capabilities`, returning the full feature registry. *(needs PRO)*
- `refresh` argument on `get_next_action` and `get_priority_actions`. The response
  already prescribed re-polling with a refresh once `ranking.writes_since` was above
  zero, but the argument did not exist, so the advice could not be followed and the
  tool kept naming the page that had just been fixed. The recompute is throttled
  server-side.
- Server `instructions`, sent once at initialize: which tool to open with, the
  dry-run/execute handshake, when to rescore, when to refresh the ranking, and the
  reminder that prose fields may be localised.
- `test/surface.mjs` — measures the fixed cost of a session (`serverInfo`,
  `instructions`, the whole `tools/list`) over the real stdio transport, and fails
  when a budget is exceeded.

### Changed

- The bridge now explicitly requests `compact=1` from `get_capabilities`. The REST
  endpoint's no-argument response keeps its original `features[]` list for scripted
  consumers, while MCP retains the compact counts used to reduce session cost.
- The surface test now requires 1,000 characters of `tools/list` headroom and 150
  characters of instruction headroom, instead of passing immediately below a hard
  ceiling. Repeated schema prose and the initialize instructions were tightened.
- `npm test` now runs both the live smoke test and the surface gate. Smoke exits
  non-zero on unexpected tool errors; `test:integration` and `test:all` expose the
  write-and-rollback integration suite explicitly.

- A meta write now persists a fresh score instead of projecting one. `update_meta`
  with `execute=true` runs the full re-audit itself and returns the persisted
  before/after, so `get_meta`, `get_site_overview` and the WordPress dashboard are
  correct the moment the write returns — no separate `rescore_page`. Nothing used to
  force that follow-up call and nothing warned when it was skipped, which left three
  surfaces reporting a score that no longer existed. Pass `rescore=false` to defer
  the work; the response then carries the old projection with `needs_rescore: true`
  so the debt is visible. A rolled-back meta write refreshes the score the same way.
  Dry runs are unchanged. *(needs PRO)*
- The bridge's `get_capabilities` tool returns feature counts plus the unavailable
  ones by default, instead of the full 64-entry registry in which every entry read
  `available: true` on a PRO site. On PRO the response went from ~9.000 to ~1.450
  characters. `verbose=true` returns exactly the old array. Direct REST calls
  without arguments also keep that original array. *(needs PRO)*
- `get_next_action` carries `targets[]` — the other pages the action covers, in the
  ranking's order — whenever the card stands for more than one object. It used to
  say "15 pages" and hand over exactly one, leaving the other fourteen to be hunted
  down with `search_posts`. A single-object action is unchanged. *(needs PRO)*
- The ranking note asked to "re-poll with refresh=1" while the tool argument is a
  boolean, so following it literally produced a validation error. It now says
  `refresh=true`. *(needs PRO)*
- `instructions` names `get_signals` as the second opening call and describes the
  batch tool and the new rescore default.
- A refused preflight no longer exits the process. A rejected PAT, a site without an
  active PRO licence, and any other unexpected preflight status are remembered; the
  server starts, carries the diagnosis in `instructions`, and returns it from every
  tool call as a tool error without touching the network. Missing environment
  variables and a token without the `tamrank_pat_` prefix stay fatal — there is no
  session yet in which to explain anything — and a network error still only warns.
- The server icon is advertised as a URL instead of an inline `data:` URI, removing
  12.342 characters from every initialize response.
- Tool descriptions are now limited to what the tool does, what goes in and what
  comes out; the sequencing prose moved to `instructions`. `tools/list` went from
  40.604 to 20.956 characters at 40 tools, the longest description from 1.265 to 81.
  The two tools added in part B bring it to 23.548 at 42 tools — almost entirely
  argument schema, which is contract — so the `test/surface.mjs` budget moved from
  21.000 to 24.000, recalibrated on 42 tools. Existing tool names and argument
  schemas are unchanged, so existing agent configurations keep working.
- 409 conflicts get a hint per error code. `already_reverted` and `redirect_exists`
  no longer carry the change-token advice that belongs to `change_token_mismatch`
  alone; conflicts without a specific hint keep the server's own message.
- The `missing_meta` argument of `search_posts` now says which values it takes
  (`title`, `description`, `any`) and that it is not a boolean. The argument name is
  unchanged.

### Fixed

- `update_meta` no longer describes the persisted post-write score as a projection.
- A revoked or expired token used to surface to the client as
  `MCP error -32000: Connection closed`, which is indistinguishable from a crashed
  server. It now reads as an authentication error, in the handshake and per call.

[Unreleased]: https://github.com/TamRank/mcp-server/compare/main...HEAD
