/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page, TestInfo } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { test } from "../baseFixtures";
import {
    cleanupDirectories,
    launchVsCodeWithMssqlExtension,
    mssqlExtensionLaunchConfig,
    VsCodeAppHandle,
} from "./launchVscodeWithMsSqlExt";
import { hasTestFailure, screenshotOnFailure } from "./screenshotUtils";

export type VsCodeLaunchContext = {
    electronApp: VsCodeAppHandle;
    page: Page;
    userDataDir: string;
    extensionsDir: string;
    videoDir: string;
    nodePathDir?: string;
};

type SharedLifecycleHooks = {
    launchOptions?: mssqlExtensionLaunchConfig;
    afterLaunch?: (context: VsCodeLaunchContext) => Promise<void>;
    afterEach?: (context: VsCodeLaunchContext, testInfo: TestInfo) => Promise<void>;
    beforeClose?: (context: VsCodeLaunchContext) => Promise<void>;
};

type PerTestLifecycleHooks = {
    launchOptions?: mssqlExtensionLaunchConfig;
    afterLaunch?: (context: VsCodeLaunchContext) => Promise<void>;
    beforeClose?: (context: VsCodeLaunchContext, testInfo: TestInfo) => Promise<void>;
};

export function useSharedVsCodeLifecycle(
    hooks: SharedLifecycleHooks = {},
): () => VsCodeLaunchContext {
    let context: VsCodeLaunchContext | undefined;
    let suiteHasFailures = false;
    const failedTestTitles: string[] = [];

    const getContext = (): VsCodeLaunchContext => {
        if (!context) {
            throw new Error("VS Code test context not initialized.");
        }
        return context;
    };

    test.beforeAll(async () => {
        context = await launchVsCodeWithMssqlExtension(hooks.launchOptions);
        await hooks.afterLaunch?.(context);
    });

    test.afterEach(async ({}, testInfo) => {
        if (!context) {
            return;
        }
        const currentContext = getContext();
        if (hasTestFailure(testInfo)) {
            suiteHasFailures = true;
            failedTestTitles.push(testInfo.title);
        }
        await screenshotOnFailure(currentContext.page, testInfo);
        await hooks.afterEach?.(currentContext, testInfo);
    });

    test.afterAll(async () => {
        if (!context) {
            return;
        }
        const currentContext = getContext();
        await hooks.beforeClose?.(currentContext);
        await currentContext.electronApp.close();
        if (!suiteHasFailures) {
            await cleanupDirectories(currentContext.videoDir);
        } else {
            const sharedFailureLabel =
                failedTestTitles.length === 1
                    ? failedTestTitles[0]
                    : `${failedTestTitles.length}-failed-tests`;
            await renameRecordedVideos(currentContext.videoDir, sharedFailureLabel);
        }
    });

    return getContext;
}

export function usePerTestVsCodeLifecycle(
    hooks: PerTestLifecycleHooks = {},
): () => VsCodeLaunchContext {
    let context: VsCodeLaunchContext | undefined;

    const getContext = (): VsCodeLaunchContext => {
        if (!context) {
            throw new Error("VS Code test context not initialized.");
        }
        return context;
    };

    test.beforeEach(async () => {
        context = await launchVsCodeWithMssqlExtension(hooks.launchOptions);
        await hooks.afterLaunch?.(context);
    });

    test.afterEach(async ({}, testInfo) => {
        if (!context) {
            return;
        }
        const currentContext = getContext();
        const shouldKeepVideo = hasTestFailure(testInfo);

        await screenshotOnFailure(currentContext.page, testInfo);
        await hooks.beforeClose?.(currentContext, testInfo);
        await currentContext.electronApp.close();

        if (!shouldKeepVideo) {
            await cleanupDirectories(currentContext.videoDir);
        } else {
            await renameRecordedVideos(currentContext.videoDir, testInfo.title);
        }
        await cleanupDirectories(
            currentContext.userDataDir,
            currentContext.extensionsDir,
            currentContext.nodePathDir,
        );
    });

    return getContext;
}

async function renameRecordedVideos(videoDir: string, label: string): Promise<void> {
    if (!fs.existsSync(videoDir)) {
        return;
    }

    const webmFiles = await findWebmFiles(videoDir);
    if (webmFiles.length === 0) {
        return;
    }

    const timestamp = Date.now();
    const safeLabel = sanitizeForFileName(label);
    const sortedFiles = webmFiles.sort();
    for (const [index, sourcePath] of sortedFiles.entries()) {
        const targetPath = path.join(videoDir, `${safeLabel}-${timestamp}-${index + 1}.webm`);
        if (sourcePath === targetPath) {
            continue;
        }
        await fs.promises.rename(sourcePath, targetPath);
    }
}

async function findWebmFiles(directory: string): Promise<string[]> {
    const output: string[] = [];
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            output.push(...(await findWebmFiles(entryPath)));
        } else if (entry.isFile() && entry.name.endsWith(".webm")) {
            output.push(entryPath);
        }
    }
    return output;
}

function sanitizeForFileName(value: string): string {
    const collapsed = value
        .trim()
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return collapsed || "playwright-video";
}
