# Hosted MCP H3a library contract

Contract: hosted-mcp-h0-4 plus the four explicit decisions of 17 September 2026.
Basis: `2598a4abf2f03dc63b01929faf89f2478587346e`.
SDK: `@modelcontextprotocol/sdk@1.29.0`; protocol: `2025-11-25`.
This is the library half. No OAuth service, hosted HTTP endpoint, production
WordPress writes or live client interoperability is claimed here.

## Entrypoints and lifetime

`import { createWorkflowServer, discoverWorkflows } from '@tam-rank/mcp-server/hosted'`
constructs an unconnected server. H3b owns `server.connect(mcpTransport)` and
closing the server. `ctx.transport` is the **upstream WordPress transport**,
not the MCP client transport. The strict hosted wrapper uses the same internal
builder as the separate stdio adapter. The internal builder is not exported
from the public hosted module.

`index-workflow.js` retains existing core/legacy/specialist discovery and
private recovery behavior. Its environment configuration is translated at the
stdio boundary; no environment-selected customer or process exit exists in the
hosted library. No package version was bumped.

## Immutable context

The VPS supplies exactly these six top-level fields. Construction validates
them and deeply freezes the context before constructing a server. Request
context is not cached or held in mutable module state. Pass a new object for
every independent request context.

| Field | Shape and authority |
| --- | --- |
| validatedInstallation | installation_id UUID; blog_id positive safe integer; canonical_home_url HTTPS; rest_base_url full HTTPS namespace on the same origin; rest_style pretty/query; link_id safe identifier; generation positive safe integer; workflow_profile safe-beta-1 |
| grantContext | grant_id UUID; account_id/client_id safe identifiers; unique scopes[] drawn from the seven site scopes |
| filteredCapabilities | JSON capabilities object, contract_version 2 and safe-beta-1 compatibility or full_v2_compatible; VPS has filtered grant ∩ site ∩ membership ∩ profile |
| auditContext | grantLabel exactly grant:<grant_id>, at most 80 UTF-8 bytes; clientLabel nonempty safe label at most 80 bytes; request_id safe identifier |
| transport | request(input) async; optional synchronous redact(text) returning a string |
| authorizer | authorizeOperation(toolName, parsedArgs), recordValidatedResult(toolName, parsedArgs, result) |

Grant scopes: site:read, meta:write, audit:read, rollback, changes:write,
tasks:write, importance:write. No inference of additional grant scopes from a
wider site's capabilities. H3b owns current authorization, including zero-site
grant refusal. Factory rejects specialist/legacy/preview/recovery/receipt-store
contexts; the hosted tool profile is core only. No schema/redirect writes,
scan execution, recovery mode or legacy aliases are available.

The capable core catalog is the thirteen names: get_site_context,
get_capabilities, get_work_queue, get_signals, search_pages, get_page,
diagnose_page, update_work_item, plan_changes, execute_change_set, get_changes,
rollback_change_set, get_outcomes. Reduced capabilities hide unavailable tools in tools/list,
but a direct call still passes argument validation and current authorization.
A read is listed and dispatched only when filteredCapabilities.reads.<tool>
.available is true; a missing entry counts as unavailable (stdio still
refuses only an explicit false).

## Full REST base and route binding

Pretty: `https://site.example.invalid/wp-json/tamrank/v2` plus
`/site/context`.
Query: `https://site.example.invalid/?rest_route=/tamrank/v2` plus
`/cloud-links/identity` becomes exactly
`https://site.example.invalid/?rest_route=%2Ftamrank%2Fv2%2Fcloud-links%2Fidentity`.

Bind origin and pathname. Query mode requires exactly one rest_route base
parameter, decoded value /tamrank/v2. Validate the route suffix before encoding
(no percent escape or '..'); use searchParams.set to append within rest_route,
whose decoded result starts /tamrank/v2/. Separate route arguments are separate
query parameters and cannot override rest_route. This is not a byte-prefix
comparison against the raw unencoded query string.

Hosted configuration is HTTPS only; stdio alone may use HTTP loopback.
H3b revalidates every final destination with DNS/IP pinning and TLS checks.
The compatibility siteUrl/routeStyle constructor remains for existing stdio
consumers/tests; hosted:true rejects it and requires the full REST base.

## Upstream transport

`request({method, url, headers, bodyBytes, timeoutMs, responseByteLimit, signal})`
returns `{status, headers, bodyBytes}`. Bytes are Uint8Array/Buffer; bodyless
requests use an empty byte array. JSON is serialized once before dispatch.

| Boundary | Budget |
| --- | --- |
| Hosted request deadline | At most 30000 ms, AbortSignal plus bounded wait |
| Request body | At most 1048576 bytes before sending |
| Ordinary read response | 524288 bytes |
| Field proposal and execution/read routes | 1048576 bytes |
| Existing field-plan semantic limit | 25 items / 256 KiB, unchanged |

The H1b-2 identity probe's 2500 ms / 8 KiB limit is a **different** transport
profile, not this workload budget. The library verifies returned byte length;
H3b must enforce limits while streaming and honor AbortSignal, so a malicious
upstream cannot cause unbounded buffering in its transport.

Hosted code has no PAT: H3b injects Authorization. It must prevent credentials
in responses and may supply redact(text) for opaque secrets. The bridge also
scrubs recognizable PAT/private-receipt strings and never echoes raw network
exceptions. Stdio's fetch adapter owns its PAT and uses redirect:'manual'.

No request is automatically retried. A redirect produces
workflow_redirect_refused; over-budget responses produce
workflow_response_limit; oversized request produces workflow_request_limit
before any call. Timeout/unknown upstream failures after a write are uncertain:
read the set state before deciding what to do, never blindly resend.

## Hook ordering and refusal

1. Closed argument schema and semantic argument checks.
2. authorizeOperation(toolName, immutable parsedArgs).
3. Availability checks and dispatch.
4. Existing semantic response validation.
5. recordValidatedResult(toolName, immutable originalArgs, validatedResult).
6. Return the result only after recording succeeds.

Authorization returns {ok:true} or {ok:false,code,message,retryable}. Denial,
malformed permission or exception sends no request upstream. Set-bound hooks
receive change_set_id. Both tools/list and direct invocation are covered; a
hidden tool is not a way around current authorization.

Recorder success is {ok:true}. A refusal, malformed result or exception is
fail-closed: plan_changes and rollback_change_set return
proposal_binding_failed, retryable:true, with **no proposal/set ID/token** in
output. Other result-recording failures return result_recording_failed,
retryable:true and no read/result payload. These flags do not schedule retries.
On an execution-result recording failure, the caller must reconcile the
executed set before retrying any write. Recorder is never called for an
authorization denial, upstream error or semantically invalid result.

H3b implements the grant/set ownership store: persist a plan binding before
release, deny another grant before dispatch, and bind a new rollback proposal
to its owner. No binding database is implemented by H3a.

## Audit decision

confirmation.agent.name is ctx.auditContext.grantLabel, never an argument.
confirmation.client{name,version} remains the bounded, self-reported MCP
clientInfo exactly as before. ctx.auditContext.clientLabel is **not** put into
the PRO body. No new top-level confirmation fields. Stdio still uses
agent.name='unknown'. client_request_id derivation is unchanged.

## Pure upstream failure mapping

mapHostedOutcome takes status/code, whether the WP envelope is validated,
read/write kind and bounded retryAfter. It returns code/retryable/
outcome_unknown, optionally retry_after. It never changes persistent state.

| Evidence | Code |
| --- | --- |
| 402 pro_required | site_entitlement_required |
| 401 agent_token_revoked/expired/invalid | site_reconnect_required |
| 401 agent_token_missing | upstream_auth_unavailable |
| 403 agent_scope_insufficient | site_scope_insufficient |
| 403 workflow_operator_unavailable | site_owner_unavailable |
| 409 workflow_profile_required | site_profile_required |
| workflow_upgrade_required | site_upgrade_required |
| 2xx with an unreadable contract_version | site_upgrade_required; writes outcome_unknown:true |
| 401 cloud_link_pending | site_link_unavailable |
| 401 cloud_link_revoked | site_reconnect_required |
| 429 in a valid WP envelope (any code) | rate_limited; retry_after only from data.retry_after 1..3600 |
| Unknown JSON 401/403, HTML, network, timeout, 404/5xx, 429 without a valid envelope | site_unavailable; writes outcome_unknown:true |

A WP code alone is insufficient: code/message/data.status must match the HTTP
error before known-code mapping is trusted. Unknown JSON/HTML401 produces no
revocation instruction. H3b owns link blocks, grants, refresh/revoke, cache
invalidation, rate/concurrency limits, DNS/IP/TLS and hosted protocol transport.

## Protocol, packaging and tests

Initialize asking for 2026-07-28 negotiates 2025-11-25 on SDK 1.29.0.
No 2026 support is advertised; client acceptance/refresh/revoke remains H5.
discoverWorkflows remains exported for caller-managed discovery; no hosted
capabilitiescache or per-request authorization cache is implemented here.

The source handoff is docs/hosted-mcp/h3a-library-contract.md. The identical
HOSTED-MCP.md is bundled at the package root to preserve the existing npm test
that excludes internal docs/ and test/ directories. The synthetic VPS stub is
test/hosted/stub-vps.mjs in the repository, not bundled into the runtime.

Run npm run test:hosted and the unchanged test:dev, test:workflow,
test:workflow-package and npm test suites. The synthetic tests cover library
halves of SET01, SET02, CTX01, WRITE01, SCOPE01, PROTO01 and ERR02. They do not
prove the deployed VPS/PRO lifecycle, real customer data, OAuth, or live clients.
# Hosted composition after initialization

The returned server supports additional VPS-owned `registerTool` calls before
or after MCP initialization. Its live compact catalog includes these tools only
when their names were advertised in the immutable `filteredCapabilities.reads`.
The VPS owns their argument schema, current OAuth/account/site authorization,
rate limits and result audit; registering a tool does not supply these guards.
Disable, enable and removal use the same handles as the SDK. No local client,
keyring, credential store or additional WordPress connection is created.
`node test/hosted/extensions.mjs` checks list/call behavior through a real SDK
connection, including post-initialize registration and removed aliases.
