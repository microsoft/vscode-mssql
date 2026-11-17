/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page, TestInfo } from "@playwright/test";
import * as fs from "fs";
import type { VsCodeAppHandle } from "./launchVscodeWithMsSqlExt";
import { hasTestFailure, toSafeFileName } from "./screenshotUtils";

/**
 * Each test attempt records its own clip with Playwright's screencast, so a kept video covers
 * only that attempt. Set ENABLE_ELECTRON_VIDEO_RECORDING=true to record; CI turns it on.
 */
const shouldRecordVideo = process.env["ENABLE_ELECTRON_VIDEO_RECORDING"] === "true";

/**
 * Traces of the Electron context, with screenshots and DOM snapshots. The config's `trace`
 * option does not reach the custom Electron launch, so they are captured here instead. On by
 * default in CI; set ENABLE_ELECTRON_TRACING to "true" or "false" to override.
 */
const shouldRecordTrace =
    (process.env["ENABLE_ELECTRON_TRACING"] ?? (process.env["CI"] ? "true" : "false")) === "true";

/** Scaled down from the 1920x1080 viewport to keep encoding cost and artifact size down. */
const VIDEO_SIZE = { width: 1280, height: 720 };

/** Electron contexts whose trace has been started; each test attempt then records a chunk. */
const tracedContexts = new WeakSet<object>();

/**
 * Records a video clip and a trace chunk for one test attempt and keeps them only when that
 * attempt fails. Passing attempts leave nothing behind.
 *
 * The video and the trace's screenshots share the page's single screencast, whose frame size is
 * fixed by whichever client starts it first. Electron has no context viewport, so a trace that
 * started first would cap frames at 800x450 and the video would pad them with gray. The trace is
 * therefore started once per launch, lazily, after the first attempt's video has started.
 */
export class FailureArtifactRecorder {
    private constructor(
        private readonly electronApp: VsCodeAppHandle,
        private readonly page: Page,
        private readonly videoPath: string | undefined,
        private readonly isTracing: boolean,
    ) {}

    /** Starts recording for the test attempt described by testInfo. */
    public static async start(
        electronApp: VsCodeAppHandle,
        page: Page,
        testInfo: TestInfo,
    ): Promise<FailureArtifactRecorder> {
        let videoPath: string | undefined;
        if (shouldRecordVideo) {
            const candidatePath = testInfo.outputPath(`${toSafeFileName(testInfo.title)}.webm`);
            const started = await runSafely("start the screencast", () =>
                page.screencast.start({ path: candidatePath, size: VIDEO_SIZE }),
            );
            videoPath = started ? candidatePath : undefined;
        }

        let isTracing = false;
        if (shouldRecordTrace) {
            const context = electronApp.context();
            isTracing = await runSafely("start a trace chunk", async () => {
                if (!tracedContexts.has(context)) {
                    await context.tracing.start({
                        screenshots: true,
                        snapshots: true,
                        sources: true,
                    });
                    tracedContexts.add(context);
                }
                await context.tracing.startChunk({ title: testInfo.titlePath.join(" › ") });
            });
        }

        return new FailureArtifactRecorder(electronApp, page, videoPath, isTracing);
    }

    /** Stops recording, attaching the artifacts if the attempt failed and discarding them if not. */
    public async finish(testInfo: TestInfo): Promise<void> {
        const failed = hasTestFailure(testInfo);

        if (this.videoPath) {
            const videoPath = this.videoPath;
            await runSafely("stop the screencast", () => this.page.screencast.stop());
            if (failed && fs.existsSync(videoPath)) {
                // Pushed rather than attach()ed, which would copy the file within the same folder.
                testInfo.attachments.push({
                    name: "video",
                    path: videoPath,
                    contentType: "video/webm",
                });
            } else {
                await fs.promises.rm(videoPath, { force: true });
            }
        }

        if (this.isTracing) {
            const tracePath = failed ? testInfo.outputPath("trace.zip") : undefined;
            const stopped = await runSafely("stop the trace chunk", () =>
                this.electronApp.context().tracing.stopChunk({ path: tracePath }),
            );
            if (stopped && tracePath && fs.existsSync(tracePath)) {
                testInfo.attachments.push({
                    name: "trace",
                    path: tracePath,
                    contentType: "application/zip",
                });
            }
        }
    }
}

/**
 * Artifact capture must never decide a test's outcome, so failures here are logged rather than
 * thrown. Returns whether the action succeeded.
 */
async function runSafely(description: string, action: () => Promise<unknown>): Promise<boolean> {
    try {
        await action();
        return true;
    } catch (error) {
        console.warn(`Could not ${description}: ${error instanceof Error ? error.message : error}`);
        return false;
    }
}
