# Open Design roadmap

This page is the durable entry point for current roadmap material. It describes
the repository's active product boundary; detailed work stays in
[`specs/current/`](../specs/current/) and in the repository's issue tracker.

## Current baseline

- Windows is the primary supported platform. macOS, Linux, and WSL2 are
  best-effort.
- The shipped runtime is a local daemon, the Next.js web app, and the Electron
  desktop/packaged shells.
- User-facing capabilities must be available through both the web UI and the
  `od` CLI, backed by the same daemon HTTP contracts.
- Local development runs through `pnpm tools-dev`; local packaged validation
  runs through `pnpm tools-pack` and deterministic updater fixtures from
  `pnpm tools-serve`.
- This workspace does not own hosted deployment, container orchestration, or a
  release-publishing pipeline.

## Active priorities

- Continue the staged maintainability work in
  [`specs/current/maintainability-roadmap.md`](../specs/current/maintainability-roadmap.md).
- Improve run reliability, observability, and recovery without weakening the
  local runtime boundary.
- Keep contracts, UI, CLI, and end-to-end coverage aligned as capabilities
  evolve.
- Preserve Windows-native behavior while making best-effort platforms easier
  to validate with package-scoped commands.

Current design work and accepted implementation plans are indexed under
[`specs/current/`](../specs/current/) and [`docs/plans/`](plans/). An item in
those directories is not a release promise; the associated issue or PR records
its actual status.

## Delivery and validation

Changes land through focused issues and pull requests. The repository-wide
minimum validation is:

```bash
pnpm guard
pnpm typecheck
```

Add package-scoped tests and builds for the files changed. There is no root
aggregate build or test command, and no repository-owned release workflow.

## Non-goals

- Reintroducing GitHub-hosted CI/CD, external release storage, or publishing
  automation without an explicit maintainer decision.
- Reintroducing Docker, Compose, Helm, Kubernetes, or cloud-provider deployment
  assets as workspace maintenance surfaces.
- Treating speculative schedules as commitments. New product directions should
  begin as an issue or current spec with an owner and validation plan.
