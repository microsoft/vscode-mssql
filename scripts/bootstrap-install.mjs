import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { workspaceTargets } from "./workspace-targets.mjs";

const installArgs = process.env.CI ? ["ci"] : ["install"];

function installDirectory(directory) {
    const absoluteDirectory = path.join(process.cwd(), directory);
    const lockfilePath = path.join(absoluteDirectory, "package-lock.json");

    if (!fs.existsSync(lockfilePath)) {
        throw new Error(`Missing lockfile for ${directory}. Expected ${lockfilePath}.`);
    }

    console.log(`\n> bootstrap install :: ${directory}`);

    const command = process.platform === "win32" ? "cmd.exe" : "npm";
    const commandArgs =
        process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd", ...installArgs] : installArgs;

    const result = spawnSync(command, commandArgs, {
        cwd: absoluteDirectory,
        stdio: "inherit",
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

const directories = [...new Map(workspaceTargets.map((target) => [target.directory, true])).keys()];

for (const directory of directories) {
    installDirectory(directory);
}
