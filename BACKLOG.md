# SkillSet v1 Backlog

Status legend:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[!]` Blocked

Priority legend:

- `P0` Required for first usable local web app
- `P1` Required for v1 quality and safety
- `P2` Useful after the core loop works

## Product Direction

SkillSet v1 is a local web app for managing Claude Code skills. The CLI starts a local server, opens a browser UI, watches local skill folders, and lets users inspect, organize, and control which skills Claude can see.

The product starts with Library, not Health. The first user question is: "What skills do I have, and why should each one be active?"

Primary surfaces:

- Library: all installed skills, search, filters, selected-skill inspector, visibility actions.
- Health: issue queue for broken skills, overlaps, broad descriptions, scripted/risky skills.
- Profiles: visibility editor for choosing which skills Claude can see for a workflow.

Core principle: SkillSet changes visibility, not ownership. It must not delete or move original skill folders in v1.

## Technical Direction

Chosen architecture:

- TypeScript full stack.
- Node.js local backend.
- React frontend.
- Vite frontend build.
- CLI launcher distributed by npm.
- Backend binds to `127.0.0.1`.
- Local app opens at `http://127.0.0.1:<available-port>`.
- Server-Sent Events for live updates.
- Manifest stored at `~/.skillset/manifest.json`.
- Original skill folders are preserved.
- Visibility changes require confirmation and must be undoable.

Important implementation note:

Claude Code skills are filesystem-based directories with `SKILL.md`. SkillSet must be honest in UI copy that visibility changes may require Claude Code to restart or reload before they affect a running Claude session.

## Milestone 0: Repository Foundation

Goal: create a buildable project skeleton with a CLI, backend, frontend, shared types, and test harness.

### Task 0.1: Create project package structure

- Priority: P0
- Status: [x]
- Owner: Codex

Create:

```text
package.json
tsconfig.base.json
apps/
  cli/
  server/
  web/
packages/
  shared/
fixtures/
```

Acceptance criteria:

- Root `package.json` uses npm workspaces.
- `npm install` succeeds.
- `npm run build` exists, even if initially minimal.
- `npm test` exists, even if initially empty.

Implementation notes:

- Keep setup simple. Do not introduce Nx/Turborepo unless needed later.
- Use TypeScript project references only if they reduce friction.

### Task 0.2: Add shared type package

- Priority: P0
- Status: [x]

Create shared types for:

- `Skill`
- `Profile`
- `Manifest`
- `HealthFinding`
- `VisibilityPlan`
- `SkillRoot`
- `ReferencedFile`
- `RiskLabel`

Acceptance criteria:

- Server and web can import shared types.
- Types compile without circular imports.
- Types match the PRD enough to avoid frontend/backend drift.

### Task 0.3: Add basic test runner

- Priority: P0
- Status: [x]

Set up a test runner for backend and shared logic.

Acceptance criteria:

- `npm test` runs from repo root.
- Test command can execute TypeScript tests.
- At least one placeholder shared test passes.

Recommended default:

- Use `vitest`.

## Milestone 1: Local Server and CLI Launcher

Goal: `skillset` starts a local server and opens the web app.

### Task 1.1: Implement local server bootstrap

- Priority: P0
- Status: [x]

Build a Node server that:

- binds only to `127.0.0.1`
- tries default port, then falls back to the next available port
- exposes `/api/state`
- serves a placeholder frontend

Acceptance criteria:

- Server never binds to `0.0.0.0`.
- If the default port is taken, app still starts.
- `/api/state` returns JSON with server status, port, cwd, and watched roots.

### Task 1.2: Implement CLI launcher

- Priority: P0
- Status: [x]

Create `skillset` binary.

CLI behavior:

```bash
skillset
skillset --no-open
skillset --port 4317
skillset --cwd /path/to/project
```

Acceptance criteria:

- `skillset` starts server and opens browser.
- `--no-open` starts server and prints URL only.
- `--cwd` controls project skill root detection.
- Process logs local URL clearly.

Implementation notes:

- Use a small cross-platform browser opener.
- Make server shutdown clean on SIGINT.

### Task 1.3: Serve built web frontend

- Priority: P0
- Status: [x]

Backend serves the built React app.

Acceptance criteria:

- One local URL loads the web app.
- Refreshing any app route does not 404.
- Offline mode works after dependencies are installed.

### Task 1.4: Add live connection status

- Priority: P1
- Status: [x]

Frontend shows:

```text
Live - Watching ~/.claude/skills and this project's .claude/skills
```

Acceptance criteria:

- UI shows connected state when `/api/events` is connected.
- UI shows disconnected state if SSE connection drops.
- UI does not expose a primary manual "scan again" action.

## Milestone 2: Skill Discovery and Parsing

Goal: scan real local Claude skills and produce useful skill records.

### Task 2.1: Detect skill roots

- Priority: P0
- Status: [x]

Detect:

- global root: `~/.claude/skills`
- project root: `<cwd>/.claude/skills`

Acceptance criteria:

- Missing roots are represented as empty roots, not fatal errors.
- Roots include type: `global` or `project`.
- `/api/state` exposes detected roots.

### Task 2.2: Scan skill directories

- Priority: P0
- Status: [x]

Scan each root for skill folders.

Rules:

- A valid skill folder contains `SKILL.md`.
- A folder without `SKILL.md` is an invalid skill candidate and should produce a Health finding.
- Avoid duplicate records for the same real path.

Acceptance criteria:

- Valid skill folders appear in Library.
- Invalid folders are not silently ignored.
- Duplicate folder names from different roots are disambiguated by path/source.

### Task 2.3: Parse `SKILL.md`

- Priority: P0
- Status: [x]

Extract:

- frontmatter
- display name
- description
- allowed tools if present
- Markdown body
- likely trigger phrases

Acceptance criteria:

- Skill inspector can show name, description, trigger phrases, and frontmatter.
- Parser tolerates missing or invalid frontmatter.
- Invalid frontmatter creates a Health warning instead of crashing scan.

Implementation notes:

- Use `gray-matter` or equivalent.
- Trigger phrases can start with description plus key phrases from headings/body.

### Task 2.4: Extract referenced files and scripts

- Priority: P1
- Status: [x]

Detect:

- Markdown links to local files
- inline file paths
- code block script references
- shell command references to local scripts

Acceptance criteria:

- Missing references are reported with exact path.
- Existing references are shown in inspector.
- False positives are acceptable if evidence is visible and non-blocking.

### Task 2.5: Add filesystem watcher

- Priority: P1
- Status: [x]

Watch configured roots for changes.

Acceptance criteria:

- Adding a new skill updates Library without refresh.
- Editing `SKILL.md` updates inspector after debounce.
- Deleting a skill removes or marks it missing without crashing.
- Watcher errors are shown in app state.

Implementation notes:

- Use `chokidar`.
- Debounce events to avoid repeated scans.

## Milestone 3: Manifest and Safety Model

Goal: persist skill state, profile membership, visibility state, and undo snapshots.

### Task 3.1: Create manifest store

- Priority: P0
- Status: [x]

Manifest path:

```text
~/.skillset/manifest.json
```

Manifest stores:

- version
- roots
- skill records
- profiles
- active profile id
- last apply snapshot

Acceptance criteria:

- Manifest is created on first run.
- Writes are atomic.
- Corrupt manifest is backed up and replaced with a fresh manifest only after warning.
- Original skill folders are not touched.

### Task 3.2: Persist profile membership and visibility state

- Priority: P0
- Status: [x]

Track:

- which profiles contain each skill
- whether a skill is visible or quiet
- current active profile

Acceptance criteria:

- Restarting SkillSet preserves profile membership.
- Restarting SkillSet preserves visible/quiet state.
- Unknown skills discovered later default to Library/quiet unless already visible in Claude root.

### Task 3.3: Build visibility planner

- Priority: P0
- Status: [x]

Given a target profile, generate a dry-run plan:

- skills to make visible
- skills to make quiet
- unchanged visible skills
- unchanged quiet skills
- affected paths
- warnings

Acceptance criteria:

- Planner does not write files.
- Profile apply confirmation uses planner output.
- Plan includes enough detail for user trust.

### Task 3.4: Implement managed visibility strategy

- Priority: P0
- Status: [x]

Implement safe v1 strategy for visible skills.

Required invariant:

- Never delete or move original skill folders.

Preferred approach:

- Managed active directory under `~/.skillset/active`.
- Symlink visible skills into managed active directory.
- If symlink fails, use copy fallback with clear warning.

Open technical spike:

- Determine how Claude Code should read the managed active directory without confusing existing `~/.claude/skills`.
- If direct Claude configuration is not available, v1 may manage a project `.claude/skills` directory with explicit user confirmation.

Acceptance criteria:

- Applying a profile changes only managed paths.
- Original paths remain unchanged in tests.
- UI shows exact affected paths before apply.

### Task 3.5: Implement undo last apply

- Priority: P1
- Status: [~]

Store previous active visibility plan before applying changes.

Acceptance criteria:

- `Undo last apply` restores prior visible/quiet state.
- Undo is available in UI after successful apply.
- Undo failure shows exact error and leaves manifest consistent.

Implementation note:

- Backend undo is implemented and verified through `POST /api/undo`.
- UI surfacing remains for Milestone 7 profile workflow.

## Milestone 4: Health Detection

Goal: convert static skill analysis into useful, evidence-based issue groups.

### Task 4.1: Missing and invalid skill detector

- Priority: P0
- Status: [x]

Detect:

- missing `SKILL.md`
- unreadable `SKILL.md`
- invalid frontmatter

Acceptance criteria:

- Health shows affected skill/folder.
- Health shows exact error.
- Invalid folders can be filtered in Library.

### Task 4.2: Missing reference detector

- Priority: P0
- Status: [x]

Detect:

- missing referenced files
- missing scripts
- non-executable scripts when executable permission is expected

Acceptance criteria:

- Health shows missing path.
- Inspector shows file/risk section.
- "Show in Library" filters to affected skills.

### Task 4.3: Scripted and risky behavior detector

- Priority: P1
- Status: [x]

Flag signals:

- shell commands
- deploy commands
- git mutation commands
- filesystem mutation commands
- network tools
- package install commands

Acceptance criteria:

- Scripted/risky label appears in Library.
- Health issue explains that this is a signal, not a blocker.
- User can inspect evidence.

### Task 4.4: Broad description detector

- Priority: P1
- Status: [x]

Flag descriptions that are likely too broad.

Examples:

- "Use for coding tasks"
- "Helps with development"
- "General assistant skill"

Acceptance criteria:

- Broad descriptions appear as Health warnings.
- Evidence includes the exact description.
- UI copy says "may trigger too often," not "will trigger."

### Task 4.5: Trigger overlap detector

- Priority: P1
- Status: [x]

Group likely overlapping skills by terms in name/description/body.

Examples:

- PR review cluster
- design review cluster
- shipping/deploy cluster
- QA/browser testing cluster

Acceptance criteria:

- Health shows cluster name, involved skills, and matching terms.
- Overlap detector never claims certainty.
- User can navigate from overlap issue to filtered Library view.

### Task 4.6: No-profile detector

- Priority: P2
- Status: [x]

Flag skills that are installed but not assigned to any profile.

Acceptance criteria:

- Health shows unassigned skills.
- User can assign from Library or Profiles.

Implementation note:

- Backend detection is implemented. Full Health-to-Library navigation remains part of Milestone 6.

## Milestone 5: Library UI

Goal: make Library the best surface for understanding installed skills.

### Task 5.1: Build Library as default view

- Priority: P0
- Status: [x]

Library opens first.

Acceptance criteria:

- User lands on Library after launching app.
- Page copy explains installed vs visible.
- No manual scan/export buttons in the primary header.

### Task 5.2: Add Library search

- Priority: P0
- Status: [x]

Search by:

- skill name
- description
- trigger phrase
- file path
- profile
- state

Acceptance criteria:

- Search is inside Library panel.
- Search filters immediately.
- Empty state explains no matches.

### Task 5.3: Add Library filters

- Priority: P0
- Status: [x]

Filters:

- All
- Visible to Claude
- Quiet
- Broken
- Scripted
- No profile

Acceptance criteria:

- Filters combine with search.
- Selected filter is obvious.
- Counts are optional for v1 but useful if cheap.

### Task 5.4: Add skills table

- Priority: P0
- Status: [x]

Columns:

- Skill
- When Claude may use it
- Where it belongs
- State

Acceptance criteria:

- Selecting a row updates inspector.
- Broken/scripted/visible/quiet state is visible.
- Table handles 100+ skills.

### Task 5.5: Add selected skill inspector

- Priority: P0
- Status: [x]

Inspector sections:

- purpose
- current state
- trigger phrases
- what can happen when active
- files and risk
- actions

Acceptance criteria:

- User can answer "Can Claude see this skill?"
- User can answer "Why would I keep this active?"
- User can answer "What risk or side effect might happen?"

### Task 5.6: Add visibility actions with confirmation

- Priority: P1
- Status: [~]

Actions:

- Keep visible
- Move to profile
- Make quiet

Acceptance criteria:

- Clicking action opens confirmation modal.
- Modal explains path effects and undo.
- No filesystem mutation happens before confirmation.

Implementation note:

- Keep visible and Make quiet are implemented with confirmation.
- Move to profile and richer confirmation details are deferred to the Profiles workflow in Milestone 7.
- Library now uses inferred categories as the main grouping model and opens skill details in a drawer instead of a persistent inspector column.

## Milestone 6: Health UI

Goal: make Health a repair queue, not a vague dashboard.

### Task 6.1: Build issue queue layout

- Priority: P1
- Status: [ ]

Layout:

- left: issue categories
- right: selected issue detail

Acceptance criteria:

- Selecting an issue updates detail panel.
- First issue selected by default.
- Health does not use an aggregate score.

### Task 6.2: Build issue detail panel

- Priority: P1
- Status: [ ]

Detail shows:

- issue title
- why it matters
- affected skills
- exact evidence
- action
- whether action changes files

Acceptance criteria:

- Every issue has evidence.
- User can inspect affected skills.

### Task 6.3: Link Health to Library

- Priority: P1
- Status: [ ]

Behavior:

- "Show in Library" switches to Library.
- Library is filtered to affected skills.

Acceptance criteria:

- Health issue navigation preserves context.
- User can return to Health without losing selected issue.

## Milestone 7: Profiles UI

Goal: let users choose what Claude can see for each workflow.

### Task 7.1: Create default profiles

- Priority: P0
- Status: [ ]

Default profiles:

- Minimal
- Frontend
- Shipping
- Security
- Founder
- Full Power

Acceptance criteria:

- Profiles exist on first run.
- Full Power includes all discovered skills.
- Other profiles start with sensible defaults if obvious, otherwise empty with suggestions.

### Task 7.2: Build profile list

- Priority: P1
- Status: [ ]

Show:

- profile name
- short description
- visible skill count

Acceptance criteria:

- Selecting profile updates editor.
- Active/applied profile is visually distinct.

### Task 7.3: Build profile editor

- Priority: P1
- Status: [ ]

Editor shows:

- visible skills bucket
- quiet skills bucket
- broken skills excluded
- unresolved overlaps

Actions:

- Add
- Make quiet
- Move
- Apply profile

Acceptance criteria:

- User can stage profile changes before applying.
- User can see exactly what Claude would see.

### Task 7.4: Add apply confirmation modal

- Priority: P0
- Status: [ ]

Confirmation shows:

- skills becoming visible
- skills becoming quiet
- affected managed paths
- original paths preserved
- undo availability
- Claude Code restart/reload caveat

Acceptance criteria:

- Applying profile requires explicit confirmation.
- Modal is specific to the selected profile.

### Task 7.5: Add undo UI

- Priority: P1
- Status: [ ]

After profile apply:

- show undo affordance
- undo restores previous state

Acceptance criteria:

- Undo works after apply.
- Undo state clears after successful undo.

## Milestone 8: API and Live Updates

Goal: make frontend state real and live.

### Task 8.1: Implement REST API

- Priority: P0
- Status: [ ]

Endpoints:

```text
GET  /api/state
GET  /api/skills
GET  /api/skills/:id
GET  /api/health
GET  /api/profiles
POST /api/profiles
PATCH /api/profiles/:id
POST /api/profiles/:id/plan
POST /api/profiles/:id/apply
POST /api/skills/:id/visibility
POST /api/undo
```

Acceptance criteria:

- Frontend uses API, not hardcoded data.
- API errors are structured.

### Task 8.2: Implement SSE endpoint

- Priority: P1
- Status: [ ]

Endpoint:

```text
GET /api/events
```

Event types:

- `scan.started`
- `scan.completed`
- `skill.added`
- `skill.changed`
- `skill.removed`
- `manifest.changed`
- `health.changed`
- `apply.completed`
- `error`

Acceptance criteria:

- Frontend live status reflects SSE connection.
- Library updates after watched filesystem changes.

### Task 8.3: Add frontend data layer

- Priority: P0
- Status: [ ]

Implement:

- initial load
- refresh on SSE events
- loading states
- error states
- empty states

Acceptance criteria:

- UI handles no skills found.
- UI handles backend disconnect.
- UI handles scan error.

## Milestone 9: Confirmation, Safety, and Error Handling

Goal: make read/write behavior safe enough to trust.

### Task 9.1: Build confirmation modal

- Priority: P0
- Status: [ ]

Use for:

- make visible
- make quiet
- move to profile
- apply profile
- undo

Acceptance criteria:

- Modal explains exactly what changes.
- Modal includes cancel.
- Modal includes affected paths when relevant.

### Task 9.2: Add dry-run plan display

- Priority: P0
- Status: [ ]

Before write:

- call planner endpoint
- display plan
- only then allow confirm

Acceptance criteria:

- UI never writes directly from row/table click.
- Failed plan prevents write.

### Task 9.3: Add filesystem error handling

- Priority: P1
- Status: [ ]

Handle:

- permission denied
- symlink unsupported
- path missing during apply
- manifest write failure
- watcher failure

Acceptance criteria:

- Errors are visible and specific.
- Manifest remains consistent after failure.

## Milestone 10: Fixtures and Tests

Goal: make implementation safe to iterate.

### Task 10.1: Create fixture skill library

- Priority: P0
- Status: [ ]

Fixtures:

- valid simple skill
- broken skill
- missing reference skill
- scripted skill
- broad-description skill
- overlapping review skills
- duplicate name skills
- no-profile skill

Acceptance criteria:

- Fixtures are used by tests and manual dev mode.

### Task 10.2: Unit tests

- Priority: P0
- Status: [ ]

Cover:

- scanner
- parser
- manifest store
- health detectors
- visibility planner
- path normalization

Acceptance criteria:

- `npm test` runs all unit tests.
- Tests do not write outside temp directories.

### Task 10.3: Backend integration tests

- Priority: P1
- Status: [ ]

Cover:

- API state load
- scan fixtures
- health fixtures
- profile plan
- profile apply dry run
- undo
- SSE event emission

Acceptance criteria:

- Integration tests use temp fixture roots.
- Original fixture folders remain unchanged.

### Task 10.4: Frontend tests

- Priority: P1
- Status: [ ]

Cover:

- Library default route
- search/filter
- inspector selection
- Health issue navigation
- Profiles apply confirmation

Acceptance criteria:

- Core UI flows are covered.
- Tests can run headless.

### Task 10.5: Manual real-world test

- Priority: P1
- Status: [ ]

Run against a large real skill setup.

Record:

- skill count
- broken skills found
- overlaps found
- scripted skills found
- time to understand setup
- whether profiles feel useful

Acceptance criteria:

- SkillSet makes a 100+ skill directory understandable in under five minutes.

## Out of Scope for v1

- Public skill directory
- Hosted marketplace
- Accounts
- Ratings
- GitHub skill install
- Skill output benchmarking
- Claude runtime telemetry
- Team sync
- Plugin marketplace publishing
- Desktop wrapper
- Mobile-first UX

## Release Checklist

- [ ] `skillset` launches local web app.
- [ ] App binds only to `127.0.0.1`.
- [ ] Library is default view.
- [ ] Search and filters work.
- [ ] Skill inspector uses real scanned data.
- [ ] Health shows real detected issues.
- [ ] Profiles can stage visibility changes.
- [ ] Profile apply requires confirmation.
- [ ] Undo works.
- [ ] Original skill folders are never deleted or moved.
- [ ] App works without internet.
- [ ] Tests pass.
- [ ] Manual large-directory test completed.
