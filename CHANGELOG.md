# Changelog

All notable changes to `@tam-rank/mcp-server` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> This package has not been published by these repository changes. The reviewed
> first beta version is `0.4.0-beta.1`; a stable release remains a later decision.

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
