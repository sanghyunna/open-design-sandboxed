# TODO: Manual Edit Follow-ups

Priority: P2 after the wrapper-targeting fix ships.

## Problem

The wrapper-targeting bug where Manual Edit selected labels such as `col` or
`zh` instead of inline text leaves is covered by the current fix.

## Current State

Manual Edit now source-maps common inline and table/caption text leaves before
the bridge runs, so clicking visible inline text inside a wrapper selects the
text leaf rather than the wrapper.

## Remaining Work

- Direct text nodes inside mixed containers are still not a rich editable unit.
  Example: `<p>Hello <strong>world</strong></p>` can safely edit the
  `<strong>` leaf, but replacing only `Hello` without flattening child markup
  needs a richer patch model.
- If production examples reveal another text-bearing tag missing from
  `MANUAL_EDIT_DISCOVERY_SELECTOR`, add that tag plus one focused regression.

## Acceptance

- Wrapper labels like `col` or `zh` no longer appear when the user clicked a
  mapped inline text leaf.
- Existing text-only container and nested-container protections remain green.
- Slide deck double-advance stays outside this patch.
