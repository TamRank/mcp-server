# TamRank MCP — 0.4 beta

Start guides: **English** (this page) · [Nederlands](QUICKSTART-NL.md) ·
[Deutsch](QUICKSTART-DE.md) · [Français](QUICKSTART-FR.md).
The translated quickstarts cover the same beta entry and safety boundaries;
they do not change the client or WordPress interface language.

TamRank helps you find relevant SEO work, inspect the evidence, review an exact
proposal and, after approval in chat, execute supported changes and inspect the
result. It uses the same work sources as the WordPress dashboard. Completing
research is not proof of a website fix or an SEO improvement.

**Use this beta on an owned test site first. Do not activate its writers on a
customer site without a separately reviewed release decision.** The repository
build is not published merely by changing its version.

## Package and entry

| Entry | Status in `0.4.0-beta.1` |
|---|---|
| `tamrank-mcp`, `npm start`, package main | Canonical safe workflow entry. Identifies itself as `tamrank-mcp` / `0.4.0-beta.1`. |
| `index-workflow.js` | The same canonical entry when running a checkout directly. |
| `index.js` | Compatibility path to the same safe workflow; it no longer starts the V1 implementation. |

The package name is `@tam-rank/mcp-server`; the first beta is deliberately pinned
as `@tam-rank/mcp-server@0.4.0-beta.1`. Publishing remains a separate human action.

This package contains the customer-facing setup and safety boundary only.
Internal implementation evidence, branch history and release-gate notes are
deliberately not included in the distributed package.

## First connection: owned test site, reads first

1. The **owned test site** must have the matching FREE and PRO beta builds. In
   TamRank, activate the reviewed safe workflow profile while creating its PAT.
   Client environment variables cannot enable WordPress capabilities.
2. In that site's TamRank **Settings → Integrations → AI Agents (MCP)** card,
   create a **site-local PAT**, linked to your current WordPress operator.
   Begin with `site:read`; grant additional
   operation scopes only for a separately approved test. A licence key or an
   invented token prefix is not a PAT. Do not put a real token in git, shared
   screenshots, tickets or chat transcripts.
3. Configure a separate stdio server in your MCP client. Replace the example
   site URL and token placeholder. Clients using an
   `mcpServers` configuration shape can use this template; others need the same
   command, arguments and environment in their own settings.

```json
{
  "mcpServers": {
    "tamrank-test": {
      "command": "npx",
      "args": ["-y", "@tam-rank/mcp-server@0.4.0-beta.1"],
      "env": {
        "TAMRANK_SITE_URL": "https://test.example.com",
        "TAMRANK_PAT": "REPLACE_WITH_SITE_LOCAL_PAT",
        "TAMRANK_TOOL_PROFILE": "core"
      }
    }
  }
}
```

4. Restart **this test connection**, then ask:

> Confirm the site identity and available capabilities. Show the top three
> existing tasks and the separate signals, with their evidence and data windows.
> Do not create a task, start a scan or change anything.

The first calls should be `get_site_context`, `get_capabilities`,
`get_work_queue` and `get_signals`. Verify the site identity before continuing.
Follow returned cursors when inspecting a group's targets; the dashboard's
four-item preview is not the complete target list.

The package declares Node.js 18 or later. Prefer a maintained LTS runtime;
Node 18 is end-of-life and its compatibility test is not a deployment recommendation.
The installed source-capture/preview chain is verified on macOS arm64 with
Node 18.20.8, 22.17.0 and 24.21.0, each against WordPress on PHP 8.2/8.5.
Other native workflow evidence uses Node 22 unless explicitly stated otherwise.
This does not verify every Node version, operating system, host or theme/builder.

## Profiles and tools

| Profile | Tool names | Use |
|---|---:|---|
| `core` (default) | 12 | Day-to-day research and approved change workflows. |
| `specialist` | 20 | Core plus deeper diagnostics and explicit scan/recovery workflows. |
| `legacy` | 42 | Temporary migration surface, **not** the old writer implementation. |

The twelve core names are:

- `get_site_context`, `get_capabilities`
- `get_work_queue`, `get_signals`
- `search_pages`, `get_page`, `diagnose_page`
- `update_work_item`
- `plan_changes`, `execute_change_set`
- `get_changes`, `rollback_change_set`

A listed name is **not** proof of permission or availability. Server capabilities,
current operator/PAT rights, licensing and the exact operation's development
gates determine what can run. Restart after an intentional capability change so
the client's tool schemas are rediscovered.

The specialist profile adds `get_site_diagnostics`, `get_gsc_pages`,
`get_redirects`, `get_images_missing_alt`, `get_topical_authority`,
`start_scan`, `get_scan_status` and `close_scan`. Merely selecting it does not
grant scan or recovery rights.

In the workflow entry's legacy profile, only `get_site_context`,
`get_capabilities`, `get_signals`, `get_priority_actions` and
`get_next_action` currently map to canonical reads. Other old names return a
migration error without running their old handlers. Old writes never fall back
to V1. The 0.4.x beta retains that profile for migration. Removal remains a
later release decision and is not performed by this beta.

## From research to an approved change

When the owned test site's exact operation is available:

1. Inspect the page and its evidence. Signals remain observations until an
   explicit `update_work_item` pickup. Notes, reviewed URLs and page importance
   are separate user-requested administrative writes, not website approval.
2. Use `plan_changes` to prepare the supported exact change. Show **every**
   target, before/after value, warning and required acknowledgement to the user.
   A stored proposal is not approval.
3. After explicit chat approval, submit the unchanged set, server-issued token,
   plan hash and required confirmations via `execute_change_set`. Changing the
   proposal requires fresh approval. WordPress stores an attestation, not the
   chat transcript; it does not independently verify what the person said.
4. Read the same execution with `get_changes`. If the response is lost or a
   timeout occurs, reconcile that ID first. Do not guess success, create a new
   set or repeat website writes automatically.
5. To undo eligible changes, request a new `rollback_change_set` proposal and
   obtain **new** approval. Changed current values, unsupported contexts or
   missing evidence can prevent rollback. Not everything is reversible.

Supported development policies cover metadata/social fields, attachment alt
text, redirects and restricted operations in TamRank's existing schema system.
No page-body/builder writes, automatic internal links, arbitrary JSON-LD or
new schema templates. Stored fields are not automatically proof of effective
frontend output. GSC outcome measurement is Phase 5, not a score-refresh claim.

Scans and interrupted-run recovery have their own explicit proposals and
permissions. `get_scan_status` never resumes a scan. A queued job is not proof
that a worker is running. Local receipt storage is optional and is not required
for a first read-only connection.

## Connection troubleshooting

| Symptom | Check / safe next step |
|---|---|
| Invalid workflow configuration | Replace the token placeholder with a real site-local PAT; verify both absolute paths and the site URL. |
| Redirect refused | Configure the final site URL. The workflow transport does not forward the PAT through redirects. |
| V2 compatibility / operation unavailable | Confirm matching builds and server capability readiness. Preview mode is not permission to bypass a missing feature. |
| Authentication / permission denied | Check token validity, local operator membership and required scopes. Do not widen scopes merely to silence an error. |
| JSON response missing / route not found | Verify the site path and REST configuration. Use `TAMRANK_REST_STYLE=query` only if that site's query-form routing is needed. |
| TLS failure | Fix certificate trust for the owned test host. Do not disable TLS verification. |
| Rate limit | Respect the returned wait guidance. No automatic retry loop or fresh token to evade the limit. |
| Timeout / connection loss after a write | Read the original execution and reconcile; do not blindly repeat it. |

HTTPS is required except for literal HTTP loopback hosts (`localhost`,
`127.0.0.1`, `[::1]`) in tests. A `.local` hostname over HTTP is not an allowed
loopback exception. Site URLs must not contain credentials, query parameters or
fragments; a subdirectory site path is permitted.

`TAMRANK_REST_STYLE` accepts `pretty` (default) or `query`.
`TAMRANK_TIMEOUT` is an integer number of milliseconds from 1 to 120000
(default 30000). These transport settings do not increase operation quotas.

## More than one client site

Keep one separately named server configuration per site, each with its own
site-local PAT/operator and exact URL. Copy the template above under names such
as `tamrank-client-a` and `tamrank-client-b`; do not share tokens between clients.
Confirm the target site before each proposal. Shared conversation history does
not transfer approval or permission between sites.

This is the current setup pattern, not an Agency-first redesign. In-chat site
switching, a shared keyring, portfolio briefings and cross-client bulk approval
are not implemented by this branch. Customer rollout remains a separate step.

## Verification and release boundary

`npm test` checks the installed package identity, entry point and compatibility
inventory without contacting a site. The source repository has additional
development and native WordPress suites; those fixtures and internal evidence
are intentionally not shipped. Passing a fixture is not live customer
activation, an npm publication or proof of all hosting/privacy compatibility.

MIT applies to this MCP package; site access remains subject to TamRank's current
licence and permission checks. See [LICENSE](LICENSE).
