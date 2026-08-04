# Hosted Pi third-party inventory

The hosted runtime is a build-time-staged artifact. Production startup never runs npm, pnpm, npx, a global `pi` binary, or an updater.

| Package | Version | Integrity / asset | License | Source |
| --- | --- | --- | --- | --- |
| `@earendil-works/pi-coding-agent` | `0.83.0` | `sha512-uYhF+FsZxogoSX/AxBcUdiY+ZklubwaXyAoEGA2eQwsHcyEAhUYIKh/WLXe/a8+k8eTCmxb+ZN2Zo9mzQtzbWw==` | MIT; author Mario Zechner | [pi](https://github.com/earendil-works/pi), `packages/coding-agent` |
| `@silvia-odwyer/photon-node` | `0.3.4` | `photon_rs_bg.wasm` is checked into the staged package and hashed in `hosted-pi-manifest.json` | Apache-2.0; collaborator Silvia O'Dwyer | [photon](https://github.com/silvia-odwyer/photon) |

The artifact is produced with `pnpm install --frozen-lockfile` in the build environment, followed by:

```text
pnpm --filter @open-design/daemon build
pnpm --filter @open-design/daemon deploy --prod --no-optional --ignore-scripts --legacy <staging-dir>
```

`scripts/hosted-pi-artifact.ts` records the staged lockfile hash, package licenses, versions, repositories, Pi integrity, and Photon WASM hash. It also audits the daemon production importer and rejects any high/critical advisory; unrelated workspace importers do not change the hosted result. The optional clipboard/native UI dependency is intentionally not installed; hosted RPC does not require it. The exact `undici@8.10.0` and `brace-expansion@5.0.9` overrides, plus patched daemon transitive pins, are part of the root and workspace lockfile policy.
