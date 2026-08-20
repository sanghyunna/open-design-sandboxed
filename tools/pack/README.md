# tools/pack

Local Windows portable packaging control plane for Readable Studio.

## Commands

- `tools-pack win build --to zip`
- `tools-pack win start`
- `tools-pack win inspect --expr "document.title"`
- `tools-pack win logs`
- `tools-pack win stop`
- `tools-pack win cleanup`
- `tools-pack win list`

Build artifacts are namespace-scoped under
`.tmp/tools-pack/out/win/namespaces/<namespace>/`. Packaged runtime state is
namespace-scoped under
`.tmp/tools-pack/runtime/win/namespaces/<namespace>/`.

Extract the portable ZIP anywhere on Windows and run the executable directly;
tools-pack does not create an installed product. Use `--portable` for artifacts
that leave the local build workspace so packaged configuration does not contain
the build machine's tools-pack runtime roots.

Windows portable archives retain the shared bundled resource trees and generic
sidecar/platform runtime primitives used by the packaged application.

Builder-generated updater metadata is local scratch. Use
`pnpm tools-serve start updater` for deterministic updater metadata and
artifacts; tools-pack does not publish release feeds.
