/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page, TestInfo } from "@playwright/test";
import * as cp from "child_process";
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

const ELECTRON_CLOSE_TIMEOUT_MS = 30_000;
const ELECTRON_KILL_TIMEOUT_MS = 10_000;

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
        await closeElectronApp(currentContext.electronApp);
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
        await closeElectronApp(currentContext.electronApp);

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

async function closeElectronApp(electronApp: VsCodeAppHandle): Promise<void> {
    const closeResult = electronApp.close().then(
        () => ({ state: "closed" as const }),
        (error: unknown) => ({ state: "failed" as const, error }),
    );
    let timeoutHandle: NodeJS.Timeout;
    const timeoutResult = new Promise<{ state: "timedOut" }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ state: "timedOut" }), ELECTRON_CLOSE_TIMEOUT_MS);
    });
    const result = await Promise.race([closeResult, timeoutResult]);
    clearTimeout(timeoutHandle!);

    if (result.state === "failed") {
        throw result.error;
    }

    if (result.state === "closed") {
        return;
    }

    console.warn(
        `VS Code did not close within ${ELECTRON_CLOSE_TIMEOUT_MS / 1000} seconds; terminating it.`,
    );
    const electronProcess = electronApp.process();
    const processExit = new Promise<void>((resolve) => {
        electronProcess.once("close", () => resolve());
    });
    killProcessTree(electronProcess);

    let killTimeoutHandle: NodeJS.Timeout;
    await Promise.race([
        processExit,
        new Promise<never>((_, reject) => {
            killTimeoutHandle = setTimeout(
                () => reject(new Error("Timed out waiting for the VS Code process tree to exit.")),
                ELECTRON_KILL_TIMEOUT_MS,
            );
        }),
    ]).finally(() => clearTimeout(killTimeoutHandle!));
}

function killProcessTree(electronProcess: cp.ChildProcess): void {
    if (!electronProcess.pid) {
        throw new Error("Cannot terminate VS Code because its process ID is unavailable.");
    }

    if (process.platform === "win32") {
        const result = cp.spawnSync(
            "taskkill",
            ["/pid", electronProcess.pid.toString(), "/T", "/F"],
            {
                encoding: "utf8",
                windowsHide: true,
            },
        );
        if (result.error) {
            throw result.error;
        }
        if (result.status !== 0) {
            throw new Error(`Failed to terminate the VS Code process tree: ${result.stderr}`);
        }
        return;
    }

    process.kill(-electronProcess.pid, "SIGKILL");
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
