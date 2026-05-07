export type SkillSource = "global" | "project" | "managed" | "plugin";

export type SkillVisibility = "visible" | "quiet";

export type SkillCategory =
  | "Design & UX"
  | "Frontend"
  | "Backend"
  | "Testing & QA"
  | "Code Review"
  | "Security"
  | "DevOps & Deploy"
  | "Data & Analytics"
  | "Docs & Writing"
  | "Product & Strategy"
  | "Project Memory"
  | "Automation & Agents"
  | "GitHub & Collaboration"
  | "Browser & Research"
  | "Environment & Tooling"
  | "Other";

export type SkillRoot = {
  id: string;
  label: string;
  source: SkillSource;
  path: string;
  exists: boolean;
  writable: boolean;
};

export type ReferencedFile = {
  path: string;
  exists: boolean;
  kind: "markdown-link" | "script" | "path";
};

export type RiskLabel = {
  id: string;
  label: string;
  severity: "info" | "warning" | "error";
  evidence: string[];
};

export type HealthFinding = {
  id: string;
  type:
    | "missing-skill-md"
    | "invalid-frontmatter"
    | "missing-reference"
    | "missing-script"
    | "duplicate-name"
    | "trigger-overlap"
    | "broad-description"
    | "scripted-risk"
    | "no-profile";
  severity: "error" | "warning" | "info";
  skillIds: string[];
  evidence: string[];
  message: string;
};

export type Skill = {
  id: string;
  name: string;
  displayName: string;
  category: SkillCategory;
  source: SkillSource;
  originalPath: string;
  skillMdPath: string | null;
  description: string | null;
  markdownBody: string | null;
  allowedTools: string[];
  triggerPhrases: string[];
  frontmatter: Record<string, unknown>;
  referencedFiles: ReferencedFile[];
  riskLabels: RiskLabel[];
  healthFindings: HealthFinding[];
  profiles: string[];
  visibility: SkillVisibility;
  updatedAt: string;
};

export type Profile = {
  id: string;
  name: string;
  description: string;
  skillIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type SkillRecord = {
  id: string;
  name: string;
  originalPath: string;
  visibility: SkillVisibility;
  profileIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
};

export type ApplySnapshot = {
  profileId: string | null;
  visibleSkillIds: string[];
  quietSkillIds: string[];
  activePaths: string[];
  createdAt: string;
};

export type Manifest = {
  version: 1;
  roots: SkillRoot[];
  skills: Record<string, SkillRecord>;
  profiles: Record<string, Profile>;
  activeProfileId: string | null;
  lastApply: ApplySnapshot | null;
};

export type VisibilityPlan = {
  profileId: string;
  makeVisible: Skill[];
  makeQuiet: Skill[];
  unchangedVisible: Skill[];
  unchangedQuiet: Skill[];
  affectedPaths: string[];
  warnings: string[];
};

export type ManifestStatus = {
  path: string;
  activeDir: string;
  corruptBackupPath: string | null;
};

export type AppState = {
  status: "ok";
  host: "127.0.0.1";
  port: number;
  cwd: string;
  roots: SkillRoot[];
  manifest: ManifestStatus;
  skillCount: number;
  healthFindingCount: number;
  watcherErrors: string[];
  startedAt: string;
};
