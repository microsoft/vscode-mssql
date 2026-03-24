import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { workspaceTargets } from "./workspace-targets.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const installArgs = process.env.CI
    ? ["ci", "--legacy-peer-deps"]
    : ["install", "--legacy-peer-deps"];

function installDirectory(directory) {
    const absoluteDirectory = path.join(process.cwd(), directory);
    const lockfilePath = path.join(absoluteDirectory, "package-lock.json");

    if (!fs.existsSync(lockfilePath)) {
        throw new Error(`Missing lockfile for ${directory}. Expected ${lockfilePath}.`);
    }

    console.log(`\n> bootstrap install :: ${directory}`);

    const result = spawnSync(npmCommand, installArgs, {
        cwd: absoluteDirectory,
        stdio: "inherit",
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

const directories = [...new Map(workspaceTargets.map((target) => [target.directory, true])).keys()];

for (const directory of directories) {
    installDirectory(directory);
}
