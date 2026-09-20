# H3a check against PRO's "VOOR H3a" list — 19 September 2026

Source list: the "VOOR H3a" section of PRO's H2 final report (19 September
2026). The library was built on 17 September, before that list existed. PR #1 (H3a) was already merged into
`feat/mcp-workflows` and rewritten there as `82d5006..37f8259`; these fixes sit
on top of `37f8259` on `fix/hosted-mcp-h3a-voor-lijst`.

Proofs: `test/hosted/voor-h3a.mjs` (part of `npm run test:hosted`). Run against
the unfixed `37f8259` sources it reports `# tests 9`, `# pass 6`, `# fail 3`;
the three failures are exactly the three gaps below.

| # | PRO requirement | Result | Where |
| --- | --- | --- | --- |
| 1 | `agent.name = grant:<uuid>`, `client{name,version}` bound to the chat attestation, no `clientLabel` to PRO | met | `src/field-execution.js:18-19`, `src/workflow-tools.js:126,368`, `src/hosted/factory.js:58-59` |
| 2 | Internal workflow builder via the strict hosted wrapper, stdio adapter separate | met | `src/hosted/factory.js:67-74`, `src/workflow-server.js:25`, `index-workflow.js:5-7,17-18,40`, `src/workflow-rest.js:47`, `package.json` exports |
| 3 | Per-tool scope from capabilities; `importance.update` only if `work_administration.importance.available === true` | gap closed | `src/workflow-server.js:13-22`, `src/workflow-tools.js:407-413,434-438,361-364`, `src/field-execution.js:21` |
| 4 | Pretty and query REST without concatenated suffixes; namespaced `rest_base_url` from identity | met | `src/hosted/rest-base.js:4-31`, `src/hosted/factory.js:51-53,70` |
| 5 | Exact WP error mapping, `retry_after` from the JSON body, fail-closed on unknown or invalid envelopes | two gaps closed | `src/hosted/error-map.js:3-21`, `src/workflow-rest.js:120-128,146-151` |
| 6 | `proposal_binding_failed` and `result_recording_failed` retryable; no change-set ID or result on recorder failure | met | `src/workflow-tools.js:460-471` |

## Gaps closed

- **Point 3, read advertised by absence** (`230c802`). `tools/list` and the
  dispatch gate only refused `reads.<tool>.available === false`, so a read whose
  entry was missing from `filteredCapabilities` was listed and sent upstream.
  Hosted now needs `available === true`; stdio keeps its explicit-false rule.
- **Point 5, 429 without a valid envelope** (`be47db4`). Every 429 became
  `rate_limited` with `outcome_unknown:false`, and `data.retry_after` was read
  from a body whose `data.status` did not match. A 429 now needs a valid WP
  envelope (any code: PRO also returns `change_execution_rate_limited` and
  `change_store_*` limits as 429); an HTML/proxy/mismatched 429 is
  `site_unavailable`, writes `outcome_unknown:true`.
- **Point 5, unreadable contract after a write** (`eee70f1`). A 2xx with an
  unknown `contract_version` became `site_upgrade_required` with
  `outcome_unknown:false` after `execute_change_set`, `plan_changes` or
  `update_work_item`, although the site accepted the write. The code stays
  `site_upgrade_required` (H3b wipes its capabilities cache on it); writes now
  carry `outcome_unknown:true`.

Changed existing test: `test/hosted/error-map.mjs` lines 31 and 33 call the
429 case with `validWpEnvelope: true`; the expected results did not change.

## Client version

`clientInfo.version` exists only in the MCP `initialize` of a hosted session.
H3b builds one server per session through `createWorkflowServer`, so
`getClientVersion()` returns that session's clientInfo and the library sends it
to PRO in every execution confirmation (`confirmation.client.version`, PRO
stores it with the attestation). The link attempt happens during OAuth, before
that session exists; it can only carry the self-reported registration name
(`oauth_client.display_name`). A version there would be invented, so the link
attempt should not get one.

## Not changed, noted for later

- `workflow_response_limit` and `workflow_redirect_refused` after a hosted write
  pass through without an `outcome_unknown` flag (documented behaviour; the tool
  message tells the client to reconcile).
- `field_execution_incompatible_response` after a 2xx execute carries no
  `outcome_unknown` flag either; its message also asks for reconciliation.
