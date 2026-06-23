# VDI loopback follow-up TODO

Date: 2026-06-23

## Current finding

- The packaged desktop UI may look like it uses `od://app/`, but the current data
  path still depends on loopback HTTP:
  `od://` -> packaged protocol handler -> web sidecar HTTP -> daemon HTTP.
- `localhost` or host propagation is only a diagnostic or partial fix. If the VDI
  blocks loopback TCP itself, it will not solve the packaged desktop path.
- Binding to `0.0.0.0` or a LAN address is not acceptable as the default corporate
  workaround because it widens the local API exposure surface.
- The real long-term fix, if VDI confirms true loopback TCP blocking, is a
  namespace-scoped named-pipe/Unix-socket HTTP transport for packaged desktop.
- OAuth/browser callback flows that hard-code loopback are separate edge cases and
  cannot automatically ride a named pipe.

## Verify before VDI-only checks

- [ ] Confirm whether packaged/Electron main-process fetches inherit proxy env:
  `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and `NODE_USE_ENV_PROXY`.
- [ ] Confirm whether `NO_PROXY` includes both `127.0.0.1` and `localhost`; if
  not, a small proxy-env patch may be enough for some corporate machines.
- [ ] Confirm whether `localhost` resolves to IPv6 `::1` while listeners bind only
  IPv4 `127.0.0.1`.
- [ ] Confirm the exact loopback HTTP call sites in packaged protocol, web
  sidecar proxying, daemon listen setup, and desktop runtime fetches.
- [ ] Confirm whether the dependency stack already supports HTTP over named
  pipes/sockets without adding a new dependency.
- [ ] Keep TCP as the dev/browser/CLI fallback unless the packaged corporate build
  explicitly selects pipe transport.

## Local verification results

Completed on 2026-06-23:

- Confirmed the packaged `od://` handler currently forwards through web sidecar
  HTTP, not a pipe transport:
  `apps/packaged/src/protocol.ts`, `apps/packaged/src/index.ts`.
- Confirmed the web sidecar still binds/listens through TCP and proxies daemon
  requests to `127.0.0.1`:
  `apps/web/sidecar/server.ts`.
- Confirmed daemon startup defaults to `127.0.0.1` and intentionally requires
  `OD_API_TOKEN` before non-loopback bind:
  `apps/daemon/src/daemon-startup.ts`, `apps/daemon/src/server.ts`.
- Confirmed desktop main-process daemon fetches intentionally use the real
  `http://127.0.0.1:<port>` daemon URL in packaged mode:
  `apps/desktop/src/main/runtime.ts`.
- Confirmed xAI OAuth callback is a separate hard-coded loopback listener:
  `apps/daemon/src/xai-oauth-server.ts`.
- Confirmed this PC has no `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, or
  `NODE_USE_ENV_PROXY` env values visible to the current shell.
- Confirmed this PC resolves `localhost` as `::1` first, then `127.0.0.1`.
- Confirmed Windows named-pipe HTTP is viable in principle with Node 24 +
  undici: a local HTTP server on `\\.\pipe\od-http-test-*` returned `ok:/health`
  through `undici.fetch(..., { dispatcher: new Agent({ connect: { socketPath } }) })`.
- Confirmed `undici` is present in the lockfile and daemon package, but
  packaged/desktop code would need an explicit dependency or shared transport
  wrapper if it imports `Agent` directly.

Validation commands passed:

- `pnpm --filter @open-design/packaged test -- --run protocol`
- `pnpm --filter @open-design/web test -- --run sidecar-proxy`
- `pnpm --filter @open-design/sidecar test -- --run index`
- `pnpm --filter @open-design/sidecar-proto test -- --run index`
- `pnpm --filter @open-design/daemon test -- --run daemon-startup xai-oauth-server`
- `pnpm guard`
- `pnpm typecheck`
- `pnpm --filter @open-design/packaged build`
- `pnpm --filter @open-design/web build`

Remaining VDI-only checks:

- Run `.\check-vdi-loopback.ps1` on the VDI after starting the packaged app.
- Check whether the packaged app process inside VDI has proxy env values that
  route loopback through a corporate proxy.
- Check whether `curl http://127.0.0.1:<web-port>` works inside the VDI while
  packaged `od://` fetches fail. If curl works, the problem is likely app
  process env/proxy/fetch behavior, not a kernel-level loopback block.
- Check whether `localhost` vs `127.0.0.1` behaves differently inside VDI.
- If both curl and packaged app fail on loopback TCP, treat pipe transport as
  the real fix path.

## Candidate patch shape

1. Phase A: add the smallest diagnostic/proxy-host fix only if local evidence
   shows the failure could be caused by proxy env or IPv4/IPv6 mismatch.
2. Phase B: if VDI confirms loopback TCP is blocked, add packaged-only pipe
   transport:
   - sidecar status exposes a namespace-scoped HTTP pipe/socket endpoint;
   - daemon and web sidecar can listen on that endpoint;
   - packaged `od://` fetches use the pipe/socket endpoint;
   - web sidecar proxies daemon API/artifact/frame requests over the pipe/socket;
   - desktop main-process daemon fetches use the same transport abstraction.
3. Validate with targeted unit tests plus `pnpm guard`, `pnpm typecheck`, and a
   packaged build before handing it to the VDI machine.
