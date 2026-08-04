import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { workspaceTargets } from "./workspace-targets.mjs";

const EXTENSION_DIRECTORIES = workspaceTargets
    .filter((target) => target.kind === "extension")
    .map((target) => target.directory);

const telemetryKey = process.env.MSSQL_APP_INSIGHTS_KEY;
if (!telemetryKey) {
    throw new Error("MSSQL_APP_INSIGHTS_KEY environment variable is not set");
}

for (const extensionDirectory of EXTENSION_DIRECTORIES) {
    const packagePath = path.join(extensionDirectory, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    packageJson.aiKey = telemetryKey;
    await writeFile(packagePath, `${JSON.stringify(packageJson, undefined, 4)}\n`);
}
