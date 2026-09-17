# H3a partial library preparation — not a hosted runtime

Basis: `2598a4a`, SDK `1.29.0`, Node `22.17.0`. Reviewed against
`hosted-mcp-h0-4` and the H3a dispatch brief dated 2026-09-17. This branch does
not yet provide `createWorkflowServer`,
a hosted package export, an injected production transport, or server hooks.
The existing stdio implementation is unchanged.

## Implemented, independently testable components

`src/hosted/error-map.js` exports the pure `mapHostedOutcome` classifier.
Its inputs are `status`, `code`, `validWpEnvelope`, `kind: read | write`, and
optional `retryAfter`. The caller must validate the WordPress envelope before
setting `validWpEnvelope`; a code extracted from HTML is not sufficient.
The result has `code`, `retryable`, `outcome_unknown`, and optionally
`retry_after` for bounded 429 advice. This is classification only: it neither
revokes a grant nor changes link state, clears caches, or dispatches retries.

| Upstream evidence | Hosted code |
| --- | --- |
| 402 pro_required | site_entitlement_required |
| 401 agent_token_revoked / expired / invalid | site_reconnect_required |
| 401 agent_token_missing | upstream_auth_unavailable |
| 403 agent_scope_insufficient | site_scope_insufficient |
| 403 workflow_operator_unavailable | site_owner_unavailable |
| 409 workflow_profile_required | site_profile_required |
| workflow_upgrade_required | site_upgrade_required |
| 401 cloud_link_pending | site_link_unavailable |
| 401 cloud_link_revoked | site_reconnect_required |
| 429 | rate_limited |
| Unknown 401/403, HTML, network, timeout, 404, 5xx | site_unavailable |

Recognized WP errors require `validWpEnvelope: true`. For unavailable outcomes,
reads are retryable; writes are not and carry `outcome_unknown: true`. Known
configuration errors are not retryable and have a known rejected outcome. A
429 carries bounded retry advice, never an automatic retry instruction. The
classifier is not yet connected to the existing tool error boundary.

`test/hosted/stub-vps.mjs` provides the reusable synthetic seam. See the adjacent
README for fixture configuration. Run `npm run test:hosted` for both suites.

## Intended interface, not yet implemented

H3b supplies one immutable request context containing `validatedInstallation`
(installation/blog/link IDs, generation, canonical home URL, full REST base,
REST style and workflow profile), `grantContext` (grant/account/client IDs and
site scopes), `filteredCapabilities`, `auditContext` (grant label, client label
and request ID), `transport`, and `authorizer`. Exact audit client-label shape
and factory/stdio boundaries require the decisions below.

The upstream transport interface is
`request({method, url, headers, bodyBytes, timeoutMs, responseByteLimit, signal})`
returning `{status, headers, bodyBytes}`. The stub requires Uint8Array bodies,
using an empty array for bodyless requests. A request has a maximum 30-second
budget; ordinary reads allow 524288 response bytes; proposal/execution routes
allow 1048576. Request bodies are bounded at 1048576 bytes in the planned bridge;
the stronger existing plan limits remain. The stub observes these inputs but
does not implement a real deadline or streaming response limiter.

Intended hook order is schema validation, authorization, dispatch, semantic
response validation, then result recording. Authorization returns `{ok:true}`
or `{ok:false,code,message,retryable}` and denial sends nothing upstream.
Recording a proposal must succeed before its result can reach the client.
H3b owns atomic proposal binding storage, cross-grant denial, current scope
checks, PAT injection/redaction, DNS/IP/TLS safety, rate/concurrency limits and
capability cache policy. No server hook integration is claimed by this branch.

## Blocking contract candidates

1. The dispatch brief line 32 and criterion 3 require both a raw-base byte
   prefix and the encoded query fixture. The raw base
   `https://site.example.invalid/?rest_route=/tamrank/v2` is not a byte prefix
   of `https://site.example.invalid/?rest_route=%2Ftamrank%2Fv2%2Fcloud-links%2Fidentity`.
   Candidate: compare origin/path plus the decoded `rest_route` namespace,
   while preserving the exact encoded output fixture. No implementation yet.
2. H0-3 sections 7/8 require a server-supplied OAuth client name. The dispatch
   brief lines 35/67 preserve MCP `clientInfo`. Select the authority and exact
   name/version representation before changing confirmation bodies.
3. The brief criterion 2 requires the sole factory to reject specialist,
   legacy and preview contexts. Criterion 9 requires existing specialist stdio
   behavior to remain. Candidate: one internal builder with a strict public
   hosted wrapper and a distinct stdio adapter. No implementation yet.
4. `proposal_binding_failed` with `retryable:true` is a proposed SET02 code,
   absent from H0-3 section 9. The fail-closed behavior is required; the exact
   error and read-recorder failure behavior need recording in the contract.

## H0-4 reconciliation

The final H0-4 sections 5, 7, 8 and 9 were reread. Section 5 specifies the
separate H1b-2 identity probe (2500 ms, 8 KiB, IP pinning, no redirects, one
in-flight request per origin and eight globally); these are not the workload
transport limits. Section 7 explicitly preserves consent-time grant scopes
under broader site/PAT permissions. Section 8 retains the library interface.
Section 9 adds H1a account/signature/nonce responses; these are outside this
workload classifier. None resolves the four contract candidates above. The
mapping rows used here remain unchanged. No H0-4 difference changes existing
stdio behavior in this partial branch.

## Evidence boundaries

The unmodified baseline passed `npm run test:dev`, `npm run test:workflow`,
`npm run test:workflow-package` and `npm test` before these isolated additions.
The new classifier tests cover the ERR02 mapping cases and WRITE01 uncertain
write classification only. They do not prove either full scenario. SET01,
SET02, CTX01, SCOPE01 and PROTO01 are not proved. Factory, hooks, hosted URL
binding, audit propagation, package exports, production transport, hosted
client interoperability and deployment remain outstanding. No merge, tag,
release or npm publication is authorized by this preparation.
