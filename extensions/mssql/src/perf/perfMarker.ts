/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Gated, dependency-free performance marker helper.
 */

import * as http from "node:http";

type AttrValue = string | number | boolean | null;
type Phase = "instant" | "begin" | "end" | "counter";

interface PerfConfig {
    url: URL;
    token: string;
    runId: string;
    repId: number;
    scenarioId: string;
}

function readConfig(): PerfConfig | undefined {
    if (process.env.PERF_MODE !== "1") {
        return undefined;
    }
    const markerUrl = process.env.PERF_MARKER_URL;
    if (!markerUrl) {
        return undefined;
    }
    try {
        return {
            url: new URL(markerUrl),
            token: process.env.PERF_CONTROL_TOKEN ?? "",
            runId: process.env.PERF_RUN_ID ?? "unknown",
            repId: Number(process.env.PERF_REP_ID ?? "0"),
            scenarioId: process.env.PERF_SCENARIO_ID ?? "unknown",
        };
    } catch {
        return undefined;
    }
}

const CONFIG = readConfig();
const ENABLED = CONFIG !== undefined;

function nowNs(): string {
    return (BigInt(Date.now()) * 1_000_000n).toString();
}

function monotonicNs(): string {
    return process.hrtime.bigint().toString();
}

function post(marker: Record<string, unknown>): void {
    if (!CONFIG) {
        return;
    }
    try {
        const payload = Buffer.from(JSON.stringify(marker), "utf8");
        const req = http.request({
            host: CONFIG.url.hostname,
            port: Number(CONFIG.url.port),
            path: CONFIG.url.pathname,
            method: "POST",
            headers: {
                "content-type": "application/json",
                "content-length": String(payload.length),
                "x-perf-token": CONFIG.token,
            },
        });
        // Fire-and-forget: markers must never block or crash the product.
        req.on("error", () => {});
        req.write(payload);
        req.end();
    } catch {
        /* swallow — instrumentation is best-effort */
    }
}

function emit(
    name: string,
    phase: Phase,
    attrs?: Record<string, AttrValue>,
    correlationId?: string,
): void {
    if (!CONFIG) {
        return;
    }
    post({
        schemaVersion: 1,
        runId: CONFIG.runId,
        repId: CONFIG.repId,
        scenarioId: CONFIG.scenarioId,
        name,
        phase,
        correlationId,
        timestampUnixNs: nowNs(),
        monotonicNs: monotonicNs(),
        process: { role: "product", pid: process.pid, name: "mssql" },
        attrs,
    });
}

export const perfMark = {
    /** True only when the perf harness launched this process. */
    enabled: ENABLED,

    begin(name: string, attrs?: Record<string, AttrValue>, correlationId?: string): void {
        emit(name, "begin", attrs, correlationId);
    },

    end(name: string, attrs?: Record<string, AttrValue>, correlationId?: string): void {
        emit(name, "end", attrs, correlationId);
    },

    instant(name: string, attrs?: Record<string, AttrValue>, correlationId?: string): void {
        emit(name, "instant", attrs, correlationId);
    },

    /** Time an async block: emits `<name>` begin/end around `fn`. */
    async span<T>(
        name: string,
        fn: () => Promise<T>,
        attrs?: Record<string, AttrValue>,
    ): Promise<T> {
        emit(name, "begin", attrs);
        try {
            return await fn();
        } finally {
            emit(name, "end");
        }
    },
};
