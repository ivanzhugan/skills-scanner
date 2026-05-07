import { describe, expect, it } from "vitest";
import type { AppState } from "./index.js";

describe("shared types", () => {
  it("allows a local app state shape", () => {
    const state: AppState = {
      status: "ok",
      host: "127.0.0.1",
      port: 4317,
      cwd: "/tmp/project",
      roots: [],
      manifest: {
        path: "/tmp/skillset/manifest.json",
        activeDir: "/tmp/skillset/active",
        corruptBackupPath: null
      },
      skillCount: 0,
      healthFindingCount: 0,
      watcherErrors: [],
      startedAt: new Date(0).toISOString()
    };

    expect(state.host).toBe("127.0.0.1");
  });
});
