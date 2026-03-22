import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { workspaceTargets } from "./workspace-targets.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function installDirectory(directory) {
    console.log(`\n> bootstrap install :: ${directory}`);

    const result = spawnSync(npmCommand, ["install", "--package-lock=false"], {
        cwd: path.join(process.cwd(), directory),
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
