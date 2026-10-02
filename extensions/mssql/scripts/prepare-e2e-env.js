/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Prepares the shared pieces of the e2e environment once per CI job:
 *
 *  1. Downloads VS Code into `.vscode-test` (a no-op when the cache already has it).
 *  2. Builds an extensions directory with the prerequisite extensions installed.
 *
 * `launchVsCodeWithMssqlExtension` copies that directory per launch instead of running an
 * install every time, which otherwise costs ~35s on each of the launches in a run.
 *
 * The launcher discovers the populated directory at its default temp path, so the existing
 * smoke-test step needs no extra environment assignment.
 */

const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
    downloadAndUnzipVSCode,
    resolveCliArgsFromVSCodeExecutablePath,
} = require("@vscode/test-electron");

const PREREQUISITE_EXTENSION_IDS = ["ms-dotnettools.vscode-dotnet-runtime"];

function getTemplateRoot() {
    if (process.env["E2E_EXTENSIONS_TEMPLATE"]) {
        return process.env["E2E_EXTENSIONS_TEMPLATE"];
    }
    const base = process.env["RUNNER_TEMP"] || os.tmpdir();
    return path.join(base, "mssql-e2e-ext-template");
}

/**
 * `--install-extension` writes extensions.json once it has installed something, so its
 * presence means a previous run (or a restored cache) already populated the directory.
 */
function isTemplatePopulated(templateDir) {
    return fs.existsSync(path.join(templateDir, "extensions.json"));
}

async function main() {
    const vsCodeVersion = process.env["VS_CODE_VERSION_NAME"] || "stable";
    const vscodePath = await downloadAndUnzipVSCode(vsCodeVersion);
    const [cliPath] = resolveCliArgsFromVSCodeExecutablePath(vscodePath);

    const templateDir = getTemplateRoot();
    const templateUserDataDir = `${templateDir}-user-data`;

    if (isTemplatePopulated(templateDir)) {
        console.error(`Reusing prepared extensions directory at ${templateDir}`);
    } else {
        fs.mkdirSync(templateDir, { recursive: true });
        fs.mkdirSync(templateUserDataDir, { recursive: true });

        for (const extensionId of PREREQUISITE_EXTENSION_IDS) {
            console.error(`Installing ${extensionId} into the extensions template...`);
            const result = cp.spawnSync(
                cliPath,
                [
                    "--install-extension",
                    extensionId,
                    `--user-data-dir=${templateUserDataDir}`,
                    `--extensions-dir=${templateDir}`,
                ],
                { encoding: "utf-8", stdio: "inherit", shell: process.platform === "win32" },
            );

            if (result.status !== 0 || result.error) {
                throw (
                    result.error ||
                    new Error(`Installing ${extensionId} failed with status ${result.status}`)
                );
            }
        }
    }

    console.error(`Prepared extensions directory at ${templateDir}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
