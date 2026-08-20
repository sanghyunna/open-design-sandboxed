# tools/pack

Follow the root `AGENTS.md` and `tools/AGENTS.md` first. This tool owns the repo-external packaged build/start/stop/logs command surface.

## Owns

- Local packaging orchestration for packaged Open Design artifacts.
- mac build/install/start/stop/logs/uninstall/cleanup smoke commands.
- Windows portable ZIP build/start/stop/logs/cleanup/list/inspect smoke commands.
- Linux AppImage build/install/start/stop/logs/uninstall/cleanup smoke commands.
- Linux headless (no-Electron) install/start/stop via `--headless` flag on `install`, `start`, and `stop`.
- Linux containerized builds via `electronuserland/builder` Docker image for distro-agnostic glibc compat.
- Consuming sidecar/process/path primitives from `@readable-studio/sidecar-proto`, `@readable-studio/sidecar`, and `@readable-studio/platform`.

## Does not own

- Product business logic.
- Sidecar protocol definitions.
- A second process identity model.
- Product/business update runtime integration.

## Rules

- Do not hand-build `--od-stamp-*` args; use `createProcessStampArgs` with `OPEN_DESIGN_SIDECAR_CONTRACT`.
- Do not use port numbers in data/log/runtime/cache path decisions. Namespace decides paths; ports are only transient transports.
- Do not let namespace-named `.app` installs change data/log/runtime/cache path conventions.
- Use `--portable` for artifacts that leave the local build workspace so packaged config does not bake local tools-pack runtime roots from the build machine.
- Pack resource files used by electron-builder belong under `tools/pack/resources/`; do not point pack logic at Downloads, web public assets, docs assets, or other app-owned resource paths.

## Packaged auto-update architecture and harness

Read this section before changing packaged auto-update behavior. The updater crosses package, desktop, web UI, release-feed, and installer surfaces, so bugs often hide between otherwise-green package tests.

### Architecture map

- `apps/desktop/src/main/updater.ts` owns updater state, release metadata parsing, artifact selection, checksum verification, download-store ownership, progress events, and opening the downloaded installer. It is pure main-process logic and is tested under `apps/desktop/tests/main/updater.test.ts`.
- `apps/desktop/src/main/runtime.ts` exposes updater IPC to the renderer through `od:update:status|check|download|install|quit` and emits `od:update:status-changed`. Keep installer launch separate from process shutdown; quit is an explicit post-installer action.
- `apps/desktop/src/main/index.ts` wires the scheduler. Native menu update actions are intentionally not the user-facing surface; the web updater UI owns discovery and action prompts.
- `apps/web/src/lib/updater.ts` normalizes host updater snapshots into UI-ready state.
- `apps/web/src/components/UpdaterPopup.tsx` is the visible updater surface in the left rail. All visible copy must go through `apps/web/src/i18n`.
- `apps/packaged/src/index.ts` passes packaged `appVersion` and namespace-scoped `updateRoot` into desktop main.
- `tools/serve` owns deterministic local updater fixtures only. It must not contain product updater runtime logic.
- `tools/pack` owns packaged build/start/inspect/logs/cleanup and the Windows portable ZIP harness.

### Release metadata shape

The runtime updater reads `https://releases.open-design.ai/<channel>/latest/metadata.json` unless `OD_UPDATE_METADATA_URL` overrides it. For package-launcher updates:

- mac selects `platforms.mac.artifacts.dmg`.
- Windows selects `platforms.win.artifacts.installer`.
- The artifact must have a checksum, preferably `sha256Url`; the updater verifies bytes before exposing an install action.
- `OD_UPDATE_CURRENT_VERSION` may override the packaged version for tests, but user-flow package validation should prefer building the package with the intended `--app-version`.

### Deterministic fixture harness

Use `tools-serve start updater` for fast, deterministic tests and e2e automation where network release state is not the thing under test. Fixture flow:

```bash
pnpm tools-serve start updater --json --channel beta --version 99.0.0-beta.1 --platform win
```

Then launch packaged desktop with:

```bash
OD_UPDATE_ENABLED=1
OD_UPDATE_METADATA_URL=<fixture metadataUrl>
OD_UPDATE_CURRENT_VERSION=99.0.0-beta.0
OD_UPDATE_OPEN_DRY_RUN=1
OD_UPDATE_AUTO_CHECK=1
```

This harness is appropriate for asserting IPC, popup rendering, progress, checksum/download-store behavior, and dry-run installer opening without depending on an external release feed.

### Validation matrix for updater changes

Run the narrow tests that match the surface you touched, then the repo checks:

```bash
pnpm --filter @readable-studio/desktop test -- tests/main/updater.test.ts tests/main/updater-host-boundary.test.ts tests/main/preload-host-boundary.test.ts
pnpm --filter @readable-studio/web test -- tests/components/UpdaterPopup.test.tsx tests/lib/updater.test.ts
pnpm --filter @readable-studio/tools-serve test
pnpm --filter @readable-studio/tools-pack test -- tests/win-app.test.ts tests/win-builder.test.ts tests/win-targets.test.ts tests/win-zip.test.ts
pnpm --filter @readable-studio/desktop typecheck
pnpm --filter @readable-studio/web typecheck
pnpm --filter @readable-studio/tools-pack typecheck
pnpm --filter @readable-studio/tools-serve typecheck
git diff --check
pnpm guard
pnpm typecheck
```
