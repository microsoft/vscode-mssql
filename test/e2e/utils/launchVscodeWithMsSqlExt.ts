/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { _electron as electron } from "playwright";
import * as path from "path";
import { ElectronApplication, Page } from "@playwright/test";
import { getVsCodeVersionName } from "./envConfigReader";

export async function launchVsCodeWithMssqlExtension(oldUi?: boolean): Promise<{
    electronApp: ElectronApplication;
    page: Page;
}> {
    const vsCodeVersionName = getVsCodeVersionName();
    const vsCodeExecutablePath = await downloadAndUnzipVSCode(vsCodeVersionName);

    const mssqlExtensionPath = path.resolve(__dirname, "../../../");

    const settingsOption = oldUi
        ? `--user-data-dir=${path.join(process.cwd(), "test", "resources", "launchDir")}`
        : "";

    const electronApp = await electron.launch({
        executablePath: vsCodeExecutablePath,
        args: [
            "--disable-extensions",
            "--extensionDevelopmentPath=" + mssqlExtensionPath,
            "--disable-gpu-sandbox", // https://github.com/microsoft/vscode-test/issues/221
            "--disable-updates", // https://github.com/microsoft/vscode-test/issues/120
            "--new-window", // Opens a new session of VS Code instead of restoring the previous session (default).
            "--no-sandbox", // https://github.com/microsoft/vscode/issues/84238
            "--profile-temp", // "debug in a clean environment"
            "--skip-release-notes",
            "--skip-welcome",
            settingsOption,
        ],
    });

    const page = await electronApp.firstWindow({
        timeout: 10 * 1000, // 10 seconds
    });

    // Navigate to Sql Server Tab
    const sqlServerTabElement = page.locator('[role="tab"][aria-label*="SQL Server (Ctrl+Alt+D)"]');
    await sqlServerTabElement.waitFor({ state: "visible", timeout: 30 * 1000 });
    await page.keyboard.press("Control+Alt+D");

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
