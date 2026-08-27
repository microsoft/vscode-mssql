/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Loopback listener for SQL Tools Service diagnostics. The extension starts
 * this before STS spawns and passes STS_DIAG_URL/STS_DIAG_TOKEN via the
 * inherited environment; StsDiag on the service side batches NDJSON events
 * here. Events flow into the diagnostics core (which drops them when no sink
 * is active), giving the Debug Console live dispatcher/SqlCommand/SMO spans.
 *
 * The STS emitter never sends SQL text, object names, or row values — fields
 * arrive as protocol metadata and are classified as such.
 */

import * as crypto from "crypto";
import * as http from "http";
import { DataClassification } from "../sharedInterfaces/debugConsole";
import { diag } from "./diagnosticsCore";

interface StsDiagWireEvent {
    type: string;
    feature: string;
    kind: "span" | "event";
    status?: string;
    epochMs: number;
    startEpochMs?: number;
    durationMs?: number;
    pid?: number;
    fields?: Record<string, unknown>;
}

let server: http.Server | undefined;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function startStsDiagListener(): Promise<void> {
    if (server) {
        return;
    }
    const token = crypto.randomBytes(16).toString("hex");
    const candidate = http.createServer((request, response) => {
        if (request.method !== "POST" || request.headers.authorization !== `Bearer ${token}`) {
            response.statusCode = 403;
            response.end();
            return;
        }
        let body = "";
        let bodyBytes = 0;
        let tooLarge = false;
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
            if (tooLarge) {
                return;
            }
            bodyBytes += Buffer.byteLength(chunk, "utf8");
            if (bodyBytes > MAX_BODY_BYTES) {
                tooLarge = true;
                body = "";
                return;
            }
            body += chunk;
        });
        request.on("end", () => {
            if (tooLarge) {
                response.statusCode = 413;
                response.end();
                return;
            }
            response.statusCode = 200;
            response.end();
            if (!diag.anySinkActive) {
                return; // console closed and capture off: discard cheaply
            }
            for (const line of body.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) {
                    continue;
                }
                try {
                    ingest(JSON.parse(trimmed) as StsDiagWireEvent);
                } catch {
                    // tolerate malformed lines
                }
            }
        });
        request.on("error", () => {
            /* never propagate */
        });
    });
    server = candidate;
    const listening = await new Promise<boolean>((resolve) => {
        candidate.once("error", () => resolve(false));
        candidate.listen(0, "127.0.0.1", () => resolve(true));
    });
    if (!listening) {
        if (server === candidate) {
            server = undefined;
        }
        return;
    }
    const address = candidate.address();
    if (address && typeof address === "object") {
        process.env["STS_DIAG_URL"] = `http://127.0.0.1:${address.port}/`;
        process.env["STS_DIAG_TOKEN"] = token;
    }
    candidate.unref();
}

export function stopStsDiagListener(): void {
    server?.close();
    server = undefined;
    delete process.env["STS_DIAG_URL"];
    delete process.env["STS_DIAG_TOKEN"];
}

function ingest(event: StsDiagWireEvent): void {
    if (typeof event.type !== "string" || typeof event.epochMs !== "number") {
        return;
    }
    const fields: Record<string, { raw: unknown; cls: DataClassification }> = {};
    for (const [key, value] of Object.entries(event.fields ?? {})) {
        if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean" ||
            value === null
        ) {
            // STS emitter contract: protocol metadata only (methods, counts,
            // durations, type names) — classified accordingly.
            fields[key] = { raw: value, cls: "diagnostic.metadata" };
        }
    }
    diag.emit({
        feature: event.feature === "sqlDriver" ? "sqlDriver" : (event.feature ?? "rpc"),
        kind: event.kind === "span" ? "span" : "event",
        type: event.type,
        status: event.status === "error" ? "error" : event.status === "warning" ? "warning" : "ok",
        process: "sqlToolsService",
        ...(event.pid !== undefined ? { pid: event.pid } : {}),
        // Anchor at span START so waterfall placement is correct; duration
        // carries the extent. (Analysis treats own-duration events as bars.)
        epochMs: event.startEpochMs ?? event.epochMs,
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        timingClass: "epochAlignedDiagnostic",
        ...(Object.keys(fields).length > 0 ? { fields } : {}),
        tags: ["stsDiag"],
    });
}
