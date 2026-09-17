# H3a delivery — 17 September 2026

Branch: `feat/hosted-mcp-h3a`, based on `feat/mcp-workflows@2598a4a`.
Implementation and full test run: `e64f01e`.
Contract: H0-4 plus the four head decisions of 17 September.

## Delivered

- Strict, immutable hosted factory over the internal shared builder; separate stdio adapter.
- Full REST namespace binding for pretty and query REST. Query routes are validated before encoding; client parameters cannot replace `rest_route`.
- Injected seven-field upstream transport, bounded bytes/deadline, no automatic retries, redaction and uncertain-write handling.
- Authorization before every upstream operation, including direct calls to hidden tools; validated-result recording fails closed.
- SET02 returns `proposal_binding_failed`, retryable true. Read recording failure returns `result_recording_failed`, retryable true. Neither releases the successful result.
- Trusted grant audit label; MCP clientInfo name/version preserved. No clientLabel in the PRO confirmation body.
- Safe-beta core catalog only. Existing stdio core/specialist/legacy behavior retained.
- Public hosted/discovery exports and bundled `HOSTED-MCP.md`. Internal builder remains private.

## Verification

All commands completed with exit code 0 on the implementation commit:

```text
npm run test:dev
npm run test:workflow
npm run test:workflow-package
npm test
npm run test:hosted
git diff --check
```

The existing workflow suite includes 85,848 catalog equivalence checks.
Package verification installs the extracted tarball using the repository lock
and checks 12/20/42 tool profiles and both REST forms. Hosted tests use the real
SDK in-memory transport and synthetic upstream responses.

Evidence entrypoints:

| Boundary | Implementation / test |
| --- | --- |
| Factory and context validation | `src/hosted/factory.js`, `test/hosted/factory.mjs` |
| Shared registration / separate stdio | `src/workflow-server.js`, `index-workflow.js` |
| REST binding and injected transport | `src/hosted/rest-base.js`, `src/workflow-rest.js`, `test/hosted/transport.mjs` |
| Authorization / SET01 / SET02 | `src/workflow-tools.js`, `test/hosted/factory.mjs` |
| Audit and MCP clientInfo | `src/field-execution.js`, `test/hosted/factory.mjs` |
| CTX01 | Twenty interleaved executions across two sites/grants, with isolated audit labels |
| PROTO01 | SDK initialize requesting 2026-07-28 responds with 2025-11-25 |
| WRITE01 / ERR02 | Timeout, unknown JSON/HTML and uncertain writes; no automatic second request |
| Public package | `test/hosted/package.mjs`, `test/workflow-package.mjs` |

## H3b integration boundary

Use [the library contract](h3a-library-contract.md) for the exact context,
transport and hooks. H3b owns OAuth, account/site/grant validation, SSRF-safe
DNS/IP-pinned transport, durable proposal/result recording, MCP HTTP transport,
connection lifetime and real-client acceptance. Library test success is not
evidence that any of those production components is deployed.

No live WordPress writes, npm publication, version bump, signing, release or
merge was performed. The original Downloads checkout remains clean on
`main@37faba8337458aa49708bf66a05b63d1fbbd449a`.
