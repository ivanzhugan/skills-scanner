import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, relative, resolve } from "node:path";
import matter from "gray-matter";
import type { HealthFinding, ReferencedFile, RiskLabel, Skill, SkillCategory, SkillRoot } from "@skillset/shared";

export type ScanResult = {
  skills: Skill[];
  healthFindings: HealthFinding[];
};

type ParseOutcome = {
  frontmatter: Record<string, unknown>;
  body: string;
  frontmatterError: string | null;
};

export async function scanSkillRoots(roots: SkillRoot[]): Promise<ScanResult> {
  const skills: Skill[] = [];
  const healthFindings: HealthFinding[] = [];
  const seenRealPaths = new Set<string>();

  for (const root of roots) {
    if (!root.exists) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(root.path, { withFileTypes: true });
    } catch (error) {
      healthFindings.push({
        id: stableId("root-read-error", root.path),
        type: "missing-skill-md",
        severity: "warning",
        skillIds: [],
        evidence: [root.path, errorMessage(error)],
        message: `Could not read ${root.label}.`
      });
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillPath = join(root.path, entry.name);
      const resolvedSkillPath = await safeRealpath(skillPath);
      if (seenRealPaths.has(resolvedSkillPath)) {
        continue;
      }
      seenRealPaths.add(resolvedSkillPath);

      const skillMdPath = join(skillPath, "SKILL.md");
      if (!(await fileExists(skillMdPath))) {
        const invalidId = stableId(root.id, skillPath);
        healthFindings.push({
          id: stableId("missing-skill-md", skillPath),
          type: "missing-skill-md",
          severity: "error",
          skillIds: [invalidId],
          evidence: [skillPath],
          message: `${entry.name} looks like a skill folder, but it does not contain SKILL.md.`
        });
        continue;
      }

      try {
        const skill = await readSkill(root, skillPath, skillMdPath);
        skills.push(skill);
        healthFindings.push(...skill.healthFindings);
      } catch (error) {
        const unreadableId = stableId(root.id, skillPath);
        healthFindings.push({
          id: stableId("unreadable-skill-md", skillMdPath),
          type: "invalid-frontmatter",
          severity: "error",
          skillIds: [unreadableId],
          evidence: [skillMdPath, errorMessage(error)],
          message: `${entry.name} has a SKILL.md file SkillSet could not read.`
        });
      }
    }
  }

  healthFindings.push(...detectDuplicateNames(skills));
  healthFindings.push(...detectTriggerOverlaps(skills));

  return {
    skills: skills.map((skill) => ({
      ...skill,
      healthFindings: [
        ...skill.healthFindings,
        ...healthFindings.filter(
          (finding) =>
            (finding.type === "duplicate-name" || finding.type === "trigger-overlap") &&
            finding.skillIds.includes(skill.id) &&
            !skill.healthFindings.some((existing) => existing.id === finding.id)
        )
      ]
    })),
    healthFindings
  };
}

async function readSkill(root: SkillRoot, skillPath: string, skillMdPath: string): Promise<Skill> {
  const raw = await readFile(skillMdPath, "utf8");
  const parsed = parseSkillMarkdown(raw);
  const id = stableId(root.id, skillPath);
  const displayName = readString(parsed.frontmatter.name) ?? humanizeName(basename(skillPath));
  const description = readString(parsed.frontmatter.description);
  const body = parsed.body.trim();
  const allowedTools = readStringArray(parsed.frontmatter["allowed-tools"]);
  const referencedFiles = await extractReferencedFiles(skillPath, body);
  const riskLabels = detectRiskLabels(id, displayName, description, body, allowedTools);
  const healthFindings: HealthFinding[] = [];

  if (parsed.frontmatterError) {
    healthFindings.push({
      id: stableId("invalid-frontmatter", skillMdPath),
      type: "invalid-frontmatter",
      severity: "warning",
      skillIds: [id],
      evidence: [skillMdPath, parsed.frontmatterError],
      message: `${displayName} has frontmatter SkillSet could not fully parse.`
    });
  }

  for (const reference of referencedFiles) {
    if (!reference.exists) {
      healthFindings.push({
        id: stableId("missing-reference", skillPath, reference.path),
        type: reference.kind === "script" ? "missing-script" : "missing-reference",
        severity: "warning",
        skillIds: [id],
        evidence: [reference.path],
        message:
          reference.kind === "script"
            ? `${displayName} references a script that was not found.`
            : `${displayName} references a local file that was not found.`
      });
    } else if (reference.kind === "script" && (await isExpectedExecutableMissing(skillPath, body, reference.path))) {
      healthFindings.push({
        id: stableId("missing-script-executable", skillPath, reference.path),
        type: "missing-script",
        severity: "warning",
        skillIds: [id],
        evidence: [reference.path, "Referenced as a directly executable script but executable permission is not set."],
        message: `${displayName} references a script that may not be executable.`
      });
    }
  }

  if (isBroadDescription(description)) {
    healthFindings.push({
      id: stableId("broad-description", skillPath, description ?? ""),
      type: "broad-description",
      severity: "warning",
      skillIds: [id],
      evidence: [description ?? "Missing description"],
      message: `${displayName} has a broad description and may trigger too often.`
    });
  }

  if (riskLabels.length > 0) {
    healthFindings.push({
      id: stableId("scripted-risk", skillPath, ...riskLabels.map((label) => label.id)),
      type: "scripted-risk",
      severity: "warning",
      skillIds: [id],
      evidence: riskLabels.flatMap((label) => label.evidence).slice(0, 10),
      message: `${displayName} contains scripted or high-impact behavior signals. Review before keeping it broadly visible.`
    });
  }

  return {
    id,
    name: normalizeName(displayName),
    displayName,
    category: inferSkillCategory(displayName, description, body, skillPath),
    source: root.source,
    originalPath: skillPath,
    skillMdPath,
    description,
    markdownBody: body,
    allowedTools,
    triggerPhrases: extractTriggerPhrases(description, body),
    frontmatter: parsed.frontmatter,
    referencedFiles,
    riskLabels,
    healthFindings,
    profiles: [],
    visibility: "visible",
    updatedAt: (await stat(skillMdPath)).mtime.toISOString()
  };
}

const categoryKeywords: Array<{ category: SkillCategory; keywords: string[] }> = [
  {
    category: "Design & UX",
    keywords: [
      "design",
      "ux",
      "ui",
      "visual",
      "layout",
      "spacing",
      "typography",
      "color",
      "accessibility",
      "a11y",
      "prototype",
      "mockup",
      "figma",
      "interaction",
      "responsive",
      "polish"
    ]
  },
  {
    category: "Frontend",
    keywords: [
      "frontend",
      "front-end",
      "react",
      "vue",
      "svelte",
      "css",
      "html",
      "component",
      "dom",
      "client",
      "vite",
      "next",
      "tailwind",
      "animation",
      "canvas",
      "three.js",
      "web app"
    ]
  },
  {
    category: "Backend",
    keywords: [
      "backend",
      "back-end",
      "api",
      "server",
      "database",
      "db",
      "sql",
      "postgres",
      "redis",
      "queue",
      "auth",
      "endpoint",
      "schema",
      "migration",
      "node",
      "express",
      "fastify"
    ]
  },
  {
    category: "Testing & QA",
    keywords: [
      "qa",
      "test",
      "testing",
      "playwright",
      "vitest",
      "jest",
      "unit",
      "integration",
      "e2e",
      "browser test",
      "regression",
      "bug",
      "verify",
      "screenshot",
      "coverage"
    ]
  },
  {
    category: "Code Review",
    keywords: [
      "review",
      "code review",
      "pr review",
      "diff",
      "pull request",
      "regression",
      "risk",
      "lint",
      "quality",
      "refactor",
      "architecture review"
    ]
  },
  {
    category: "Security",
    keywords: [
      "security",
      "audit",
      "secrets",
      "owasp",
      "permission",
      "vulnerability",
      "dependency",
      "supply chain",
      "prompt injection",
      "cve",
      "token",
      "credential"
    ]
  },
  {
    category: "DevOps & Deploy",
    keywords: [
      "deploy",
      "deployment",
      "ci",
      "cd",
      "github actions",
      "docker",
      "kubernetes",
      "kubectl",
      "fly",
      "vercel",
      "netlify",
      "release",
      "ship",
      "rollback",
      "canary",
      "monitoring"
    ]
  },
  {
    category: "Data & Analytics",
    keywords: [
      "data",
      "analytics",
      "spreadsheet",
      "csv",
      "sql",
      "warehouse",
      "dashboard",
      "chart",
      "metric",
      "notebook",
      "etl",
      "report",
      "analysis"
    ]
  },
  {
    category: "Docs & Writing",
    keywords: [
      "docs",
      "documentation",
      "readme",
      "changelog",
      "release notes",
      "copy",
      "writing",
      "blog",
      "one-pager",
      "prd",
      "spec",
      "proposal",
      "markdown"
    ]
  },
  {
    category: "Product & Strategy",
    keywords: [
      "product",
      "strategy",
      "startup",
      "founder",
      "customer",
      "gtm",
      "positioning",
      "pricing",
      "roadmap",
      "market",
      "research",
      "office hours"
    ]
  },
  {
    category: "Project Memory",
    keywords: [
      "memory",
      "context",
      "resume",
      "restore",
      "checkpoint",
      "learn",
      "learnings",
      "state",
      "history",
      "session"
    ]
  },
  {
    category: "Automation & Agents",
    keywords: [
      "agent",
      "automation",
      "workflow",
      "orchestrator",
      "autoplan",
      "planner",
      "skill",
      "tool",
      "mcp",
      "pipeline",
      "multi-agent"
    ]
  },
  {
    category: "GitHub & Collaboration",
    keywords: [
      "github",
      "issue",
      "pull request",
      "review comment",
      "ci",
      "merge",
      "branch",
      "commit",
      "label",
      "assignee",
      "collaboration"
    ]
  },
  {
    category: "Browser & Research",
    keywords: [
      "browser",
      "browse",
      "scrape",
      "research",
      "web",
      "search",
      "crawl",
      "website",
      "screenshot",
      "page",
      "dom"
    ]
  },
  {
    category: "Environment & Tooling",
    keywords: [
      "setup",
      "install",
      "upgrade",
      "config",
      "environment",
      "cli",
      "tooling",
      "developer experience",
      "dx",
      "local",
      "shell",
      "path"
    ]
  }
];

function inferSkillCategory(
  displayName: string,
  description: string | null,
  body: string,
  skillPath: string
): SkillCategory {
  const text = `${displayName} ${description ?? ""} ${body.slice(0, 1600)} ${skillPath}`.toLowerCase();
  const scored = categoryKeywords
    .map(({ category, keywords }) => ({
      category,
      score: keywords.reduce((total, keyword) => total + keywordScore(text, keyword), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((first, second) => second.score - first.score);

  return scored[0]?.category ?? "Other";
}

function keywordScore(text: string, keyword: string): number {
  const escaped = escapeRegExp(keyword.toLowerCase());
  const matches = text.match(new RegExp(`\\b${escaped}\\b`, "g"));
  if (!matches) {
    return 0;
  }
  return matches.length * (keyword.includes(" ") ? 3 : 1);
}

function parseSkillMarkdown(raw: string): ParseOutcome {
  try {
    const parsed = matter(raw);
    return {
      frontmatter: isRecord(parsed.data) ? parsed.data : {},
      body: parsed.content,
      frontmatterError: null
    };
  } catch (error) {
    return {
      frontmatter: {},
      body: stripBrokenFrontmatter(raw),
      frontmatterError: errorMessage(error)
    };
  }
}

async function extractReferencedFiles(skillPath: string, body: string): Promise<ReferencedFile[]> {
  const candidates = new Map<string, ReferencedFile["kind"]>();
  const addCandidate = (rawPath: string, kind: ReferencedFile["kind"]) => {
    const clean = rawPath.trim().replace(/^["'`]+|["'`]+$/g, "");
    if (!clean || clean.startsWith("#") || /^[a-z]+:/i.test(clean)) {
      return;
    }
    if (clean.includes("*") || clean.includes("{") || clean.includes("}")) {
      return;
    }
    candidates.set(clean, kind);
  };

  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    addCandidate(match[1].split("#")[0], "markdown-link");
  }

  for (const match of body.matchAll(/(?:^|\s)(\.{1,2}\/[^\s)]+|[\w.-]+\/[\w./-]+\.(?:md|txt|json|yaml|yml|sh|js|ts|py|rb|go|rs))/g)) {
    addCandidate(match[1], isScriptPath(match[1]) ? "script" : "path");
  }

  for (const match of body.matchAll(/(?:^|\s)(?:bash|sh|python|node|tsx|ts-node)\s+([.\/\w-]+\.(?:sh|js|ts|py|rb|go|rs))/g)) {
    addCandidate(match[1], "script");
  }

  return Promise.all(
    [...candidates.entries()].map(async ([rawPath, kind]) => {
      const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(skillPath, rawPath);
      return {
        path: normalize(relative(skillPath, absolutePath) || basename(absolutePath)),
        exists: await fileExists(absolutePath),
        kind
      };
    })
  );
}

async function isExpectedExecutableMissing(skillPath: string, body: string, relativePath: string): Promise<boolean> {
  const directExecutionPattern = new RegExp(`(?:^|\\s)\\./${escapeRegExp(relativePath)}(?:\\s|$)`);
  if (!directExecutionPattern.test(body)) {
    return false;
  }

  try {
    const fileStat = await stat(resolve(skillPath, relativePath));
    return (fileStat.mode & 0o111) === 0;
  } catch {
    return false;
  }
}

function detectDuplicateNames(skills: Skill[]): HealthFinding[] {
  const byName = new Map<string, Skill[]>();
  for (const skill of skills) {
    const existing = byName.get(skill.name) ?? [];
    existing.push(skill);
    byName.set(skill.name, existing);
  }

  return [...byName.entries()]
    .filter(([, grouped]) => grouped.length > 1)
    .map(([name, grouped]) => ({
      id: stableId("duplicate-name", name, ...grouped.map((skill) => skill.originalPath)),
      type: "duplicate-name" as const,
      severity: "warning" as const,
      skillIds: grouped.map((skill) => skill.id),
      evidence: grouped.map((skill) => skill.originalPath),
      message: `${grouped.length} skills share the name "${grouped[0].displayName}".`
    }));
}

function detectTriggerOverlaps(skills: Skill[]): HealthFinding[] {
  const termsBySkill = new Map<string, Set<string>>();
  for (const skill of skills) {
    termsBySkill.set(skill.id, extractOverlapTerms(skill));
  }

  const findings: HealthFinding[] = [];
  const usedPairs = new Set<string>();

  for (let firstIndex = 0; firstIndex < skills.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < skills.length; secondIndex += 1) {
      const first = skills[firstIndex];
      const second = skills[secondIndex];
      const firstTerms = termsBySkill.get(first.id) ?? new Set<string>();
      const secondTerms = termsBySkill.get(second.id) ?? new Set<string>();
      const sharedTerms = [...firstTerms].filter((term) => secondTerms.has(term));

      if (sharedTerms.length < 2) {
        continue;
      }

      const key = [first.id, second.id].sort().join(":");
      if (usedPairs.has(key)) {
        continue;
      }
      usedPairs.add(key);

      findings.push({
        id: stableId("trigger-overlap", first.id, second.id, ...sharedTerms.slice(0, 5)),
        type: "trigger-overlap",
        severity: "info",
        skillIds: [first.id, second.id],
        evidence: sharedTerms.slice(0, 8),
        message: `${first.displayName} and ${second.displayName} have likely trigger overlap. Claude may choose between similar skills unpredictably.`
      });
    }
  }

  return findings.slice(0, 50);
}

function detectRiskLabels(
  skillId: string,
  displayName: string,
  description: string | null,
  body: string,
  allowedTools: string[]
): RiskLabel[] {
  const text = `${description ?? ""}\n${body}\n${allowedTools.join(" ")}`;
  const checks: Array<{ id: string; label: string; pattern: RegExp; severity: RiskLabel["severity"] }> = [
    { id: "shell-command", label: "Shell command", pattern: /\b(?:bash|sh|zsh|chmod|sudo)\b|\$\(.*\)|```(?:bash|sh|zsh)/i, severity: "warning" },
    { id: "deploy-command", label: "Deploy command", pattern: /\b(?:deploy|release|flyctl|vercel|netlify|kubectl|helm)\b/i, severity: "warning" },
    { id: "git-mutation", label: "Git mutation", pattern: /\bgit\s+(?:push|commit|reset|checkout|clean|rebase|merge|rm|add)\b/i, severity: "warning" },
    { id: "filesystem-mutation", label: "Filesystem mutation", pattern: /\b(?:rm\s+-|mv\s+|cp\s+|writeFile|unlink|chmod|chown|mkdir)\b/i, severity: "warning" },
    { id: "network-tool", label: "Network tool", pattern: /\b(?:curl|wget|fetch|http|https|ssh|scp|rsync)\b/i, severity: "info" },
    { id: "package-install", label: "Package install", pattern: /\b(?:npm|pnpm|yarn|bun|pip|brew|cargo)\s+(?:install|add|update|upgrade)\b/i, severity: "warning" }
  ];

  return checks
    .map((check) => {
      const match = text.match(check.pattern);
      if (!match) {
        return null;
      }
      return {
        id: `${skillId}-${check.id}`,
        label: check.label,
        severity: check.severity,
        evidence: [`${displayName}: ${match[0].slice(0, 120)}`]
      } satisfies RiskLabel;
    })
    .filter((label): label is RiskLabel => label !== null);
}

function isBroadDescription(description: string | null): boolean {
  if (!description) {
    return true;
  }

  const normalized = description.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length < 24) {
    return true;
  }
  if (normalized.length > 220 && !/^(use|helps?|assist(?:s)?)( this)? (for|with)?\s*(coding|development|general|all|any)/.test(normalized)) {
    return false;
  }

  const broadPatterns = [
    /^(use|helps?|assist(?:s)?)( this)? (for|with)?\s*(coding|development|tasks?|anything|general|all)\b/,
    /\bgeneral (assistant|skill|coding|development)\b/,
    /\b(use this )?(for|when).*\b(any|all|general|various|multiple)\b.*\b(tasks?|work|coding|development)\b/,
    /\bimprove(s)?\b.*\b(code|development|workflow)\b/
  ];

  return broadPatterns.some((pattern) => pattern.test(normalized));
}

function extractOverlapTerms(skill: Skill): Set<string> {
  const text = `${skill.displayName} ${skill.description ?? ""} ${skill.triggerPhrases.join(" ")}`.toLowerCase();
  const stopWords = new Set([
    "this",
    "that",
    "when",
    "with",
    "from",
    "your",
    "skill",
    "skills",
    "use",
    "uses",
    "using",
    "asked",
    "user",
    "task",
    "tasks",
    "work",
    "code",
    "local"
  ]);
  const terms = text.match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  return new Set(terms.filter((term) => !stopWords.has(term)).slice(0, 80));
}

function extractTriggerPhrases(description: string | null, body: string): string[] {
  const phrases = new Set<string>();
  if (description) {
    phrases.add(description.trim());
  }

  for (const heading of body.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    phrases.add(heading[1].trim());
  }

  for (const sentence of body.split(/[.!?]\s+/).slice(0, 4)) {
    const trimmed = sentence.replace(/\s+/g, " ").trim();
    if (trimmed.length >= 24 && trimmed.length <= 180) {
      phrases.add(trimmed);
    }
  }

  return [...phrases].slice(0, 8);
}

function stripBrokenFrontmatter(raw: string) {
  if (!raw.startsWith("---")) {
    return raw;
  }
  const closing = raw.indexOf("\n---", 3);
  if (closing === -1) {
    return raw;
  }
  return raw.slice(closing + 4);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

function humanizeName(name: string) {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function isScriptPath(path: string) {
  return /\.(?:sh|js|ts|py|rb|go|rs)$/.test(path);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const fileStat = await stat(path);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function safeRealpath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function stableId(...parts: string[]) {
  let hash = 5381;
  const input = parts.join("|");
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return `sk_${(hash >>> 0).toString(16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
