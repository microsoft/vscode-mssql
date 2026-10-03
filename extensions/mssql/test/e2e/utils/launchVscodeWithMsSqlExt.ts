/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    downloadAndUnzipVSCode,
    resolveCliArgsFromVSCodeExecutablePath,
} from "@vscode/test-electron";
import { _electron as electron } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { ElectronApplication, Page, expect } from "@playwright/test";
import { getVsCodeVersionName } from "./envConfigReader";
import * as os from "os";

export type VsCodeAppHandle = ElectronApplication;

export type mssqlExtensionLaunchConfig = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialConfig?: any;
    useVsix?: boolean;
    /**
     * Directory to copy into this launch's extensions dir instead of installing the
     * prerequisite extensions one launch at a time. Defaults to E2E_EXTENSIONS_TEMPLATE,
     * which `scripts/prepare-e2e-env.js` populates once per CI job.
     */
    extensionsTemplateDir?: string;
    /** Additional VS Code CLI arguments appended to the defaults. */
    extraLaunchArgs?: string[];
};

export const DEFAULT_USER_CONFIG = {
    "mssql.showChangelogOnUpdate": false,
};

const DOTNET_RUNTIME_EXTENSION_ID = "ms-dotnettools.vscode-dotnet-runtime";

/**
 * Builds the environment for the VS Code instance under test.
 *
 * Running the suite from inside VS Code's integrated terminal leaks the extension host's own
 * variables into the child. Two of them break the launch outright:
 *
 *  - `ELECTRON_RUN_AS_NODE=1` makes Code.exe run as plain Node, so it rejects Playwright's
 *    `--remote-debugging-port` with "bad option" and exits before printing the debugger line.
 *    Playwright reports this only as "Process failed to launch!".
 *  - `VSCODE_IPC_HOOK` points at the already-running instance, which the new process would
 *    hand off to instead of starting its own window.
 */
function getIsolatedLaunchEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined) {
            continue;
        }
        if (key === "ELECTRON_RUN_AS_NODE" || key.startsWith("VSCODE_")) {
            continue;
        }
        env[key] = value;
    }
    return env;
}

function installExtension(
    cliPath: string,
    extensionIdOrVsix: string,
    userDataDir: string,
    extensionsDir: string,
): void {
    const result = cp.spawnSync(
        cliPath,
        [
            "--install-extension",
            extensionIdOrVsix,
            `--user-data-dir=${userDataDir}`,
            `--extensions-dir=${extensionsDir}`,
        ],
        {
            encoding: "utf-8",
            stdio: "pipe",
            shell: process.platform === "win32",
        },
    );

    console.log(`Extension install (${extensionIdOrVsix}) stdout:`, result.stdout);
    console.log(`Extension install (${extensionIdOrVsix}) stderr:`, result.stderr);
    if (result.status !== 0 || result.error) {
        throw result.error || new Error(`Extension install failed with status ${result.status}`);
    }
}

export async function launchVsCodeWithMssqlExtension(
    options: mssqlExtensionLaunchConfig = {},
): Promise<{
    electronApp: VsCodeAppHandle;
    page: Page;
    userDataDir: string;
    extensionsDir: string;
    videoDir: string;
}> {
    const config: mssqlExtensionLaunchConfig = {
        initialConfig: DEFAULT_USER_CONFIG,
        useVsix: false,
        ...options,
    };

    const vsCodeVersion = getVsCodeVersionName();
    const vscodePath = await downloadAndUnzipVSCode(vsCodeVersion);
    const [cliPath] = resolveCliArgsFromVSCodeExecutablePath(vscodePath);
    const devExtensionPath = findExtensionRoot(__dirname);

    // TODO: Workaround for macOS CI EINVAL error — revert once the upstream VS Code issue is fixed.
    // A recent VS Code build changed the socket filename format (e.g. "1.12-main.sock"), pushing the
    // default user-data-dir path over macOS's hard 103-char Unix socket path limit. On macOS,
    // os.tmpdir() returns a long "/var/folders/.../T" path. Keep temp directories as short as
    // possible to keep the resulting socket path under the limit.
    // Tracked in: https://github.com/microsoft/vscode/issues/319752
    const tmpBaseDir = process.platform === "darwin" ? "/tmp" : os.tmpdir();
    const tmpRoot = fs.mkdtempSync(path.join(tmpBaseDir, "mssql-"));
    const userDataDir = path.join(tmpRoot, "u");
    const extensionsDir = path.join(tmpRoot, "e");
    const videoDir = path.join(
        process.cwd(),
        "test-reports",
        "videos",
        `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    );

    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(extensionsDir, { recursive: true });
    fs.mkdirSync(videoDir, { recursive: true });

    // Create initial settings.json
    const settingsPath = path.join(userDataDir, "User", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(config.initialConfig, undefined, 4));

    const launchArgs: string[] = [
        "--disable-gpu-sandbox",
        "--disable-updates",
        "--new-window",
        "--skip-release-notes",
        "--skip-welcome",
        "--no-sandbox",
        // Selectors throughout the suite resolve through localized aria-labels, so the
        // workbench locale has to be fixed rather than inherited from the machine.
        "--locale=en",
        // A trust prompt would otherwise intercept the first interaction in a workspace.
        "--disable-workspace-trust",
        "--disable-telemetry",
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        ...(config.extraLaunchArgs ?? []),
    ];

    const extensionsTemplateDir =
        config.extensionsTemplateDir ??
        process.env["E2E_EXTENSIONS_TEMPLATE"] ??
        path.join(process.env["RUNNER_TEMP"] || os.tmpdir(), "mssql-e2e-ext-template");

    if (fs.existsSync(path.join(extensionsTemplateDir, "extensions.json"))) {
        // Copying a prepared directory takes about a second; installing the extension
        // costs roughly 35 seconds and would repeat on every launch in the run.
        console.log(`Copying prepared extensions from ${extensionsTemplateDir}...`);
        fs.cpSync(extensionsTemplateDir, extensionsDir, { recursive: true });
    } else if (process.env["SKIP_DOTNET_RUNTIME_EXTENSION_INSTALL"] === "true") {
        console.log(`Skipping ${DOTNET_RUNTIME_EXTENSION_ID} install before launch.`);
    } else {
        console.log(`Installing ${DOTNET_RUNTIME_EXTENSION_ID} before launch...`);
        installExtension(cliPath, DOTNET_RUNTIME_EXTENSION_ID, userDataDir, extensionsDir);
    }

    if (config.useVsix) {
        const vsixPath = process.env["BUILT_VSIX_PATH"];
        if (!vsixPath) throw new Error("BUILT_VSIX_PATH environment variable is not set.");

        /*
         * Launching standalone vsix based tests from a temporary directory so the extension does not pick up
         * node_modules from the codebase. There can be an edge case where the required node module is present
         * in the codebase (as a dev dependency) but not in the vsix package. This can lead to false positives
         */
        console.log("Installing VSIX before launch...");
        installExtension(cliPath, vsixPath, userDataDir, extensionsDir);
    } else {
        launchArgs.push("--temp-profile");
    }

    // Video recording is opt-in everywhere. Locally it interferes with Playwright's window
    // detection (a blank window gets captured instead of the workbench), and in CI each
    // recording costs real CPU for the whole run while parallel workers are competing for
    // it — which shows up as timing flake. Traces are retained on failure instead. Set
    // ENABLE_ELECTRON_VIDEO_RECORDING=true to turn it back on for a single investigation.
    const shouldRecordVideo = process.env["ENABLE_ELECTRON_VIDEO_RECORDING"] === "true";

    console.log("Launching VS Code with:", vscodePath, launchArgs);
    if (shouldRecordVideo) {
        console.log("Staging Playwright videos in:", videoDir);
    }

    const electronLaunchOptions = {
        executablePath: vscodePath,
        env: getIsolatedLaunchEnv(),
        args: config.useVsix
            ? launchArgs
            : [...launchArgs, `--extensionDevelopmentPath=${devExtensionPath}`],
        ...(shouldRecordVideo
            ? {
                  recordVideo: {
                      dir: videoDir,
                      size: { width: 1920, height: 1080 },
                  },
              }
            : {}),
    };

    const electronApp = await electron.launch(electronLaunchOptions);
    try {
        const page = await electronApp.firstWindow({ timeout: 10_000 });

        await page.setViewportSize({ width: 1920, height: 1080 });

        // Activate MSSQL tab if not already selected
        const sqlTab = page.locator('[role="tab"][aria-label^="SQL Server"]');
        if ((await sqlTab.getAttribute("aria-selected")) !== "true") {
            const tabLink = sqlTab.locator("a");
            await tabLink.waitFor({ state: "visible", timeout: 30_000 });
            await tabLink.click();
        }

        // Object Explorer is ready once it has rendered at least one tree item. That is the
        // "Add Connection" placeholder on a clean profile, or the seeded connections when
        // mssql.connections was supplied in initialConfig.
        await expect
            .poll(async () => await page.locator('[role="treeitem"]').count(), {
                timeout: 60_000,
                message: "Object Explorer did not render any tree items.",
            })
            .toBeGreaterThan(0);

        return { electronApp, page, userDataDir, extensionsDir, videoDir };
    } catch (error) {
        await electronApp.close().catch(() => undefined);
        if (path.dirname(tmpRoot) === tmpBaseDir && path.basename(tmpRoot).startsWith("mssql-")) {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
        throw error;
    }
}

/**
 * Walks up from startDir to find the nearest ancestor containing a package.json
 * with a vscode engine entry, identifying it as the VS Code extension root.
 */
function findExtensionRoot(startDir: string): string {
    let dir = path.resolve(startDir);
    const root = path.parse(dir).root;

    while (dir !== root) {
        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            if (pkg.engines?.vscode) {
                return dir;
            }
        }
        dir = path.dirname(dir);
    }

    throw new Error(`Could not find VS Code extension root from ${startDir}`);
}

export async function cleanupDirectories(...directories: Array<string | undefined>) {
    try {
        const dirsToClean = directories.filter((directory): directory is string => !!directory);
        console.log("Cleaning up directories:", dirsToClean);
        for (const directory of dirsToClean) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    } catch (error) {
        console.error("Error cleaning up directories:", error);
    }
}
