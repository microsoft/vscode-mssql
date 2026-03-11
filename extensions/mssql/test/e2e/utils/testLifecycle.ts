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

type VideoArtifactDestination = {
    label: string;
    outputDir: string;
    testInfo?: TestInfo;
};

export function useSharedVsCodeLifecycle(
    hooks: SharedLifecycleHooks = {},
): () => VsCodeLaunchContext {
    let context: VsCodeLaunchContext | undefined;
    const failedTests: VideoArtifactDestination[] = [];

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
            failedTests.push({
                label: testInfo.title,
                outputDir: testInfo.outputDir,
                testInfo,
            });
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
        if (failedTests.length === 0) {
            await cleanupDirectories(currentContext.videoDir);
        } else {
            await storeRecordedVideos(currentContext.videoDir, failedTests);
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
            await storeRecordedVideos(currentContext.videoDir, [
                {
                    label: testInfo.title,
                    outputDir: testInfo.outputDir,
                    testInfo,
                },
            ]);
        }
        await cleanupDirectories(currentContext.userDataDir, currentContext.extensionsDir);
    });

    return getContext;
}

async function storeRecordedVideos(
    videoDir: string,
    destinations: VideoArtifactDestination[],
): Promise<void> {
    if (!fs.existsSync(videoDir) || destinations.length === 0) {
        return;
    }

    const webmFiles = await findWebmFiles(videoDir);
    if (webmFiles.length === 0) {
        return;
    }

    const timestamp = Date.now();
    const sortedFiles = webmFiles.sort();

    for (const destination of destinations) {
        const safeLabel = sanitizeForFileName(destination.label);
        await fs.promises.mkdir(destination.outputDir, { recursive: true });

        for (const [index, sourcePath] of sortedFiles.entries()) {
            const targetPath = path.join(
                destination.outputDir,
                `${safeLabel}-${timestamp}-${index + 1}.webm`,
            );
            await fs.promises.copyFile(sourcePath, targetPath);
            destination.testInfo?.attachments.push({
                name: path.basename(targetPath),
                path: targetPath,
                contentType: "video/webm",
            });
        }
    }

    await cleanupDirectories(videoDir);
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
