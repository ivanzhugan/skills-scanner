#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { startSkillSetServer } from "@skillset/server";

type CliOptions = {
  noOpen: boolean;
  port?: number;
  cwd?: string;
  skillsetHome?: string;
  help: boolean;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const started = await startSkillSetServer({
    cwd: options.cwd,
    port: options.port,
    skillsetHome: options.skillsetHome ?? process.env.SKILLSET_HOME
  });

  console.log(`SkillSet running at ${started.url}`);
  console.log(`Watching ${started.state.roots.map((root) => root.path).join(" and ")}`);
  console.log("Press Ctrl+C to stop.");

  if (!options.noOpen) {
    openBrowser(started.url);
  }

  const shutdown = async () => {
    console.log("\nStopping SkillSet...");
    await started.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    noOpen: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--no-open") {
      options.noOpen = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--port") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--port requires a value.");
      }
      options.port = parsePort(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      options.port = parsePort(arg.slice("--port=".length));
      continue;
    }

    if (arg === "--cwd") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--cwd requires a value.");
      }
      options.cwd = resolve(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--cwd=")) {
      options.cwd = resolve(arg.slice("--cwd=".length));
      continue;
    }

    if (arg === "--skillset-home") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--skillset-home requires a value.");
      }
      options.skillsetHome = resolve(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--skillset-home=")) {
      options.skillsetHome = resolve(arg.slice("--skillset-home=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function printHelp() {
  console.log(`SkillSet

Usage:
  skillset
  skillset --no-open
  skillset --port 4317
  skillset --cwd /path/to/project

Options:
  --no-open       Start the local server without opening a browser.
  --port <port>  Preferred local port. Falls back if the port is busy.
  --cwd <path>   Project directory used to detect .claude/skills.
  --skillset-home <path>
                 Directory for manifest.json and managed active skills.
  -h, --help     Show this help message.
`);
}

function openBrowser(url: string) {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
