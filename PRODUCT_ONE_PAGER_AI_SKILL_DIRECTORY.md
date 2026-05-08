# Product One Pager: SkillSet V2

Generated: 2026-05-06  
Updated: 2026-05-08

## One-Liner

SkillSet is a local web app for Claude Code and AI agent skills: see what is installed, understand what each skill does, quiet noisy skills, group skills into profiles, and keep your agent setup usable as it grows.

## Problem

Power users are starting to accumulate too many agent skills. The setup gets powerful, then becomes hard to understand.

The pain is not only installation. The sharper pain is management:

- I have dozens or hundreds of skills installed.
- I cannot quickly see what each one does.
- I do not know which skills overlap or compete for activation.
- I cannot preview whether a skill produces good results before using it.
- I cannot easily disable noisy skills without deleting them.
- I cannot switch between a minimal setup, a frontend setup, a review setup, and a product-planning setup.
- I do not know which skills are broken, risky, stale, or unused.

The current workflow turns skill usage into guesswork. Users either tolerate a bloated setup or avoid installing useful skills because they do not want more chaos.

## Target User

Initial wedge:

Claude Code power users with many installed skills, especially users of large skill bundles such as gstack, custom `.claude/skills/` folders, or team-shared skill repos.

This user already believes skills are useful. They do not need to be convinced that skills exist. They need control over the skills they already have.

Secondary users:

- Teams that want a consistent Claude Code setup across projects.
- Skill authors who want their skills to be easier to inspect and trust.
- New Claude Code users who want a safe starter profile instead of a pile of random skills.

## Product Thesis

The first winning product is not a marketplace. A bigger directory makes the problem worse if users cannot evaluate or manage what they install.

SkillSet should start as the control plane for local skills.

The product should answer four questions:

1. What skills do I have installed?
2. Which ones are active, duplicated, broken, risky, or overlapping?
3. Which skills should be enabled for this project or workflow?
4. What will this skill probably do before I invoke it?

## Product

SkillSet starts as a local-first web app launched by a CLI.

Primary command:

```bash
skillset
```

This starts a local server on `127.0.0.1`, opens a browser UI, watches local skill folders, and serves a dashboard:

```text
Library

Installed skills: 143
Health findings: 64
Watched roots: 2

Categories:
- Frontend
- Design & UX
- Testing & QA
- Code Review
- DevOps & Deploy
- Docs & Writing
```

## Core Features

### 1. Local Skill Inventory

Scan installed skills from:

- `~/.claude/skills/`
- `.claude/skills/`
- compatible agent skill folders later

For each skill, show:

- name
- description
- inferred category
- install location
- active/disabled state
- referenced files
- scripts/tools used
- risk labels
- missing files
- last modified date

### 2. Quiet / Visible Without Deleting

Users should be able to remove a skill from the active agent context without losing it.

Initial UI actions:

- Keep visible
- Make quiet

Implementation uses a reversible SkillSet manifest and a managed active directory. Original skill folders are preserved.

### 3. Profiles

Profiles are the killer feature.

Instead of keeping every skill active all the time, users can switch between small, intentional skill sets:

Example profiles:

- Minimal: only the safest everyday skills
- Frontend: design review, QA, browser testing, visual polish
- Code Review: review, security audit, CI debugging
- Shipping: changelog, docs, release, deploy
- Founder Mode: office hours, CEO review, product planning

Profiles make large skill systems usable. They also become shareable artifacts later.

### 4. Skill Inspection

Users can inspect a skill before deciding whether to keep it active.

The inspection view should show:

- what the skill claims to do
- when it will likely trigger
- what files it references
- whether referenced files exist
- whether it uses scripts
- whether it asks for network or shell access
- similar installed skills
- example prompts if available

### 5. Overlap & Noise Detection

SkillSet should identify skills that are likely to compete for the same intent.

Examples:

- three skills with "review PR" in their description
- multiple design-review skills
- several deploy/ship skills
- broad descriptions like "use this for coding help"

The goal is not perfect model telemetry. The first version can use names, descriptions, tags, and simple similarity checks. Good enough is useful if it surfaces obvious clutter.

### 6. Broken Skill Detection

Detect:

- missing `SKILL.md`
- invalid frontmatter
- referenced files that do not exist
- scripts that are missing or not executable
- duplicate skill names
- empty or vague descriptions
- risky command patterns

This gives immediate value even before any public directory exists.

## Product Shape

Start with a local web app, not a web marketplace.

Why:

- The problem is local.
- The user is technical.
- The tool needs filesystem access.
- Privacy matters.
- A browser UI is better for scanning, filtering, categorizing, and inspecting 50-150 skills.
- A desktop wrapper is not worth the packaging cost before product-market fit.

The CLI remains the launcher and future automation surface:

```bash
skillset
skillset --no-open
skillset --port 4317
skillset --cwd /path/to/project
```

The Library should be the default surface:

- full-width table
- inferred category grouping
- health/visibility badges
- search and filters
- row click opens a detail drawer
- confirmations only for write actions

## Narrowest Wedge

Build SkillSet for one real setup first: a user with a large gstack or Claude Code skills directory.

The first demo should be:

```text
Before SkillSet:
143 installed skills. No clear way to know what is active, broken, duplicated, or safe to disable.

After SkillSet:
12 broken references found.
18 overlapping trigger descriptions found.
6 risky/scripted skills flagged.
5 workflow profiles created.
Visible skill set reduced from 143 to 24.
```

That is a clearer value proposition than "install more skills."

## Why Now

Claude Code skills are becoming a real extension mechanism. As people publish more `SKILL.md` workflows, the bottleneck moves from creation to management.

The ecosystem is already showing the symptoms:

- builders publish skill repos on X and GitHub
- users curate private skill folders
- large bundles contain too many skills to reason about manually
- reliability depends heavily on trigger descriptions
- there is no standard local manager for visible/quiet skills and workflow profiles

This is the same pattern every extension ecosystem hits: once installation is easy enough, organization becomes the next pain.

## Positioning

For Claude Code power users whose skill setup has become hard to understand, SkillSet is the local skill manager that makes installed skills visible, organized, and controllable.

Unlike a marketplace, SkillSet starts from the skills already on your machine.

Unlike a static curated list, SkillSet shows what is broken, duplicated, risky, or active in your actual setup.

Unlike manual folder management, SkillSet gives you profiles, inspection, checks, and reversible visibility controls.

## Open-Source Strategy

SkillSet should start as an open-source tool.

The open-source wedge:

1. Make it work on the maintainer's own overloaded skill setup.
2. Publish before/after screenshots of the local dashboard.
3. Invite Claude Code power users to run the local web app.
4. Let users share anonymized stats voluntarily:
   - number of installed skills
   - broken skills
   - overlaps found
   - risky/scripted skills
   - visible skills after cleanup
5. Use those reports to improve checks and build credibility.

The project should win trust by being local-first and useful without an account.

## Go-To-Market

Initial GTM should target users already feeling skill overload.

Channels:

- X posts from Claude Code and skill authors
- GitHub repos that publish Claude Code skills
- gstack users with many installed skills
- Claude Code Discord / forums / communities
- "show your skills folder" community posts

Launch post:

```text
I had 143 Claude Code skills installed and no idea what was active, broken, or overlapping.

Built SkillSet: a local manager for AI agent skills.

It found:
- 12 broken skills
- 18 overlapping trigger descriptions
- 6 risky/scripted skills
- 52 skills I could safely make quiet

Now I switch profiles: Minimal, Frontend, Review, Shipping.
```

The GTM loop:

1. User runs `skillset`.
2. User sees a surprising local Library and Health view.
3. User shares the report or screenshot.
4. Other power users run it on their setup.
5. Common issues become better checks.
6. Profiles become shareable community artifacts.

## MVP Scope

MVP must have:

- scan global and project Claude Code skill directories
- parse `SKILL.md`
- show a local dashboard
- list visible and quiet skills
- make skills visible or quiet reversibly
- create and switch profiles
- detect missing files and invalid skill structure
- detect obvious overlapping descriptions
- flag scripts and risky command patterns
- group skills by inferred category

MVP can defer:

- public marketplace
- accounts
- ratings
- hosted directory
- install-from-GitHub
- full security scanner
- actual Claude invocation telemetry
- benchmark arena
- desktop app

## Success Criteria

First 30 days:

- 500 local checks run
- 100 GitHub stars
- 30 users share reports or screenshots
- 20 users create at least one profile
- 10 external issues/PRs improving skill checks

Product quality:

- Works on a real large skill directory.
- Does not destroy or lose user skills.
- Every visibility action is reversible.
- Reports explain exactly what was detected and why.
- No account or network connection required for core use.

## Risks

Telemetry gap:

Claude Code may not expose reliable skill usage or trigger history. SkillSet should avoid depending on this at first. Static inspection and profile control are enough for v1.

Visibility semantics:

Moving or linking skill folders can break user expectations. The implementation must be conservative, reversible, and clearly documented.

False positives:

Overlap and risk detection will be imperfect. The product should explain signals, not pretend to know the model's behavior with certainty.

Limited virality:

A local manager is less naturally viral than a public directory. Reports, screenshots, and shareable profiles should carry the GTM.

Platform drift:

Claude Code skill paths or metadata may change. Keep parsing modular and support adapters later.

## Later Expansion

Once the local manager is trusted, SkillSet can expand into:

- shareable profile manifests
- curated profile packs
- install-from-GitHub
- skill output previews
- skill quality badges
- hosted directory powered by local checks
- team profiles and policy files
- benchmark runs for comparable skills

The directory should come from real local usage and checks, not the other way around.

## The Assignment

Build the first prototype against one overloaded real setup.

Use it to answer:

- How many skills are installed?
- Which skills are broken?
- Which skills overlap?
- Which skills are risky or scripted?
- Which 20 to 30 skills should stay visible in a practical default profile?
- How should visible/quiet control work without losing user data?

If the prototype makes one messy skill folder understandable in under five minutes, the product has a real wedge.
