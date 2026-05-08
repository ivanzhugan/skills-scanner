# SkillSet

SkillSet is a local web app for understanding and managing Claude Code skills.

Run one local command, open the browser UI, and inspect the skills installed in:

- `~/.claude/skills`
- `<current-project>/.claude/skills`

The current version focuses on local discovery, inspection, health signals, category grouping, visibility state, and a manifest-backed safety model. It does not delete or move original skill folders.

## Current Product Shape

SkillSet is a TypeScript full-stack local app:

- CLI launcher in `apps/cli`
- Node local backend in `apps/server`
- React/Vite frontend in `apps/web`
- Shared TypeScript types in `packages/shared`

The backend binds only to `127.0.0.1` and serves both the API and the built frontend.

## Quick Start

```bash
npm install
npm run build
node apps/cli/dist/index.js --no-open
```

Open the printed URL, usually:

```text
http://127.0.0.1:4317
```

If the port is busy, SkillSet automatically chooses the next available port and prints it.

## CLI Options

```bash
node apps/cli/dist/index.js
node apps/cli/dist/index.js --no-open
node apps/cli/dist/index.js --port 4317
node apps/cli/dist/index.js --cwd /path/to/project
node apps/cli/dist/index.js --skillset-home /tmp/skillset-test
```

Options:

- `--no-open`: start the server without opening a browser.
- `--port`: preferred local port. Falls back if busy.
- `--cwd`: project directory used to detect `.claude/skills`.
- `--skillset-home`: directory for `manifest.json` and managed active skills. Useful for safe testing.

You can also set:

```bash
SKILLSET_HOME=/tmp/skillset-test node apps/cli/dist/index.js --no-open
```

## What Works Now

### Library

The Library is the default view.

It shows a full-width table of installed skills with:

- skill name and path
- inferred category
- trigger summary
- visibility state
- scripted/risk badges
- health finding count

Clicking a row opens a right-side drawer with:

- full description
- category/source/profile state
- trigger phrases
- reason to keep active
- referenced files
- risk signals
- health findings
- original path
- visibility actions

### Category Grouping

SkillSet infers categories from names, descriptions, body text, and paths.

Current categories:

- Design & UX
- Frontend
- Backend
- Testing & QA
- Code Review
- Security
- DevOps & Deploy
- Data & Analytics
- Docs & Writing
- Product & Strategy
- Project Memory
- Automation & Agents
- GitHub & Collaboration
- Browser & Research
- Environment & Tooling
- Other

Categories are inferred, not user-authored yet. Manual overrides are a likely future feature.

### Search And Filters

Library search checks:

- skill name
- description
- trigger phrase
- file path
- profile
- state
- health finding text

Filters:

- All
- Visible
- Quiet
- Broken
- Scripted
- No profile

### Health Signals

The scanner detects:

- missing `SKILL.md`
- unreadable or invalid `SKILL.md`
- invalid frontmatter
- missing referenced files
- missing scripts
- scripts referenced as executable but missing executable permission
- duplicate skill names
- likely trigger overlaps
- broad descriptions
- scripted or risky behavior
- no profile assignment

Health results are currently signals with evidence. They are not claims about guaranteed Claude runtime behavior.

### Manifest And Visibility

SkillSet stores local state in:

```text
~/.skillset/manifest.json
~/.skillset/active/
```

The manifest stores:

- skill records
- visibility state
- profiles
- active profile id
- last apply snapshot

Visibility actions update SkillSet state only. Original skill folders are preserved.

Applying a profile writes visible skills into the managed active directory. The current app does not yet automatically reconfigure Claude Code to read that managed directory.

## API

With the server running:

```bash
curl http://127.0.0.1:4317/api/state
curl http://127.0.0.1:4317/api/skills
curl http://127.0.0.1:4317/api/health
curl http://127.0.0.1:4317/api/manifest
curl http://127.0.0.1:4317/api/profiles
curl -N http://127.0.0.1:4317/api/events
```

Profile and visibility endpoints:

```text
POST  /api/profiles
PATCH /api/profiles/:id
POST  /api/profiles/:id/plan
POST  /api/profiles/:id/apply
POST  /api/skills/:id/visibility
POST  /api/undo
```

Use the printed port if SkillSet starts somewhere other than `4317`.

## Development

```bash
npm run build
npm test
npm run typecheck
```

The project uses npm workspaces. Root scripts intentionally build packages in dependency order.

## Testing Against A Temporary Manifest

Use this when you want to test visibility/profile behavior without touching your real `~/.skillset` state:

```bash
rm -rf /tmp/skillset-test
node apps/cli/dist/index.js --no-open --skillset-home /tmp/skillset-test
```

## Known Limitations

- Health findings are useful but still noisy, especially for generated gstack skills with command preambles.
- Category inference is heuristic and needs tuning against real user disagreement.
- Search/filter is implemented in the frontend only.
- The detail drawer uses basic browser confirmation for visibility changes; richer confirmation UI is still planned.
- Profiles have backend support, but the full Profiles UI is not built yet.
- Managed active directory exists, but Claude Code integration/reload behavior still needs a product decision.
- No hosted marketplace, ratings, accounts, or remote sync.

## Backlog

See [BACKLOG.md](./BACKLOG.md) for milestone tracking.

