import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { SkillRoot } from "@skillset/shared";
import { scanSkillRoots } from "./scanner.js";

describe("scanSkillRoots", () => {
  it("parses valid skills and reports invalid candidates and missing references", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "skillset-scanner-"));
    await mkdir(join(rootPath, "review-helper", "scripts"), { recursive: true });
    await mkdir(join(rootPath, "broken-folder"), { recursive: true });
    await mkdir(join(rootPath, "missing-ref"), { recursive: true });
    await mkdir(join(rootPath, "broad-skill"), { recursive: true });
    await mkdir(join(rootPath, "deploy-skill", "scripts"), { recursive: true });
    await mkdir(join(rootPath, "review-a"), { recursive: true });
    await mkdir(join(rootPath, "review-b"), { recursive: true });

    await writeFile(
      join(rootPath, "review-helper", "SKILL.md"),
      `---
name: Review Helper
description: Use this when reviewing pull requests for behavior changes.
allowed-tools: Read, Grep
---
# Review workflow

Open [checklist](checklist.md) before reviewing.

Run scripts/review.sh when local checks are needed.
`
    );
    await writeFile(join(rootPath, "review-helper", "checklist.md"), "- Check behavior\n");
    await writeFile(join(rootPath, "review-helper", "scripts", "review.sh"), "echo review\n");

    await writeFile(
      join(rootPath, "missing-ref", "SKILL.md"),
      `---
name: Missing Reference
description: Use this when detecting missing files.
---
Read [missing](docs/missing.md) first.
`
    );
    await writeFile(
      join(rootPath, "broad-skill", "SKILL.md"),
      `---
name: Broad Skill
description: Use for coding tasks.
---
# Broad
`
    );
    await writeFile(
      join(rootPath, "deploy-skill", "SKILL.md"),
      `---
name: Deploy Skill
description: Use this when deploying a release with git mutation and package install commands.
---
# Deploy

Run ./scripts/deploy.sh before release.

\`\`\`bash
git push origin main
npm install
curl https://example.com
\`\`\`
`
    );
    await writeFile(join(rootPath, "deploy-skill", "scripts", "deploy.sh"), "echo deploy\n");
    await writeFile(
      join(rootPath, "review-a", "SKILL.md"),
      `---
name: Review A
description: Use this when reviewing pull requests for behavior changes and test gaps.
---
# Review pull request
`
    );
    await writeFile(
      join(rootPath, "review-b", "SKILL.md"),
      `---
name: Review B
description: Use this when reviewing pull requests for behavior changes and regression risk.
---
# Review pull request
`
    );

    const root: SkillRoot = {
      id: "project",
      label: "Project",
      source: "project",
      path: rootPath,
      exists: true,
      writable: true
    };

    const result = await scanSkillRoots([root]);

    expect(result.skills.map((skill) => skill.displayName).sort()).toEqual([
      "Broad Skill",
      "Deploy Skill",
      "Missing Reference",
      "Review A",
      "Review B",
      "Review Helper"
    ]);
    expect(result.skills.find((skill) => skill.displayName === "Review Helper")?.allowedTools).toEqual([
      "Read",
      "Grep"
    ]);
    expect(result.healthFindings.map((finding) => finding.type)).toContain("missing-reference");
    expect(result.healthFindings.map((finding) => finding.type)).toContain("missing-skill-md");
    expect(result.healthFindings.map((finding) => finding.type)).toContain("scripted-risk");
    expect(result.healthFindings.map((finding) => finding.type)).toContain("broad-description");
    expect(result.healthFindings.map((finding) => finding.type)).toContain("trigger-overlap");
    expect(result.skills.find((skill) => skill.displayName === "Deploy Skill")?.riskLabels.map((label) => label.label)).toEqual(
      expect.arrayContaining(["Shell command", "Deploy command", "Git mutation", "Network tool", "Package install"])
    );
    expect(JSON.stringify(result)).not.toContain('"path":"when"');
  });
});
