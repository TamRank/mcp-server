# Synthetic VPS seam

Run `node test/hosted/stub-vps-test.mjs` and `node test/hosted/error-map.mjs`.

`createStubVps(options)` returns `{ transport, authorizer, events, calls, recorded }`.
The transport consumes `responses` in order, once per call. Each response can
contain `method` and `url` assertions, `status`, `headers`, `bodyBytes`, a JSON
`body`, an `html` string, or `failure: 'timeout' | 'network'`. It refuses hosts
outside `.example.invalid` and never connects to a network. Requests must include
all seven interface fields; an absent body is an empty Uint8Array.

`decisions` maps tool names to authorization results. An unspecified tool is
allowed for fixture convenience. `recorderFailure: true` rejects every recorded
result; a tool name rejects only that tool. Events preserve call order and copies
of arguments. This allow-by-default behavior is strictly a test convenience.

H3b must replace the transport with installation-bound HTTPS, DNS/IP validation,
TLS pinning, credential injection and redaction, response bounds and deadlines,
and the required rate/concurrency limits. Replace the authorizer with current
grant, scope, site and ownership checks, plus atomic proposal binding storage.
Never reuse the stub's allow-by-default behavior in a hosted deployment.

These tests prove the seam itself, not server hook placement, SET01/SET02,
multi-tenant isolation, HTTP/OAuth interoperability, or a deployed runtime.
