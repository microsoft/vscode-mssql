/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Frame, Page, test, TestInfo } from "@playwright/test";
import * as fs from "fs";
import {
    addDatabaseConnection,
    enterTextIntoQueryEditor,
    executeQuery,
    openNewQueryEditor,
} from "../e2e/utils/testHelpers";
import {
    getAuthenticationType,
    getDatabaseName,
    getPassword,
    getProfileName,
    getSavePassword,
    getServerName,
    getUserName,
} from "../e2e/utils/envConfigReader";
import {
    cleanupDirectories,
    DEFAULT_USER_CONFIG,
    launchVsCodeWithMssqlExtension,
} from "../e2e/utils/launchVscodeWithMsSqlExt";

type GridKind = "legacy" | "beta";

type PerfEvent = {
    name: string;
    gridKind: GridKind;
    gridId: string;
    batchId: number;
    resultId: number;
    startTime: number;
    timestamp: number;
    duration?: number;
    metadata?: Record<string, string | number | boolean | null | undefined>;
};

type PerfSnapshot = {
    enabled: boolean;
    events: PerfEvent[];
};

type QuickInputSummary = {
    visible: boolean;
    value?: string;
    placeholder?: string;
    title?: string;
    items: string[];
};

type QueryResultFrameMarker = {
    url: string;
    name: string;
    title?: string;
    hasPerfCollector: boolean;
    hasSlickViewport: boolean;
    hasQueryResultText: boolean;
};

type BenchmarkScenario = {
    name: string;
    rows: number;
    columns: number;
    query: string;
    waitForText: string;
    verticalScroll?: boolean;
    horizontalScroll?: boolean;
};

type ScrollSummary = {
    maxScrollTop?: number;
    maxScrollLeft?: number;
    finalScrollTop?: number;
    finalScrollLeft?: number;
    frameCount: number;
    p50FrameMs: number;
    p95FrameMs: number;
    maxFrameMs: number;
    droppedFramePercent: number;
};

type DurationSummary = {
    count: number;
    minMs?: number;
    avgMs?: number;
    p50Ms?: number;
    p95Ms?: number;
    maxMs?: number;
};

type ScenarioReport = {
    gridKind: GridKind;
    scenario: Omit<BenchmarkScenario, "query">;
    startedAt: string;
    completedAt: string;
    perf: PerfSnapshot;
    summary: {
        getRows: DurationSummary;
        mountFirstPaint: DurationSummary;
        firstDataPaint: DurationSummary;
        rowCountChangePaint: DurationSummary;
        getRowsResponsePaint: DurationSummary;
        getRowsCallCount: number;
        fetchedRows: number;
        rowCountChangeCount: number;
    };
    scroll?: {
        vertical?: ScrollSummary;
        horizontal?: ScrollSummary;
    };
};

const defaultScenarioNames = ["small", "vertical", "wide", "heavy", "streaming"];
const scrollSteps = getNumberFromEnv("MSSQL_GRID_PERF_SCROLL_STEPS", 80);
const scrollDurationMs = getNumberFromEnv("MSSQL_GRID_PERF_SCROLL_DURATION_MS", 4000);

test.describe.serial("Query result grid benchmark", () => {
    test.skip(!getServerName(), "SERVER_NAME must be set to run MSSQL grid benchmarks.");

    for (const gridKind of ["legacy", "beta"] as GridKind[]) {
        test(`${gridKind} grid scenarios`, async ({}, testInfo) => {
            const context = await launchVsCodeWithMssqlExtension({
                useTempProfile: false,
                initialConfig: {
                    ...DEFAULT_USER_CONFIG,
                    "mssql.dev.gridPerfTelemetry": true,
                    "mssql.preview.betaResultsGrid": gridKind === "beta",
                    "mssql.openQueryResultsInTabByDefault": false,
                    "mssql.openQueryResultsInTabByDefaultDoNotShowPrompt": true,
                    "mssql.resultsGrid.autoSizeColumnsMode": "headersAndData",
                },
            });

            const reports: ScenarioReport[] = [];
            try {
                await addDatabaseConnection(
                    context.page,
                    getServerName(),
                    getDatabaseName(),
                    getAuthenticationType(),
                    getUserName(),
                    getPassword(),
                    getSavePassword(),
                    getProfileName(),
                );

                for (const scenario of getSelectedScenarios()) {
                    reports.push(await runScenario(context.page, gridKind, scenario, testInfo));
                }
            } finally {
                await context.electronApp.close().catch(() => undefined);
                await cleanupDirectories(
                    context.userDataDir,
                    context.extensionsDir,
                    context.videoDir,
                );
            }

            const summaryPath = testInfo.outputPath(`grid-perf-${gridKind}-summary.json`);
            await fs.promises.writeFile(summaryPath, JSON.stringify(reports, undefined, 2));
            testInfo.attachments.push({
                name: `grid-perf-${gridKind}-summary.json`,
                path: summaryPath,
                contentType: "application/json",
            });
        });
    }
});

async function runScenario(
    page: Page,
    gridKind: GridKind,
    scenario: BenchmarkScenario,
    testInfo: TestInfo,
): Promise<ScenarioReport> {
    await openNewQueryEditor(page);
    await selectConnectionForNewQueryIfPrompted(page, 15_000);
    await enterTextIntoQueryEditor(page, scenario.query);

    const existingQueryResultFrame = await tryGetQueryResultWebview(page, 2_000);
    if (existingQueryResultFrame) {
        await clearPerfEvents(existingQueryResultFrame);
    }

    const startedAt = new Date().toISOString();
    await executeQuery(page);
    await selectConnectionForNewQueryIfPrompted(page, 5_000);

    const queryResultFrame = await getQueryResultWebview(page, testInfo);
    await queryResultFrame.locator(".slick-viewport").first().waitFor({
        state: "visible",
        timeout: 180_000,
    });
    await expect(queryResultFrame.getByText(scenario.waitForText).first()).toBeVisible({
        timeout: 180_000,
    });

    const scroll: ScenarioReport["scroll"] = {};
    if (scenario.verticalScroll) {
        scroll.vertical = await driveVerticalScroll(queryResultFrame);
    }
    if (scenario.horizontalScroll) {
        scroll.horizontal = await driveHorizontalScroll(queryResultFrame);
    }

    await waitForQuietPerfWindow(queryResultFrame);
    const perf = await getPerfSnapshot(queryResultFrame);
    const report: ScenarioReport = {
        gridKind,
        scenario: {
            name: scenario.name,
            rows: scenario.rows,
            columns: scenario.columns,
            waitForText: scenario.waitForText,
            verticalScroll: scenario.verticalScroll,
            horizontalScroll: scenario.horizontalScroll,
        },
        startedAt,
        completedAt: new Date().toISOString(),
        perf,
        summary: summarizePerf(perf.events),
        scroll,
    };

    const reportPath = testInfo.outputPath(`grid-perf-${gridKind}-${scenario.name}.json`);
    await fs.promises.writeFile(reportPath, JSON.stringify(report, undefined, 2));
    testInfo.attachments.push({
        name: `grid-perf-${gridKind}-${scenario.name}.json`,
        path: reportPath,
        contentType: "application/json",
    });

    return report;
}

async function getQueryResultWebview(page: Page, testInfo: TestInfo): Promise<Frame> {
    const frame = await tryGetQueryResultWebview(page, 60_000);
    if (frame) {
        return frame;
    }

    const diagnostics = await describeVsCodeState(page);
    const diagnosticsPath = testInfo.outputPath("query-result-webview-timeout.json");
    await fs.promises.writeFile(diagnosticsPath, diagnostics);
    testInfo.attachments.push({
        name: "query-result-webview-timeout.json",
        path: diagnosticsPath,
        contentType: "application/json",
    });

    const screenshotPath = testInfo.outputPath("query-result-webview-timeout.png");
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    if (fs.existsSync(screenshotPath)) {
        testInfo.attachments.push({
            name: "query-result-webview-timeout.png",
            path: screenshotPath,
            contentType: "image/png",
        });
    }

    throw new Error(`Query result webview was not found.\n${diagnostics}`);
}

async function selectConnectionForNewQueryIfPrompted(
    page: Page,
    timeoutMs: number,
): Promise<boolean> {
    const quickInput = page.locator('input[aria-controls="quickInput_list"]');
    const deadline = Date.now() + timeoutMs;
    let summary = await getQuickInputSummary(page);
    while (Date.now() < deadline && !isConnectionQuickInput(summary)) {
        await page.waitForTimeout(250);
        summary = await getQuickInputSummary(page);
    }

    if (!isConnectionQuickInput(summary)) {
        return false;
    }

    const profileName = getProfileName();
    if (profileName) {
        await quickInput.fill(profileName);
        await page.waitForTimeout(250);
    }

    await page.keyboard.press("Enter");
    await expect(quickInput).toBeHidden({ timeout: 30_000 });
    await page.locator('div[class="view-lines monaco-mouse-cursor-text"]').first().waitFor({
        state: "visible",
        timeout: 30_000,
    });
    return true;
}

async function tryGetQueryResultWebview(page: Page, timeoutMs: number): Promise<Frame | undefined> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        for (const frame of page.frames()) {
            const marker = await getQueryResultFrameMarker(frame);
            if (isQueryResultFrame(marker)) {
                return frame;
            }
        }

        await page.waitForTimeout(250);
    }

    return undefined;
}

async function getQuickInputSummary(page: Page): Promise<QuickInputSummary> {
    const quickInput = page.locator('input[aria-controls="quickInput_list"]');
    const visible = await quickInput.isVisible().catch(() => false);
    if (!visible) {
        return { visible: false, items: [] };
    }

    const [value, placeholder, title, items] = await Promise.all([
        quickInput.inputValue({ timeout: 100 }).catch(() => undefined),
        quickInput.getAttribute("placeholder", { timeout: 100 }).catch(() => undefined),
        page
            .locator(".quick-input-title")
            .first()
            .textContent({ timeout: 100 })
            .catch(() => undefined),
        page
            .locator(".quick-input-widget .monaco-list-row")
            .evaluateAll((elements) =>
                elements
                    .slice(0, 10)
                    .map((element) => (element as HTMLElement).innerText.trim())
                    .filter((text) => text.length > 0),
            )
            .catch(() => []),
    ]);

    return {
        visible,
        value,
        placeholder: placeholder ?? undefined,
        title: title?.trim(),
        items,
    };
}

function isConnectionQuickInput(summary: QuickInputSummary): boolean {
    if (!summary.visible) {
        return false;
    }

    const value = summary.value?.trim() ?? "";
    if (value.startsWith(">")) {
        return false;
    }

    const profileName = getProfileName()?.toLowerCase();
    const haystack = [summary.value, summary.placeholder, summary.title, ...summary.items]
        .filter((text): text is string => !!text)
        .join("\n")
        .toLowerCase();

    return (
        haystack.includes("connection") ||
        haystack.includes("profile") ||
        haystack.includes("server") ||
        (!!profileName && haystack.includes(profileName))
    );
}

async function getQueryResultFrameMarker(frame: Frame): Promise<QueryResultFrameMarker> {
    const fallback: QueryResultFrameMarker = {
        url: truncate(frame.url(), 240),
        name: frame.name(),
        hasPerfCollector: false,
        hasSlickViewport: false,
        hasQueryResultText: false,
    };

    if (frame.isDetached()) {
        return fallback;
    }

    return frame
        .evaluate(() => {
            const bodyText = document.body?.innerText?.toLowerCase() ?? "";
            return {
                title: document.title,
                hasPerfCollector: Boolean((window as any).__mssqlGridPerf),
                hasSlickViewport: Boolean(document.querySelector(".slick-viewport")),
                hasQueryResultText:
                    bodyText.includes("results") ||
                    bodyText.includes("messages") ||
                    bodyText.includes("executing query"),
            };
        })
        .then((marker) => ({
            ...fallback,
            title: marker.title,
            hasPerfCollector: marker.hasPerfCollector,
            hasSlickViewport: marker.hasSlickViewport,
            hasQueryResultText: marker.hasQueryResultText,
        }))
        .catch(() => fallback);
}

function isQueryResultFrame(marker: QueryResultFrameMarker): boolean {
    return (
        marker.hasPerfCollector ||
        marker.hasSlickViewport ||
        (marker.url.startsWith("vscode-webview://") && marker.hasQueryResultText) ||
        marker.title === "queryResult" ||
        marker.url.includes("queryResult")
    );
}

async function describeVsCodeState(page: Page): Promise<string> {
    const [quickInput, tabs] = await Promise.all([
        getQuickInputSummary(page),
        page
            .locator('[role="tab"]')
            .evaluateAll((elements) =>
                elements.slice(0, 20).map((element) => ({
                    label: element.getAttribute("aria-label"),
                    selected: element.getAttribute("aria-selected"),
                })),
            )
            .catch(() => []),
    ]);

    const frames: QueryResultFrameMarker[] = [];
    for (const frame of page.frames()) {
        frames.push(await getQueryResultFrameMarker(frame));
    }

    return JSON.stringify(
        {
            quickInput,
            tabs,
            frames,
        },
        undefined,
        2,
    );
}

function truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

async function clearPerfEvents(frame: Frame): Promise<void> {
    await frame.locator("body").evaluate(() => {
        (window as any).__mssqlGridPerf?.clear?.();
    });
}

async function getPerfSnapshot(frame: Frame): Promise<PerfSnapshot> {
    return frame.locator("body").evaluate(() => {
        return (
            (window as any).__mssqlGridPerf?.snapshot?.() ?? {
                enabled: false,
                events: [],
            }
        );
    });
}

async function waitForQuietPerfWindow(frame: Frame): Promise<void> {
    await frame.locator("body").evaluate(
        (_body, quietMs) =>
            new Promise<void>((resolve) => {
                window.setTimeout(resolve, quietMs);
            }),
        750,
    );
}

async function driveVerticalScroll(frame: Frame): Promise<ScrollSummary> {
    return frame.locator("body").evaluate(
        async (_body, { steps, durationMs }) => {
            const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
            const percentile = (sortedValues: number[], percentileValue: number) => {
                const index = Math.min(
                    sortedValues.length - 1,
                    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
                );
                return sortedValues[index] ?? 0;
            };
            const getBestViewport = () => {
                const viewports = Array.from(
                    document.querySelectorAll<HTMLElement>(".slick-viewport"),
                );
                if (viewports.length === 0) {
                    throw new Error("No SlickGrid viewport found.");
                }

                return viewports.sort(
                    (left, right) =>
                        right.scrollHeight -
                        right.clientHeight -
                        (left.scrollHeight - left.clientHeight),
                )[0];
            };
            const startFrameSampler = () => {
                const frameGaps: number[] = [];
                let running = true;
                let lastFrameTime = performance.now();
                const tick = (timestamp: number) => {
                    frameGaps.push(timestamp - lastFrameTime);
                    lastFrameTime = timestamp;
                    if (running) {
                        requestAnimationFrame(tick);
                    }
                };
                requestAnimationFrame(tick);

                return {
                    stop: () => {
                        running = false;
                        const sorted = frameGaps
                            .filter((gap) => Number.isFinite(gap))
                            .sort((left, right) => left - right);
                        const maxFrameMs = sorted[sorted.length - 1] ?? 0;
                        return {
                            frameCount: sorted.length,
                            p50FrameMs: percentile(sorted, 0.5),
                            p95FrameMs: percentile(sorted, 0.95),
                            maxFrameMs,
                            droppedFramePercent:
                                sorted.length === 0
                                    ? 0
                                    : (sorted.filter((gap) => gap > 20).length / sorted.length) *
                                      100,
                        };
                    },
                };
            };

            const viewport = getBestViewport();
            const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
            const frames = startFrameSampler();
            const stepDelay = durationMs / Math.max(1, steps);

            for (let step = 0; step <= steps; step++) {
                viewport.scrollTop = Math.round((maxScrollTop * step) / steps);
                viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
                await delay(stepDelay);
            }

            await delay(500);
            const summary = frames.stop();
            return {
                ...summary,
                maxScrollTop,
                finalScrollTop: viewport.scrollTop,
            };
        },
        { steps: scrollSteps, durationMs: scrollDurationMs },
    );
}

async function driveHorizontalScroll(frame: Frame): Promise<ScrollSummary> {
    return frame.locator("body").evaluate(
        async (_body, { steps, durationMs }) => {
            const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
            const percentile = (sortedValues: number[], percentileValue: number) => {
                const index = Math.min(
                    sortedValues.length - 1,
                    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
                );
                return sortedValues[index] ?? 0;
            };
            const getBestViewport = () => {
                const viewports = Array.from(
                    document.querySelectorAll<HTMLElement>(".slick-viewport"),
                );
                if (viewports.length === 0) {
                    throw new Error("No SlickGrid viewport found.");
                }

                return viewports.sort(
                    (left, right) =>
                        right.scrollWidth -
                        right.clientWidth -
                        (left.scrollWidth - left.clientWidth),
                )[0];
            };
            const startFrameSampler = () => {
                const frameGaps: number[] = [];
                let running = true;
                let lastFrameTime = performance.now();
                const tick = (timestamp: number) => {
                    frameGaps.push(timestamp - lastFrameTime);
                    lastFrameTime = timestamp;
                    if (running) {
                        requestAnimationFrame(tick);
                    }
                };
                requestAnimationFrame(tick);

                return {
                    stop: () => {
                        running = false;
                        const sorted = frameGaps
                            .filter((gap) => Number.isFinite(gap))
                            .sort((left, right) => left - right);
                        const maxFrameMs = sorted[sorted.length - 1] ?? 0;
                        return {
                            frameCount: sorted.length,
                            p50FrameMs: percentile(sorted, 0.5),
                            p95FrameMs: percentile(sorted, 0.95),
                            maxFrameMs,
                            droppedFramePercent:
                                sorted.length === 0
                                    ? 0
                                    : (sorted.filter((gap) => gap > 20).length / sorted.length) *
                                      100,
                        };
                    },
                };
            };

            const viewport = getBestViewport();
            const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
            const frames = startFrameSampler();
            const stepDelay = durationMs / Math.max(1, steps);

            for (let step = 0; step <= steps; step++) {
                viewport.scrollLeft = Math.round((maxScrollLeft * step) / steps);
                viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
                await delay(stepDelay);
            }

            await delay(500);
            const summary = frames.stop();
            return {
                ...summary,
                maxScrollLeft,
                finalScrollLeft: viewport.scrollLeft,
            };
        },
        { steps: Math.max(20, Math.floor(scrollSteps / 2)), durationMs: scrollDurationMs / 2 },
    );
}

function summarizePerf(events: PerfEvent[]): ScenarioReport["summary"] {
    const getRowsEvents = events.filter((event) => event.name === "get-rows");
    const getRowsResponsePaintEvents = events.filter(
        (event) => event.name === "get-rows-response-paint",
    );
    return {
        getRows: summarizeDurations(getRowsEvents),
        mountFirstPaint: summarizeDurations(
            events.filter((event) => event.name === "mount-first-paint"),
        ),
        firstDataPaint: summarizeDurations(
            events.filter((event) => event.name === "first-data-paint"),
        ),
        rowCountChangePaint: summarizeDurations(
            events.filter((event) => event.name === "row-count-change-paint"),
        ),
        getRowsResponsePaint: summarizeDurations(getRowsResponsePaintEvents),
        getRowsCallCount: getRowsEvents.length,
        fetchedRows: getRowsResponsePaintEvents.reduce(
            (sum, event) => sum + getNumericMetadata(event, "returnedRows"),
            0,
        ),
        rowCountChangeCount: events.filter((event) => event.name === "row-count-change").length,
    };
}

function summarizeDurations(events: PerfEvent[]): DurationSummary {
    const durations = events
        .map((event) => event.duration)
        .filter((duration): duration is number => typeof duration === "number")
        .sort((left, right) => left - right);

    if (durations.length === 0) {
        return { count: 0 };
    }

    return {
        count: durations.length,
        minMs: durations[0],
        avgMs: durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        maxMs: durations[durations.length - 1],
    };
}

function percentile(sortedValues: number[], percentileValue: number): number {
    const index = Math.min(
        sortedValues.length - 1,
        Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
    );
    return sortedValues[index];
}

function getNumericMetadata(event: PerfEvent, key: string): number {
    const value = event.metadata?.[key];
    return typeof value === "number" ? value : 0;
}

function getSelectedScenarios(): BenchmarkScenario[] {
    const selectedNames = (
        process.env.MSSQL_GRID_PERF_SCENARIOS?.split(",") ?? defaultScenarioNames
    ).map((name) => name.trim().toLowerCase());
    const catalog = createScenarioCatalog();
    const unknown = selectedNames.filter((name) => !catalog.has(name));
    if (unknown.length > 0) {
        throw new Error(`Unknown MSSQL_GRID_PERF_SCENARIOS values: ${unknown.join(", ")}`);
    }

    return selectedNames.map((name) => catalog.get(name)!);
}

function createScenarioCatalog(): Map<string, BenchmarkScenario> {
    const verticalRows = getNumberFromEnv("MSSQL_GRID_PERF_VERTICAL_ROWS", 100000);
    const streamingRows = getNumberFromEnv("MSSQL_GRID_PERF_STREAMING_ROWS", 200000);
    const wideColumns = getNumberFromEnv("MSSQL_GRID_PERF_WIDE_COLUMNS", 80);

    const scenarios: BenchmarkScenario[] = [
        {
            name: "small",
            rows: 1000,
            columns: 10,
            query: createGeneratedSelectQuery({ rows: 1000, columns: 10 }),
            waitForText: "row-1",
            verticalScroll: true,
        },
        {
            name: "vertical",
            rows: verticalRows,
            columns: 12,
            query: createGeneratedSelectQuery({ rows: verticalRows, columns: 12 }),
            waitForText: "row-1",
            verticalScroll: true,
        },
        {
            name: "wide",
            rows: 10000,
            columns: wideColumns,
            query: createGeneratedSelectQuery({ rows: 10000, columns: wideColumns }),
            waitForText: "row-1",
            verticalScroll: true,
            horizontalScroll: true,
        },
        {
            name: "heavy",
            rows: 25000,
            columns: 20,
            query: createGeneratedSelectQuery({ rows: 25000, columns: 20, heavyCells: true }),
            waitForText: "row-1",
            verticalScroll: true,
            horizontalScroll: true,
        },
        {
            name: "streaming",
            rows: streamingRows,
            columns: 8,
            query: createGeneratedSelectQuery({ rows: streamingRows, columns: 8 }),
            waitForText: "row-1",
            verticalScroll: true,
        },
        {
            name: "multi",
            rows: 12000,
            columns: 12,
            query: [
                createGeneratedSelectQuery({ rows: 2000, columns: 8 }),
                createGeneratedSelectQuery({ rows: 10000, columns: 12, omitNoCount: true }),
            ].join("\n"),
            waitForText: "row-1",
            verticalScroll: true,
        },
    ];

    return new Map(scenarios.map((scenario) => [scenario.name, scenario]));
}

function createGeneratedSelectQuery({
    rows,
    columns,
    heavyCells = false,
    omitNoCount = false,
}: {
    rows: number;
    columns: number;
    heavyCells?: boolean;
    omitNoCount?: boolean;
}): string {
    const expressions: string[] = [];
    for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
        expressions.push(createColumnExpression(columnIndex, heavyCells));
    }

    return `
${omitNoCount ? "" : "SET NOCOUNT ON;"}
WITH src AS (
    SELECT TOP (${rows})
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
    FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS d0(n)
    CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS d1(n)
    CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS d2(n)
    CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS d3(n)
    CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS d4(n)
    CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS d5(n)
    CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS d6(n)
)
SELECT
    ${expressions.join(",\n    ")}
FROM src
ORDER BY n
OPTION (MAXDOP 1);`;
}

function createColumnExpression(columnIndex: number, heavyCells: boolean): string {
    if (columnIndex === 0) {
        return "n AS [id]";
    }
    if (columnIndex === 1) {
        return "CONCAT('row-', n) AS [label]";
    }

    if (heavyCells && columnIndex % 5 === 0) {
        return `CONCAT('{"row":', n, ',"column":${columnIndex},"payload":"', REPLICATE('x', 80), '"}') AS [json_${columnIndex}]`;
    }
    if (heavyCells && columnIndex % 5 === 1) {
        return `CONCAT('<row id="', n, '"><value>', REPLICATE('x', 80), '</value></row>') AS [xml_${columnIndex}]`;
    }
    if (heavyCells && columnIndex % 5 === 2) {
        return `CASE WHEN n % 11 = 0 THEN NULL ELSE CONCAT('nullable-', n, '-${columnIndex}') END AS [nullable_${columnIndex}]`;
    }
    if (heavyCells && columnIndex % 5 === 3) {
        return `REPLICATE(CONVERT(varchar(10), n % 10), 120) AS [long_text_${columnIndex}]`;
    }

    if (columnIndex % 3 === 0) {
        return `(n * ${columnIndex + 3}) % 100000 AS [metric_${columnIndex}]`;
    }
    if (columnIndex % 3 === 1) {
        return `CONCAT('value-', n, '-${columnIndex}') AS [text_${columnIndex}]`;
    }
    return `CONVERT(decimal(18, 4), n) / ${columnIndex + 1} AS [decimal_${columnIndex}]`;
}

function getNumberFromEnv(name: string, fallback: number): number {
    const rawValue = process.env[name];
    if (!rawValue) {
        return fallback;
    }

    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
