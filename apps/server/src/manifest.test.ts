import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Skill, SkillRoot } from "@skillset/shared";
import {
  applyProfile,
  createManifestStore,
  mergeManifestIntoSkills,
  patchProfile,
  planProfile,
  undoLastApply
} from "./manifest.js";

describe("manifest store", () => {
  it("creates a manifest, syncs skill state, plans apply, writes active links, and undoes", async () => {
    const skillsetHome = await mkdtemp(join(tmpdir(), "skillset-home-"));
    const sourceRoot = await mkdtemp(join(tmpdir(), "skillset-source-"));
    await mkdir(join(sourceRoot, "alpha"), { recursive: true });
    await mkdir(join(sourceRoot, "beta"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha", "SKILL.md"), "---\nname: Alpha\n---\n");
    await writeFile(join(sourceRoot, "beta", "SKILL.md"), "---\nname: Beta\n---\n");

    const root: SkillRoot = {
      id: "project",
      label: "Project",
      source: "project",
      path: sourceRoot,
      exists: true,
      writable: true
    };
    const skills = [makeSkill("alpha", "Alpha", join(sourceRoot, "alpha")), makeSkill("beta", "Beta", join(sourceRoot, "beta"))];

    const store = createManifestStore(skillsetHome);
    let manifest = await store.syncSkills([root], skills);
    expect(Object.keys(manifest.skills)).toHaveLength(2);
    expect(Object.values(manifest.profiles).map((profile) => profile.id)).toContain("minimal");

    manifest = patchProfile(manifest, "minimal", { skillIds: ["alpha"] });
    await store.write(manifest);

    const merged = mergeManifestIntoSkills(manifest, skills);
    const plan = await planProfile(manifest, "minimal", merged, store.status.activeDir);
    expect(plan.makeQuiet.map((skill) => skill.id)).toEqual(["beta"]);
    expect(plan.affectedPaths.every((path) => path.startsWith(store.status.activeDir))).toBe(true);

    const applied = await applyProfile(store, "minimal", merged);
    expect(applied.manifest.activeProfileId).toBe("minimal");
    expect(applied.manifest.skills.alpha.visibility).toBe("visible");
    expect(applied.manifest.skills.beta.visibility).toBe("quiet");
    await expect(stat(join(store.status.activeDir, "alpha-alpha"))).resolves.toBeTruthy();

    const undone = await undoLastApply(store, merged);
    expect(undone.lastApply).toBeNull();
    expect(undone.skills.beta.visibility).toBe("visible");
  });

  it("backs up a corrupt manifest and replaces it with a fresh one", async () => {
    const skillsetHome = await mkdtemp(join(tmpdir(), "skillset-corrupt-"));
    await mkdir(skillsetHome, { recursive: true });
    await writeFile(join(skillsetHome, "manifest.json"), "{not valid json");

    const store = createManifestStore(skillsetHome);
    const manifest = await store.read();

    expect(manifest.version).toBe(1);
    expect(store.status.corruptBackupPath).toContain("manifest.json.corrupt-");
    await expect(readFile(store.status.corruptBackupPath as string, "utf8")).resolves.toBe("{not valid json");
  });
});

function makeSkill(id: string, displayName: string, originalPath: string): Skill {
  return {
    id,
    name: displayName.toLowerCase(),
    displayName,
    category: "Other",
    source: "project",
    originalPath,
    skillMdPath: join(originalPath, "SKILL.md"),
    description: null,
    markdownBody: "",
    allowedTools: [],
    triggerPhrases: [],
    frontmatter: {},
    referencedFiles: [],
    riskLabels: [],
    healthFindings: [],
    profiles: [],
    visibility: "visible",
    updatedAt: new Date(0).toISOString()
  };
}
