import { cp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import type {
  ApplySnapshot,
  HealthFinding,
  Manifest,
  ManifestStatus,
  Profile,
  Skill,
  SkillRecord,
  SkillRoot,
  SkillVisibility,
  VisibilityPlan
} from "@skillset/shared";

export type ManifestStore = {
  status: ManifestStatus;
  read: () => Promise<Manifest>;
  write: (manifest: Manifest) => Promise<void>;
  syncSkills: (roots: SkillRoot[], skills: Skill[]) => Promise<Manifest>;
};

export type ApplyResult = {
  manifest: Manifest;
  plan: VisibilityPlan;
  snapshot: ApplySnapshot;
};

export function createManifestStore(skillsetHome = join(homedir(), ".skillset")): ManifestStore {
  const root = resolve(skillsetHome);
  const manifestPath = join(root, "manifest.json");
  const activeDir = join(root, "active");
  const status: ManifestStatus = {
    path: manifestPath,
    activeDir,
    corruptBackupPath: null
  };

  return {
    status,
    read: async () => readManifest(status, root),
    write: async (manifest) => writeManifest(status, root, manifest),
    syncSkills: async (roots, skills) => {
      const manifest = await readManifest(status, root);
      const synced = syncManifestSkills(manifest, roots, skills);
      await writeManifest(status, root, synced);
      return synced;
    }
  };
}

export async function planProfile(manifest: Manifest, profileId: string, skills: Skill[], activeDir: string): Promise<VisibilityPlan> {
  const profile = manifest.profiles[profileId];
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}`);
  }

  const targetSkillIds = new Set(profile.skillIds);
  const makeVisible: Skill[] = [];
  const makeQuiet: Skill[] = [];
  const unchangedVisible: Skill[] = [];
  const unchangedQuiet: Skill[] = [];
  const affectedPaths: string[] = [];
  const warnings: string[] = [
    "This plan updates SkillSet's managed active directory only. Original skill folders are preserved.",
    "Claude Code may need restart or explicit configuration before managed active skills affect a running session."
  ];

  for (const skill of skills) {
    const currentVisibility = manifest.skills[skill.id]?.visibility ?? skill.visibility;
    const targetVisibility: SkillVisibility = targetSkillIds.has(skill.id) ? "visible" : "quiet";

    if (currentVisibility === "visible" && targetVisibility === "visible") {
      unchangedVisible.push(skill);
    } else if (currentVisibility === "quiet" && targetVisibility === "quiet") {
      unchangedQuiet.push(skill);
    } else if (targetVisibility === "visible") {
      makeVisible.push(skill);
      affectedPaths.push(join(activeDir, symlinkNameForSkill(skill)));
    } else {
      makeQuiet.push(skill);
      affectedPaths.push(join(activeDir, symlinkNameForSkill(skill)));
    }
  }

  return {
    profileId,
    makeVisible,
    makeQuiet,
    unchangedVisible,
    unchangedQuiet,
    affectedPaths: [...new Set(affectedPaths)].sort(),
    warnings
  };
}

export async function applyProfile(
  store: ManifestStore,
  profileId: string,
  skills: Skill[]
): Promise<ApplyResult> {
  const manifest = await store.read();
  const plan = await planProfile(manifest, profileId, skills, store.status.activeDir);
  const snapshot = snapshotManifest(manifest);
  const nextManifest: Manifest = {
    ...manifest,
    activeProfileId: profileId,
    lastApply: snapshot,
    skills: { ...manifest.skills }
  };

  const targetSkillIds = new Set(manifest.profiles[profileId]?.skillIds ?? []);
  for (const skill of skills) {
    const record = nextManifest.skills[skill.id] ?? createSkillRecord(skill);
    nextManifest.skills[skill.id] = {
      ...record,
      visibility: targetSkillIds.has(skill.id) ? "visible" : "quiet",
      profileIds: record.profileIds
    };
  }

  await writeActiveDirectory(store.status.activeDir, skills.filter((skill) => targetSkillIds.has(skill.id)));
  await store.write(nextManifest);

  return {
    manifest: nextManifest,
    plan,
    snapshot
  };
}

export async function undoLastApply(store: ManifestStore, skills: Skill[]): Promise<Manifest> {
  const manifest = await store.read();
  if (!manifest.lastApply) {
    throw new Error("No apply operation is available to undo.");
  }

  const visibleSkillIds = new Set(manifest.lastApply.visibleSkillIds);
  const nextManifest: Manifest = {
    ...manifest,
    activeProfileId: manifest.lastApply.profileId,
    lastApply: null,
    skills: { ...manifest.skills }
  };

  for (const skill of skills) {
    const record = nextManifest.skills[skill.id] ?? createSkillRecord(skill);
    nextManifest.skills[skill.id] = {
      ...record,
      visibility: visibleSkillIds.has(skill.id) ? "visible" : "quiet"
    };
  }

  await writeActiveDirectory(
    store.status.activeDir,
    skills.filter((skill) => visibleSkillIds.has(skill.id))
  );
  await store.write(nextManifest);
  return nextManifest;
}

export function mergeManifestIntoSkills(manifest: Manifest, skills: Skill[]): Skill[] {
  return skills.map((skill) => {
    const record = manifest.skills[skill.id];
    const profiles = record?.profileIds.length ? record.profileIds : profilesForSkill(manifest, skill.id);
    const profileFinding = profiles.length === 0 ? noProfileFinding(skill) : null;
    return {
      ...skill,
      visibility: record?.visibility ?? skill.visibility,
      profiles,
      healthFindings: profileFinding ? appendUniqueFinding(skill.healthFindings, profileFinding) : skill.healthFindings
    };
  });
}

export function buildManifestHealthFindings(manifest: Manifest, skills: Skill[]): HealthFinding[] {
  return skills
    .filter((skill) => {
      const record = manifest.skills[skill.id];
      const profiles = record?.profileIds.length ? record.profileIds : profilesForSkill(manifest, skill.id);
      return profiles.length === 0;
    })
    .map(noProfileFinding);
}

export function upsertProfile(manifest: Manifest, profile: Profile): Manifest {
  return {
    ...manifest,
    profiles: {
      ...manifest.profiles,
      [profile.id]: profile
    }
  };
}

export function patchProfile(manifest: Manifest, profileId: string, patch: Partial<Pick<Profile, "name" | "description" | "skillIds">>): Manifest {
  const existing = manifest.profiles[profileId];
  if (!existing) {
    throw new Error(`Unknown profile: ${profileId}`);
  }
  const cleanPatch: Partial<Pick<Profile, "name" | "description" | "skillIds">> = {};
  if (patch.name !== undefined) {
    cleanPatch.name = patch.name;
  }
  if (patch.description !== undefined) {
    cleanPatch.description = patch.description;
  }
  if (patch.skillIds !== undefined) {
    cleanPatch.skillIds = patch.skillIds;
  }
  return {
    ...manifest,
    profiles: {
      ...manifest.profiles,
      [profileId]: {
        ...existing,
        ...cleanPatch,
        updatedAt: new Date().toISOString()
      }
    }
  };
}

export function createProfile(input: { name: string; description?: string; skillIds?: string[] }): Profile {
  const now = new Date().toISOString();
  return {
    id: slugify(input.name),
    name: input.name,
    description: input.description ?? "",
    skillIds: input.skillIds ?? [],
    createdAt: now,
    updatedAt: now
  };
}

async function readManifest(status: ManifestStatus, root: string): Promise<Manifest> {
  await mkdir(root, { recursive: true });
  await mkdir(status.activeDir, { recursive: true });

  try {
    const raw = await readFile(status.path, "utf8");
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed.version !== 1 || !parsed.skills || !parsed.profiles) {
      throw new Error("Unsupported manifest format.");
    }
    return parsed;
  } catch (error) {
    if (isMissingFileError(error)) {
      const manifest = createFreshManifest();
      await writeManifest(status, root, manifest);
      return manifest;
    }

    const backupPath = `${status.path}.corrupt-${Date.now()}`;
    try {
      await rename(status.path, backupPath);
      status.corruptBackupPath = backupPath;
    } catch {
      status.corruptBackupPath = null;
    }
    const manifest = createFreshManifest();
    await writeManifest(status, root, manifest);
    return manifest;
  }
}

async function writeManifest(status: ManifestStatus, root: string, manifest: Manifest): Promise<void> {
  await mkdir(root, { recursive: true });
  await mkdir(status.activeDir, { recursive: true });
  const tempPath = `${status.path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(tempPath, status.path);
}

function syncManifestSkills(manifest: Manifest, roots: SkillRoot[], skills: Skill[]): Manifest {
  const now = new Date().toISOString();
  const nextSkills: Record<string, SkillRecord> = { ...manifest.skills };
  const profiles = { ...manifest.profiles };

  for (const skill of skills) {
    const existing = nextSkills[skill.id];
    nextSkills[skill.id] = existing
      ? {
          ...existing,
          name: skill.displayName,
          originalPath: skill.originalPath,
          lastSeenAt: now
        }
      : {
          ...createSkillRecord(skill),
          visibility: defaultVisibilityForSkill(skill),
          firstSeenAt: now,
          lastSeenAt: now
        };
  }

  for (const profile of Object.values(profiles)) {
    profiles[profile.id] = {
      ...profile,
      skillIds: profile.skillIds.filter((skillId) => nextSkills[skillId])
    };
  }

  return {
    ...manifest,
    roots,
    skills: nextSkills,
    profiles
  };
}

function profilesForSkill(manifest: Manifest, skillId: string): string[] {
  return Object.values(manifest.profiles)
    .filter((profile) => profile.skillIds.includes(skillId))
    .map((profile) => profile.id);
}

function noProfileFinding(skill: Skill): HealthFinding {
  return {
    id: `no-profile-${skill.id}`,
    type: "no-profile",
    severity: "info",
    skillIds: [skill.id],
    evidence: [skill.displayName, skill.originalPath],
    message: `${skill.displayName} is installed but is not assigned to any profile.`
  };
}

function appendUniqueFinding(findings: HealthFinding[], finding: HealthFinding): HealthFinding[] {
  if (findings.some((existing) => existing.id === finding.id)) {
    return findings;
  }
  return [...findings, finding];
}

function createFreshManifest(): Manifest {
  return {
    version: 1,
    roots: [],
    skills: {},
    profiles: Object.fromEntries(defaultProfiles().map((profile) => [profile.id, profile])),
    activeProfileId: null,
    lastApply: null
  };
}

function defaultProfiles(): Profile[] {
  const now = new Date().toISOString();
  return [
    ["minimal", "Minimal", "Only the skills needed for a small focused task."],
    ["frontend", "Frontend", "Skills for interface implementation and browser verification."],
    ["shipping", "Shipping", "Skills for final checks, documentation, release, and PR work."],
    ["security", "Security", "Skills for risk review, dependency checks, and unsafe operations."],
    ["founder", "Founder", "Skills for strategy, product thinking, and writing."],
    ["full-power", "Full Power", "Every skill you intentionally choose to make available."]
  ].map(([id, name, description]) => ({
    id,
    name,
    description,
    skillIds: [],
    createdAt: now,
    updatedAt: now
  }));
}

function createSkillRecord(skill: Skill): SkillRecord {
  const now = new Date().toISOString();
  return {
    id: skill.id,
    name: skill.displayName,
    originalPath: skill.originalPath,
    visibility: defaultVisibilityForSkill(skill),
    profileIds: [],
    firstSeenAt: now,
    lastSeenAt: now
  };
}

function defaultVisibilityForSkill(skill: Skill): SkillVisibility {
  return skill.source === "global" || skill.source === "project" ? "visible" : "quiet";
}

async function writeActiveDirectory(activeDir: string, visibleSkills: Skill[]): Promise<void> {
  await mkdir(activeDir, { recursive: true });
  const existing = await safeReadDir(activeDir);
  await Promise.all(existing.map((entry) => rm(join(activeDir, entry), { recursive: true, force: true })));

  for (const skill of visibleSkills) {
    const destination = join(activeDir, symlinkNameForSkill(skill));
    try {
      await symlink(skill.originalPath, destination, "dir");
    } catch {
      await cp(skill.originalPath, destination, { recursive: true, force: true, errorOnExist: false });
    }
  }
}

async function safeReadDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

function snapshotManifest(manifest: Manifest): ApplySnapshot {
  const visibleSkillIds = Object.values(manifest.skills)
    .filter((record) => record.visibility === "visible")
    .map((record) => record.id);
  const quietSkillIds = Object.values(manifest.skills)
    .filter((record) => record.visibility === "quiet")
    .map((record) => record.id);

  return {
    profileId: manifest.activeProfileId,
    visibleSkillIds,
    quietSkillIds,
    activePaths: [],
    createdAt: new Date().toISOString()
  };
}

function symlinkNameForSkill(skill: Skill): string {
  return `${slugify(skill.displayName)}-${skill.id}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
