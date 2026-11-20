/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { mssqlExtensionLaunchConfig } from "./utils/launchVscodeWithMsSqlExt";
import { getSeededLaunchConfig } from "./utils/seededConnection";
import {
    buildProjectFromTree,
    closeAllEditors,
    getDacpacPath,
    getProjectTreeItem,
    getSqlProjectSettings,
    getTaskTerminal,
    killAllTerminals,
    openProjectsView,
    removeDir,
    reserveTempDir,
    runProjectContextAction,
    waitForNotification,
    writeLegacyProject,
} from "./utils/sqlProjectHelpers";
import { testCases } from "./utils/testCases";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

const PROJECT_NAME = "DotnetSdkProj";
const UNSUPPORTED_SDK_VERSION = "6.0.100";
const SDK_LOCATION_SETTING = "sqlDatabaseProjects.dotnetSDK Location";

const SDK_NOT_FOUND = "The .NET SDK cannot be located. Project build will not work.";
const SDK_NOT_SUPPORTED = `Currently installed .NET SDK version is ${UNSUPPORTED_SDK_VERSION}, which is not supported. Project build will not work.`;
const SDK_ERROR_ACTIONS = ["Update Location", "Install", "Don't Ask Again"];

/** Any notification about the .NET SDK, which a working SDK must not raise. */
function getDotnetNotifications(page: Page): Locator {
    return page.getByRole("dialog", { name: /notification/i }).filter({ hasText: /\.NET SDK/ });
}

/** The folder of the .NET SDK on the PATH (e.g. /usr/local/share/dotnet), if there is one. */
function findDotnetRoot(): string | undefined {
    const result = cp.spawnSync("dotnet", ["--list-sdks"], { encoding: "utf8" });
    // Each line reads "<version> [<root>/sdk]".
    const sdkFolder = result.stdout?.match(/^\S+\s+\[(.+)\]\s*$/m)?.[1];
    return sdkFolder ? path.dirname(sdkFolder) : undefined;
}

/**
 * Writes a stand-in `dotnet` that reports an SDK older than the minimum the extension supports.
 * It is a shell script, so this only works where the extension can run one directly.
 */
function writeOutdatedDotnet(folder: string): void {
    fs.mkdirSync(folder, { recursive: true });
    const script = path.join(folder, "dotnet");
    fs.writeFileSync(
        script,
        [
            "#!/bin/sh",
            'case "$1" in',
            `  --version) echo "${UNSUPPORTED_SDK_VERSION}" ;;`,
            `  --list-sdks) echo "${UNSUPPORTED_SDK_VERSION} [$(dirname "$0")/sdk]" ;;`,
            '  *) echo "Outdated .NET SDK stand-in" >&2; exit 1 ;;',
            "esac",
            "",
        ].join("\n"),
    );
    fs.chmodSync(script, 0o755);
}

/**
 * SQL Database Projects .NET SDK supportability. Building a project checks for a .NET SDK that is
 * at least 8.0, looking in the "dotnetSDK Location" setting. Each describe launches VS Code on a
 * folder with a legacy project, with that setting pointing at a missing folder, at a stand-in
 * `dotnet` that reports an outdated SDK, or at the real SDK.
 */
test.describe("SQL Database Projects .NET SDK supportability", () => {
    /**
     * Shared launch for one SDK scenario. `launchOptions.initialConfig` is filled in by the
     * scenario's own beforeAll, which is declared before this lifecycle so it runs first.
     */
    function useSdkScenario(workspaceDir: string, launchOptions: mssqlExtensionLaunchConfig) {
        launchOptions.extraLaunchArgs = [workspaceDir, ...(launchOptions.extraLaunchArgs ?? [])];
        const getContext = useSharedVsCodeLifecycle({
            launchOptions,
            afterLaunch: async ({ page }) => {
                await openProjectsView(page);
                await expect(getProjectTreeItem(page, PROJECT_NAME)).toBeVisible({
                    timeout: 60 * 1000,
                });
            },
            beforeClose: async ({ page }) => {
                await killAllTerminals(page);
            },
        });
        test.afterAll(() => removeDir(workspaceDir));
        return getContext;
    }

    /** Settings for a scenario: the SDK location under test, and the install prompt enabled. */
    function getScenarioConfig(workspaceDir: string, sdkLocation: string | undefined) {
        return getSeededLaunchConfig({
            ...getSqlProjectSettings(workspaceDir),
            "sqlDatabaseProjects.netCoreDoNotAsk": false,
            ...(sdkLocation ? { [SDK_LOCATION_SETTING]: sdkLocation } : {}),
        });
    }

    /**
     * Builds the project and checks that the build is refused with the given error, which offers
     * to update the SDK location; that action opens the Settings editor.
     */
    async function expectBuildRefused(page: Page, workspaceDir: string, message: string) {
        const projectFile = path.join(workspaceDir, PROJECT_NAME, `${PROJECT_NAME}.sqlproj`);
        await runProjectContextAction(page, getProjectTreeItem(page, PROJECT_NAME), "Build");

        const toast = await waitForNotification(page, message);
        for (const action of SDK_ERROR_ACTIONS) {
            await expect(toast.getByRole("button", { name: action, exact: true })).toBeVisible();
        }
        // The SDK check fails before the build task starts.
        await expect(getTaskTerminal(page, "Build")).toHaveCount(0);
        expect(fs.existsSync(getDacpacPath(projectFile))).toBe(false);

        await toast.getByRole("button", { name: "Update Location", exact: true }).click();
        await expect(toast).toBeHidden();
        await closeSettingsEditor(page);
    }

    /** Waits for the Settings editor, which recent VS Code builds open as a modal, and closes it. */
    async function closeSettingsEditor(page: Page) {
        const settingsModal = page.getByRole("dialog", { name: "Settings", exact: true });
        const settingsTab = page.getByRole("tab", { name: /^Settings\b/ });
        await expect(settingsModal.or(settingsTab).first()).toBeVisible({ timeout: 30 * 1000 });
        if (await settingsModal.isVisible()) {
            await settingsModal.getByRole("button", { name: /^Close Modal Editor\b/ }).click();
            await expect(settingsModal).toBeHidden();
        } else {
            await closeAllEditors(page);
        }
    }

    test.describe("with no SDK at the configured location", () => {
        const workspaceDir = reserveTempDir("sqlproj-dotnet-missing");
        const launchOptions: mssqlExtensionLaunchConfig = {};

        test.beforeAll(() => {
            writeLegacyProject(workspaceDir, PROJECT_NAME);
            launchOptions.initialConfig = getScenarioConfig(
                workspaceDir,
                path.join(workspaceDir, "missing-dotnet"),
            );
        });

        const getContext = useSdkScenario(workspaceDir, launchOptions);

        test("build reports that the .NET SDK cannot be located", testCases(5878853), async () => {
            await expectBuildRefused(getContext().page, workspaceDir, SDK_NOT_FOUND);
        });
    });

    test.describe("with an outdated SDK", () => {
        // The stand-in dotnet is a shell script, which Windows cannot run as "dotnet".
        test.skip(
            process.platform === "win32",
            "Faking an outdated .NET SDK needs a dotnet shell script.",
        );

        const workspaceDir = reserveTempDir("sqlproj-dotnet-outdated");
        const outdatedSdkDir = path.join(workspaceDir, "outdated-dotnet");
        const launchOptions: mssqlExtensionLaunchConfig = {
            // VS Code would otherwise replace the PATH it is given with the one a login shell
            // reports, which on macOS puts the installed SDK ahead of the outdated stand-in.
            extraLaunchArgs: ["--force-disable-user-env"],
        };
        const originalPath = process.env.PATH;

        // The extension checks the SDK version by running "dotnet" from the PATH, so the
        // stand-in goes first on the PATH VS Code inherits, and in the location setting.
        test.beforeAll(() => {
            writeLegacyProject(workspaceDir, PROJECT_NAME);
            writeOutdatedDotnet(outdatedSdkDir);
            launchOptions.initialConfig = getScenarioConfig(workspaceDir, outdatedSdkDir);
            process.env.PATH = [outdatedSdkDir, originalPath].join(path.delimiter);
        });

        const getContext = useSdkScenario(workspaceDir, launchOptions);

        // VS Code has its environment once it is up, so later launches in this worker see the
        // usual PATH again.
        test.beforeAll(() => {
            process.env.PATH = originalPath;
        });
        test.afterAll(() => {
            process.env.PATH = originalPath;
        });

        test(
            `build reports that .NET SDK ${UNSUPPORTED_SDK_VERSION} is not supported`,
            testCases(5878853),
            async () => {
                await expectBuildRefused(getContext().page, workspaceDir, SDK_NOT_SUPPORTED);
            },
        );
    });

    test.describe("with a supported SDK", () => {
        const workspaceDir = reserveTempDir("sqlproj-dotnet-supported");
        const launchOptions: mssqlExtensionLaunchConfig = {};
        let dotnetRoot: string | undefined;

        test.beforeAll(() => {
            writeLegacyProject(workspaceDir, PROJECT_NAME);
            dotnetRoot = findDotnetRoot();
            launchOptions.initialConfig = getScenarioConfig(workspaceDir, dotnetRoot);
        });

        const getContext = useSdkScenario(workspaceDir, launchOptions);

        test(
            "build succeeds with the SDK location set to an installed SDK",
            testCases(5878853),
            async () => {
                test.skip(!dotnetRoot, "No .NET SDK is installed.");
                const { page } = getContext();
                const projectFile = path.join(
                    workspaceDir,
                    PROJECT_NAME,
                    `${PROJECT_NAME}.sqlproj`,
                );

                await buildProjectFromTree(page, projectFile);

                await expect(getTaskTerminal(page, "Build")).toBeAttached();
                await expect(getDotnetNotifications(page)).toHaveCount(0);
            },
        );
    });
});
