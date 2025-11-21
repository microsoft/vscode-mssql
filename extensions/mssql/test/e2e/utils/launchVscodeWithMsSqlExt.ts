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
import * as os from "os";

export type mssqlExtensionLaunchConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialConfig?: any;
  useVsix?: boolean;
};

export const DEFAULT_USER_CONFIG = {
  "mssql.showChangelogOnUpdate": false,
};

export async function launchVsCodeWithMssqlExtension(
  options: mssqlExtensionLaunchConfig = {},
): Promise<{
  electronApp: ElectronApplication;
  page: Page;
  userDataDir: string;
  extensionsDir: string;
  nodePathDir?: string;
}> {
  const config: mssqlExtensionLaunchConfig = {
    initialConfig: DEFAULT_USER_CONFIG,
    useVsix: false,
    ...options,
  };

  const vsCodeVersion = getVsCodeVersionName();
  const vscodePath = await downloadAndUnzipVSCode(vsCodeVersion);
  const [cliPath, extensionDir] =
    resolveCliArgsFromVSCodeExecutablePath(vscodePath);
  const devExtensionPath = path.resolve(__dirname, "../../../");

  const tmpRoot = path.join(os.tmpdir(), `vscode-mssql-test-${Date.now()}`);
  const userDataDir = path.join(tmpRoot, "user-data");
  const extensionsDir = path.join(tmpRoot, "extensions");

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });

  // Create initial settings.json
  const settingsPath = path.join(userDataDir, "User", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    JSON.stringify(config.initialConfig, undefined, 4),
  );

  const launchArgs: string[] = [
    "--disable-gpu-sandbox",
    "--disable-updates",
    "--new-window",
    "--skip-release-notes",
    "--skip-welcome",
    "--no-sandbox",
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
  ];

  if (config.useVsix) {
    const vsixPath = process.env["BUILT_VSIX_PATH"];
    if (!vsixPath)
      throw new Error("BUILT_VSIX_PATH environment variable is not set.");

    /*
     * Launching standalone vsix based tests from a temporary directory so the extension does not pick up
     * node_modules from the codebase. There can be an edge case where the required node module is present
     * in the codebase (as a dev dependency) but not in the vsix package. This can lead to false positives
     */
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
      throw (
        result.error ||
        new Error(`VSIX install failed with status ${result.status}`)
      );
    }
  } else {
    launchArgs.push(
      "--temp-profile",
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

  await page.setViewportSize({ width: 1920, height: 1080 });

  // Activate MSSQL tab if not already selected
  const sqlTab = page.locator('[role="tab"][aria-label^="SQL Server"]');
  if ((await sqlTab.getAttribute("aria-selected")) !== "true") {
    const tabLink = sqlTab.locator("a");
    await tabLink.waitFor({ state: "visible", timeout: 30_000 });
    await tabLink.click();
  }

  // Wait for Object Explorer to finish loading
  await page
    .getByText(
      "There is no data provider registered that can provide view data.",
    )
    .first()
    .waitFor({ state: "hidden", timeout: 30_000 });

  await page
    .locator('[role="treeitem"][aria-label*="Add Connection"]')
    .waitFor({
      state: "visible",
      timeout: 30_000,
    });

  return { electronApp, page, userDataDir, extensionsDir };
}

export async function cleanupDirectories(
  userDir: string,
  extDir: string,
  nodePathDir: string,
) {
  try {
    console.log("Cleaning up directories:", userDir, extDir, nodePathDir);
    fs.rmSync(userDir, { recursive: true, force: true });
    fs.rmSync(extDir, { recursive: true, force: true });
    fs.rmSync(nodePathDir, { recursive: true, force: true });
  } catch (error) {
    console.error("Error cleaning up directories:", error);
  }
}
