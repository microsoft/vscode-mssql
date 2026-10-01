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
/**
 * Defense in depth on what the service is trusted to send: every scalar is
 * classified diagnostic.metadata (plain in the journal, forwarded to the
 * harness wire), so the bound on shape lives here, not only in the emitter.
 */
const MAX_FIELDS = 32;
const MAX_FIELD_CHARS = 256;
const MAX_KEY_CHARS = 64;
const MAX_TYPE_CHARS = 128;
/** Feature buckets the STS emitter is contracted to use (StsDiag.cs callers). */
const STS_FEATURES: ReadonlySet<string> = new Set([
    "rpc",
    "sqlDriver",
    "objectExplorer",
    "connection",
    "query",
    "system",
]);

/** True while the loopback listener is accepting STS batches. */
export function isStsDiagListenerActive(): boolean {
    return server !== undefined;
}

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
    if (
        typeof event.type !== "string" ||
        typeof event.epochMs !== "number" ||
        !Number.isFinite(event.epochMs)
    ) {
        return;
    }
    const fields: Record<string, { raw: unknown; cls: DataClassification }> = {};
    let truncated = 0;
    let dropped = 0;
    for (const [rawKey, value] of Object.entries(event.fields ?? {})) {
        if (Object.keys(fields).length >= MAX_FIELDS) {
            dropped++;
            continue;
        }
        const key = rawKey.slice(0, MAX_KEY_CHARS);
        if (typeof value === "string") {
            // STS emitter contract: protocol metadata only (methods, counts,
            // durations, type names) — bounded here regardless.
            if (value.length > MAX_FIELD_CHARS) {
                truncated++;
                fields[key] = { raw: value.slice(0, MAX_FIELD_CHARS), cls: "diagnostic.metadata" };
            } else {
                fields[key] = { raw: value, cls: "diagnostic.metadata" };
            }
        } else if (
            (typeof value === "number" && Number.isFinite(value)) ||
            typeof value === "boolean" ||
            value === null
        ) {
            fields[key] = { raw: value, cls: "diagnostic.metadata" };
        }
    }
    if (truncated > 0) {
        fields["stsDiag.truncatedFields"] = { raw: truncated, cls: "diagnostic.metadata" };
    }
    if (dropped > 0) {
        fields["stsDiag.droppedFields"] = { raw: dropped, cls: "diagnostic.metadata" };
    }
    const startEpochMs =
        typeof event.startEpochMs === "number" && Number.isFinite(event.startEpochMs)
            ? event.startEpochMs
            : event.epochMs;
    const durationMs =
        typeof event.durationMs === "number" && Number.isFinite(event.durationMs)
            ? event.durationMs
            : undefined;
    diag.emit({
        // Unknown feature buckets collapse to "sts" instead of minting
        // arbitrary feature names from the wire.
        feature:
            typeof event.feature === "string" && STS_FEATURES.has(event.feature)
                ? event.feature
                : "sts",
        kind: event.kind === "span" ? "span" : "event",
        type: event.type.slice(0, MAX_TYPE_CHARS),
        status: event.status === "error" ? "error" : event.status === "warning" ? "warning" : "ok",
        process: "sqlToolsService",
        ...(typeof event.pid === "number" && Number.isFinite(event.pid) ? { pid: event.pid } : {}),
        // Anchor at span START so waterfall placement is correct; duration
        // carries the extent. (Analysis treats own-duration events as bars.)
        epochMs: startEpochMs,
        ...(durationMs !== undefined ? { durationMs } : {}),
        timingClass: "epochAlignedDiagnostic",
        ...(Object.keys(fields).length > 0 ? { fields } : {}),
        tags: ["stsDiag"],
    });
}
