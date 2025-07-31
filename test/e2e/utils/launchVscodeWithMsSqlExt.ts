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
import { ElectronApplication, Page } from "@playwright/test";
import { getVsCodeVersionName } from "./envConfigReader";

export type mssqlExtensionLaunchConfig = {
    useNewUI?: boolean;
    useVsix?: boolean;
};

export async function launchVsCodeWithMssqlExtension(
    options: mssqlExtensionLaunchConfig = {},
): Promise<{ electronApp: ElectronApplication; page: Page }> {
    const config = { useNewUI: true, useVsix: false, ...options };

    const vsCodeVersion = getVsCodeVersionName();
    const vscodePath = await downloadAndUnzipVSCode(vsCodeVersion);
    const [cliPath, extensionDir] = resolveCliArgsFromVSCodeExecutablePath(vscodePath);
    const devExtensionPath = path.resolve(__dirname, "../../../");

    // Persistent paths for test session
    const launchRoot = path.join(process.cwd(), "test", "resources", "vscode-test-session");
    const userDataDir = path.join(launchRoot, "user-data");
    const extensionsDir = path.join(launchRoot, "extensions");

    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(extensionsDir, { recursive: true });

    const launchArgs: string[] = [
        "--disable-gpu-sandbox",
        "--disable-updates",
        "--new-window",
        "--no-sandbox",
        "--skip-release-notes",
        "--skip-welcome",
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
    ];

    if (config.useVsix) {
        const vsixPath = process.env["BUILT_VSIX_PATH"];
        if (!vsixPath) throw new Error("BUILT_VSIX_PATH environment variable is not set.");

        console.log("Installing VSIX before launch...");
        const result = cp.spawnSync(
            cliPath,
            [
                "--install-extension",
                vsixPath,
                `--user-data-dir=${userDataDir}`,
                `--extensions-dir=${extensionsDir}`,
            ],
            {
                encoding: "utf-8",
                stdio: "pipe",
            },
        );

        console.log("VSIX install stdout:", result.stdout);
        console.log("VSIX install stderr:", result.stderr);
        if (result.status !== 0 || result.error) {
            throw result.error || new Error(`VSIX install failed with status ${result.status}`);
        }
    } else {
        launchArgs.push(
            "--disable-extensions",
            `--extensionDevelopmentPath=${devExtensionPath}`,
            extensionDir,
        );
    }

    console.log("Launching VS Code with:", vscodePath, launchArgs);
    const electronApp = await electron.launch({
        executablePath: vscodePath,
        args: launchArgs,
    });

    const page = await electronApp.firstWindow({ timeout: 10_000 });

    // Activate MSSQL tab if not already selected
    const sqlTab = page.locator('[role="tab"][aria-label^="SQL Server"]');
    if ((await sqlTab.getAttribute("aria-selected")) !== "true") {
        const tabLink = sqlTab.locator("a");
        await tabLink.waitFor({ state: "visible", timeout: 30_000 });
        await tabLink.click();
    }

    // Wait for Object Explorer to finish loading
    await page
        .getByText("There is no data provider registered that can provide view data.")
        .first()
        .waitFor({ state: "hidden", timeout: 30_000 });

    await page.locator('[role="treeitem"][aria-label*="Add Connection"]').waitFor({
        state: "visible",
        timeout: 30_000,
    });

    return { electronApp, page };
}
