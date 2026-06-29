// Stamps a pre-release version onto every extension's package.json.
// New version format: <currentVersion>-<label>.<buildId>+<shortGitHash>
//
// Usage:
//   node scripts/stamp-prerelease-version.mjs <buildId> --label <label>
//
// Both arguments are required. Callers pick a label appropriate for their flow:
//   - "preview" for official/buddy publishing pipelines
//   - "pr" for PR-validation pipelines

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { workspaceTargets } from "./workspace-targets.mjs";

const EXTENSIONS = workspaceTargets.map((t) => path.basename(t.directory));

const USAGE = "Usage: node scripts/stamp-prerelease-version.mjs <buildId> --label <label>";

function parseArgs(argv) {
    let buildId;
    let label;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--label") {
            label = argv[i + 1];
            i++;
            continue;
        }
        if (arg.startsWith("--label=")) {
            label = arg.slice("--label=".length);
            continue;
        }
        if (!buildId) {
            buildId = arg;
            continue;
        }
    }

    return { buildId, label };
}

function main() {
    const { buildId, label } = parseArgs(process.argv.slice(2));

    if (!buildId || buildId.trim().length === 0) {
        console.error("Missing required <buildId> argument.");
        console.error(USAGE);
        process.exit(1);
    }

    if (!label || label.trim().length === 0) {
        console.error("Missing required --label argument.");
        console.error(USAGE);
        process.exit(1);
    }

    const commitHash = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const shortHash = commitHash.slice(0, 7);

    for (const ext of EXTENSIONS) {
        const packagePath = path.join("extensions", ext, "package.json");
        const original = readFileSync(packagePath, "utf8");

        const json = JSON.parse(original);
        const currentVersion = json.version;
        if (!currentVersion) {
            throw new Error(`No "version" field found in ${packagePath}`);
        }

        const newVersion = `${currentVersion}-${label}.${buildId}+${shortHash}`;
        console.log(`Updating ${packagePath}: ${currentVersion} -> ${newVersion}`);

        const updated = original.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${newVersion}"`);

        if (updated === original) {
            throw new Error(`Failed to update version field in ${packagePath}`);
        }

        writeFileSync(packagePath, updated);
    }
}

main();
