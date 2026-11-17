/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page, TestInfo } from "@playwright/test";
import * as cp from "child_process";
import { test } from "../baseFixtures";
import {
    cleanupDirectories,
    launchVsCodeWithMssqlExtension,
    mssqlExtensionLaunchConfig,
    VsCodeAppHandle,
} from "./launchVscodeWithMsSqlExt";
import { FailureArtifactRecorder } from "./failureArtifacts";
import { screenshotOnFailure } from "./screenshotUtils";

/** Budget for launching VS Code and staging a query; see the beforeAll hook below. */
const STAGING_TIMEOUT_MS = 5 * 60 * 1000;

export type VsCodeLaunchContext = {
    electronApp: VsCodeAppHandle;
    page: Page;
    userDataDir: string;
    extensionsDir: string;
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

const ELECTRON_CLOSE_TIMEOUT_MS = 30_000;
const ELECTRON_KILL_TIMEOUT_MS = 10_000;

export function useSharedVsCodeLifecycle(
    hooks: SharedLifecycleHooks = {},
): () => VsCodeLaunchContext {
    let context: VsCodeLaunchContext | undefined;
    let recorder: FailureArtifactRecorder | undefined;

    const getContext = (): VsCodeLaunchContext => {
        if (!context) {
            throw new Error("VS Code test context not initialized.");
        }
        return context;
    };

    test.beforeAll(async () => {
        // A hook's timeout defaults to the project's per-test timeout, which is sized for a single
        // grid interaction. This one launches VS Code and then stages a query, and
        // executeQueryAndWait alone allows two minutes -- so without its own budget the hook dies
        // at the test timeout before the wait it contains can even expire, taking the whole file
        // with it. Set here rather than by raising the project timeout, which would also stop
        // every ordinary test from failing fast.
        test.setTimeout(STAGING_TIMEOUT_MS);
        context = await launchVsCodeWithMssqlExtension(hooks.launchOptions);
        await hooks.afterLaunch?.(context);
    });

    test.beforeEach(async ({}, testInfo) => {
        if (!context) {
            return;
        }
        recorder = await FailureArtifactRecorder.start(context.electronApp, context.page, testInfo);
    });

    test.afterEach(async ({}, testInfo) => {
        if (!context) {
            return;
        }
        const currentContext = getContext();
        await screenshotOnFailure(currentContext.page, testInfo);
        await recorder?.finish(testInfo);
        recorder = undefined;
        await hooks.afterEach?.(currentContext, testInfo);
    });

    test.afterAll(async () => {
        if (!context) {
            return;
        }
        const currentContext = getContext();
        await hooks.beforeClose?.(currentContext);
        await closeElectronApp(currentContext.electronApp);
        // Each launch copies the extensions into its own profile, so leaving these behind costs
        // well over 100 MB per file and fills the disk over a full run.
        await cleanupDirectories(currentContext.userDataDir, currentContext.extensionsDir);
    });

    return getContext;
}

export function usePerTestVsCodeLifecycle(
    hooks: PerTestLifecycleHooks = {},
): () => VsCodeLaunchContext {
    let context: VsCodeLaunchContext | undefined;
    let recorder: FailureArtifactRecorder | undefined;

    const getContext = (): VsCodeLaunchContext => {
        if (!context) {
            throw new Error("VS Code test context not initialized.");
        }
        return context;
    };

    test.beforeEach(async ({}, testInfo) => {
        context = await launchVsCodeWithMssqlExtension(hooks.launchOptions);
        // Started before afterLaunch so the clip and trace also cover any per-test setup.
        recorder = await FailureArtifactRecorder.start(context.electronApp, context.page, testInfo);
        await hooks.afterLaunch?.(context);
    });

    test.afterEach(async ({}, testInfo) => {
        if (!context) {
            return;
        }
        const currentContext = getContext();

        await screenshotOnFailure(currentContext.page, testInfo);
        await recorder?.finish(testInfo);
        recorder = undefined;
        await hooks.beforeClose?.(currentContext, testInfo);
        await closeElectronApp(currentContext.electronApp);
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
    const hasExited = () =>
        electronProcess.exitCode !== null || electronProcess.signalCode !== null;
    if (hasExited()) {
        return;
    }
    const processExit = new Promise<void>((resolve) => {
        electronProcess.once("close", () => resolve());
    });
    killProcessTree(electronProcess);
    if (hasExited()) {
        return;
    }

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

    try {
        process.kill(-electronProcess.pid, "SIGKILL");
    } catch (error) {
        // VS Code can finish exiting between the close timeout and the kill; that is a success.
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
            throw error;
        }
    }
}
