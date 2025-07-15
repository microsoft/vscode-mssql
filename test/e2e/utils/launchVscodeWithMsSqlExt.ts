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
import { ElectronApplication, Page, TestInfo } from "@playwright/test";
import { getVsCodeVersionName } from "./envConfigReader";
import * as cp from "child_process";

export async function launchVsCodeWithMssqlExtension(
    oldUi?: boolean,
    testInfo?: TestInfo,
): Promise<{
    electronApp: ElectronApplication;
    page: Page;
}> {
    // Check env variable for vsix file path
    let vsixPath = process.env["BUILT_VSIX_PATH"];
    const vsCodeVersionName = getVsCodeVersionName();
    const vsCodeExecutablePath = await downloadAndUnzipVSCode(vsCodeVersionName);
    const [cliPath, installedExtensionsPath] =
        resolveCliArgsFromVSCodeExecutablePath(vsCodeExecutablePath);

    const mssqlExtensionPath = path.resolve(__dirname, "../../../");

    const userDataPath = oldUi
        ? `--user-data-dir=${path.join(process.cwd(), "test", "resources", "launchDir")}`
        : "";

    if (vsixPath) {
        console.log(`Using VSIX path: ${vsixPath}`);
        const result = cp.spawnSync(
            cliPath,
            [installedExtensionsPath, userDataPath, "--install-extension", vsixPath],
            {
                encoding: "utf-8",
                stdio: "pipe", // capture output for inspection
            },
        );

        console.log("stdout:", result.stdout);
        console.log("stderr:", result.stderr);
        console.log("status:", result.status);
        console.log("error:", result.error);
    } else {
        console.log("No VSIX path provided, launching with extension development path.");
    }

    const args = [
        "--disable-gpu-sandbox", // https://github.com/microsoft/vscode-test/issues/221
        "--disable-updates", // https://github.com/microsoft/vscode-test/issues/120
        "--new-window", // Opens a new session of VS Code instead of restoring the previous session (default).
        "--no-sandbox", // https://github.com/microsoft/vscode/issues/84238
        "--skip-release-notes",
        "--skip-welcome",
        installedExtensionsPath,
        userDataPath,
    ];

    if (!vsixPath) {
        args.push(`--profile-temp`); // "debug in a clean environment"
        args.push(`--disable-extensions`); // Disable all extensions except the one we are testing
        args.push(`--extensionDevelopmentPath=${mssqlExtensionPath}`); // Path to the extension being developed
    }

    const electronApp = await electron.launch({
        executablePath: vsCodeExecutablePath,
        args: args,
    });

    const page = await electronApp.firstWindow({
        timeout: 10 * 1000, // 10 seconds
    });

    if (testInfo) {
        await page.screenshot({
            path: testInfo.outputPath("vscode-launch.png"),
        });
    }

    // Navigate to Sql Server Tab
    const sqlServerTabContainer = page.locator('[role="tab"][aria-label^="SQL Server"]');
    const isSelected = await sqlServerTabContainer.getAttribute("aria-selected");

    if (isSelected !== "true") {
        const sqlServerTabElement = sqlServerTabContainer.locator("a");
        await sqlServerTabElement.waitFor({ state: "visible", timeout: 30 * 1000 });
        await sqlServerTabElement.click();
    }

    // Wait for extension to load
    const objectExplorerProviderElement = page
        .getByText("There is no data provider registered that can provide view data.")
        .first();
    await objectExplorerProviderElement.waitFor({
        state: "hidden",
        timeout: 30 * 1000,
    });

    // Ensure the extension has loaded by checking object explorer has loaded
    const objectExplorerElement = page.locator('[role="treeitem"][aria-label*="Add Connection"]');
    await objectExplorerElement.waitFor({
        state: "visible",
        timeout: 30 * 1000,
    });

    return { electronApp, page };
}
