# youtube-tutorials

Keeps `app/content/tutorials/*.md` in sync with the latest community YouTube
tutorials about Open Design, with a human in the loop.

## Flow

```
maintainer runs notify-candidates.ts
  notify-candidates.ts
    → YouTube Data API search (videos published since the last successful run)
    → drop already-catalogued videos
    → LLM relevance gate (reject lookalikes / roundups)
    → post a numbered digest to Feishu

maintainer reviews the digest in Feishu and replies which numbers to publish

generate-selected.ts  (run by the maintainer / agent)
    → fetch the approved video ids
    → LLM-generate summary + body + category in each video's language
    → write *.md  → open a pull request
```

The script **never** generates entries or opens PRs on its own — selection is
the human review step, done in Feishu before any content is written.

The same daily digest also lists **user submissions** so they enter the same
review flow:

- **Submission issues** — open issues from the "Submit a tutorial" form (label
  `tutorials`). When a maintainer approves one, generate its entry from the
  video link in the issue body and open a PR with `Closes #<issue>` (the issue
  closes on merge):
  `tsx scripts/youtube-tutorials/generate-selected.ts <video-url-from-issue>`
- **Contribution PRs** — open PRs that touch `app/content/tutorials/**` and
  carry the `tutorials` label. Review/merge happens on GitHub as normal.

## Files

- `lib.ts` — shared core: relevance gate, LLM copy generation, slug rules,
  markdown writer, existing-id/slug readers.
- `youtube.ts` — YouTube Data API v3 client: key loading, candidate discovery
  (`fetchCandidates`), and id lookup (`fetchByIds`).
- `notify-candidates.ts` — posts the candidate digest to Feishu; run it
  manually when a refresh is needed.
- `generate-selected.ts` — turns approved video ids/URLs into entries.
- `backfill-tutorials.ts` — one-off importer that reads pre-fetched `yt-dlp -j`
  JSON lines (used for the initial backfill).

## Why the relevance gate

A YouTube search for "open design" surfaces many lookalikes (OpenCode,
OpenClaude, a separate small "Open Codesign" repo, generic AI-agent roundups,
and videos that only mention "Claude Design" in passing). Titles alone are not
enough, so every candidate passes an LLM relevance gate (`isAboutOpenDesign`)
before it ever reaches the digest.

## Secrets / env

| Var | Where | Purpose |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | local env or `~/.youtube/.env` | YouTube Data API v3 |
| `ANTHROPIC_AUTH_TOKEN` (or `ANTHROPIC_API_KEY`) + `ANTHROPIC_BASE_URL` | local env | relevance gate + copy generation (Claude Haiku) |
| `FEISHU_TUTORIALS_WEBHOOK` | local env | Feishu custom-bot incoming webhook for the digest |
| `FEISHU_TUTORIALS_SECRET` | local env (optional) | only if the Feishu bot has signature verification on |
| `GITHUB_TOKEN` + `GITHUB_REPOSITORY` | local env | include tutorial submission issues and PRs |

## Manual runs

```bash
# Reproduce the complete candidate digest locally (no Feishu post). --days is
# required for an intentional manual window; the GitHub env includes user
# submission issues and PRs.
GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY="sanghyunna/open-design-sandboxed" \
  npx tsx scripts/youtube-tutorials/notify-candidates.ts --days 14 --print

# Generate approved entries (ids or URLs), then open a PR with the new files
npx tsx scripts/youtube-tutorials/generate-selected.ts dQw4w9WgXcQ https://youtu.be/XXXXXXXXXXX

# Backfill from a yt-dlp dump
yt-dlp -a urls.txt --skip-download --cookies-from-browser chrome -j > videos.jsonl
npx tsx scripts/youtube-tutorials/backfill-tutorials.ts videos.jsonl [--dry-run] [--no-gate]
```
