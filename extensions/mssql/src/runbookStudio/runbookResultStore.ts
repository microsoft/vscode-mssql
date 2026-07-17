/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Typed output store (ADR-5, first slice): runtime boundary payloads become
 * opaque handles; the webview pulls bounded pages through the controller.
 * This slice is in-memory with per-run byte quotas — an evicted or lost
 * handle renders as "detail data expired", never as an empty result
 * (rendering-spec honesty rule). Disk spill + retention land with RBS2-5's
 * result-store hardening.
 */

import { DataHandleRef } from "../sharedInterfaces/runbookStudio";
import type { RuntimeOutputPayload } from "./runtime/runtimeAdapterTypes";

interface StoredOutput {
    payload: RuntimeOutputPayload;
    bytes: number;
}

const MAX_BYTES_PER_RUN = 32 * 1024 * 1024;
const MAX_PAGE_ROWS = 1000;

export class RunbookResultStore {
    private readonly outputs = new Map<string, StoredOutput>();
    private readonly runBytes = new Map<string, number>();
    private handleCounter = 0;

    /** Store one boundary payload; returns the handle ref for the ledger. */
    public put(runId: string, nodeId: string, payload: RuntimeOutputPayload): DataHandleRef {
        this.handleCounter++;
        const handleId = `${runId}/${nodeId}/${this.handleCounter.toString(36)}`;
        const bytes = approximateBytes(payload);
        const used = this.runBytes.get(runId) ?? 0;
        if (used + bytes > MAX_BYTES_PER_RUN) {
            // Over quota: the handle exists but its detail is not retained.
            return {
                handleId,
                contract: payload.contract,
                ...(payload.rows ? { rows: payload.rows.length } : {}),
                bytes,
                expired: true,
            };
        }
        this.outputs.set(handleId, { payload, bytes });
        this.runBytes.set(runId, used + bytes);
        return {
            handleId,
            contract: payload.contract,
            ...(payload.rows ? { rows: payload.rows.length } : {}),
            bytes,
        };
    }

    public fetchPage(
        handleId: string,
        startRow: number,
        rowCount: number,
    ):
        | {
              columns?: string[];
              rows?: Array<Array<string | number | boolean | null>>;
              totalRows?: number;
          }
        | undefined {
        const stored = this.outputs.get(handleId);
        if (!stored) {
            return undefined;
        }
        const payload = stored.payload;
        if (payload.rows) {
            const start = Math.max(0, startRow);
            const count = Math.min(Math.max(0, rowCount), MAX_PAGE_ROWS);
            return {
                ...(payload.columns ? { columns: payload.columns } : {}),
                rows: payload.rows.slice(start, start + count),
                totalRows: payload.rows.length,
            };
        }
        if (payload.text !== undefined) {
            return { columns: ["text"], rows: [[payload.text]], totalRows: 1 };
        }
        if (payload.scalars) {
            return {
                columns: ["name", "value"],
                rows: Object.entries(payload.scalars).map(([k, v]) => [k, v]),
                totalRows: Object.keys(payload.scalars).length,
            };
        }
        return { rows: [], totalRows: 0 };
    }

    public dropRun(runId: string): void {
        for (const handleId of [...this.outputs.keys()]) {
            if (handleId.startsWith(`${runId}/`)) {
                this.outputs.delete(handleId);
            }
        }
        this.runBytes.delete(runId);
    }
}

function approximateBytes(payload: RuntimeOutputPayload): number {
    try {
        return Buffer.byteLength(JSON.stringify(payload), "utf8");
    } catch {
        return 0;
    }
}
