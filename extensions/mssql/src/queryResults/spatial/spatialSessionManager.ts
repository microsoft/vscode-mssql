/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Host-authoritative Spatial pull sessions. A session leases one terminal
 * result store and serves sparse, non-admitting windows; no query is rerun and
 * no raw values enter diagnostics. Every response advances or terminates.
 */

import * as crypto from "crypto";
import { Perf } from "../../perf/perfTelemetry";
import { cellDisplayText } from "../../sharedInterfaces/queryStudioGridOps";
import {
    isSpatialCellEncodingV1,
    SpatialCellEncodingV1,
} from "../../sharedInterfaces/queryResultCellCodec";
import {
    QsSpatialFeatureTransport,
    QsSpatialNextParams,
    QsSpatialNextResult,
    QsSpatialOpenParams,
    QsSpatialOpenResult,
} from "../../sharedInterfaces/spatialResults";
import { IQueryResultStore, QueryResultStoreLease } from "../queryResultTypes";

const CHUNK_ROWS = 512;
const MAX_RESPONSE_BYTES = 2_500_000;
const MAX_TEXT_BYTES = 1024;
const MAX_SESSIONS = 4;

interface SpatialSession {
    readonly handle: string;
    readonly generation: number;
    readonly store: IQueryResultStore;
    readonly lease: QueryResultStoreLease;
    readonly resultSetId: string;
    readonly spatialColumn: number;
    readonly kind: "geometry" | "geography";
    readonly labelColumn?: number;
    readonly colorColumn?: number;
    readonly totalRows: number;
    nextRow: number;
    nextSequence: number;
    candidateCells: number;
    nullCells: number;
    unavailableCells: number;
    payloadBytes: number;
    startedAt: number;
    prepareEnded: boolean;
    closed: boolean;
}

function boundedText(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    const text = cellDisplayText(value);
    if (Buffer.byteLength(text, "utf8") <= MAX_TEXT_BYTES) {
        return text;
    }
    const bytes = Buffer.from(text, "utf8");
    let end = MAX_TEXT_BYTES - Buffer.byteLength("…", "utf8");
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
        end--;
    }
    return `${bytes.subarray(0, end).toString("utf8")}…`;
}

function estimatedFeatureBytes(feature: QsSpatialFeatureTransport): number {
    const spatial = feature.spatial;
    const payload = spatial?.status === "ok" ? Math.ceil((spatial.wkbBytes * 4) / 3) : 0;
    return (
        payload +
        Buffer.byteLength(feature.label ?? "", "utf8") +
        Buffer.byteLength(feature.colorValue ?? "", "utf8") +
        256
    );
}

export class SpatialSessionManager {
    private readonly sessions = new Map<string, SpatialSession>();

    open(store: IQueryResultStore | undefined, params: QsSpatialOpenParams): QsSpatialOpenResult {
        const refused = (error: string): QsSpatialOpenResult => ({
            handle: "",
            generation: 0,
            totalRows: 0,
            chunkRows: CHUNK_ROWS,
            error,
        });
        if (!store) {
            return refused("No result store is available for this document.");
        }
        const summary = store.summary(params.resultSetId);
        if (!summary) {
            return refused("The result set is no longer available.");
        }
        if (!summary.complete) {
            return refused("Spatial analysis waits until the result set is complete.");
        }
        const column = summary.columns?.[params.spatialColumn];
        if (!column?.spatial || column.spatial.encoding !== "wkb-v1") {
            return refused("The selected column was not transported as typed spatial WKB.");
        }
        for (const optional of [params.labelColumn, params.colorColumn]) {
            if (
                optional !== undefined &&
                (optional < 0 || optional >= (summary.columns?.length ?? 0))
            ) {
                return refused("A selected label or color column is outside the result schema.");
            }
        }
        if (this.sessions.size >= MAX_SESSIONS) {
            const oldest = this.sessions.keys().next().value as string | undefined;
            if (oldest) {
                this.close(oldest);
            }
        }
        const lease = store.retain({ kind: "spatialView", label: "Spatial results" });
        if (!lease) {
            return refused("The result store is closing; rerun the query to inspect it.");
        }
        const session: SpatialSession = {
            handle: `sp_${crypto.randomBytes(9).toString("base64url")}`,
            generation: 1,
            store,
            lease,
            resultSetId: params.resultSetId,
            spatialColumn: params.spatialColumn,
            kind: column.spatial.kind,
            ...(params.labelColumn !== undefined ? { labelColumn: params.labelColumn } : {}),
            ...(params.colorColumn !== undefined ? { colorColumn: params.colorColumn } : {}),
            totalRows: summary.rowCount,
            nextRow: 0,
            nextSequence: 0,
            candidateCells: 0,
            nullCells: 0,
            unavailableCells: 0,
            payloadBytes: 0,
            startedAt: performance.now(),
            prepareEnded: false,
            closed: false,
        };
        this.sessions.set(session.handle, session);
        Perf.marker("mssql.queryResults.spatial.prepare.begin", "begin", {
            sourceMode: "capturedResult",
            rowBudget: summary.rowCount,
            payloadBudgetBytes: MAX_RESPONSE_BYTES,
        });
        return {
            handle: session.handle,
            generation: session.generation,
            totalRows: session.totalRows,
            kind: column.spatial.kind,
            chunkRows: CHUNK_ROWS,
        };
    }

    async next(params: QsSpatialNextParams): Promise<QsSpatialNextResult> {
        const session = this.sessions.get(params.handle);
        const failed = (error: string): QsSpatialNextResult => ({
            generation: session?.generation ?? 0,
            sequence: params.sequence,
            done: true,
            features: [],
            scannedRows: 0,
            wireBytes: 0,
            error,
        });
        if (!session || session.closed) {
            return failed("The Spatial session has expired.");
        }
        if (params.generation !== session.generation || params.sequence !== session.nextSequence) {
            return failed("Stale or out-of-order Spatial chunk request.");
        }
        const startedAt = performance.now();
        const ordinals = [
            ...new Set(
                [session.spatialColumn, session.labelColumn, session.colorColumn].filter(
                    (value): value is number => value !== undefined,
                ),
            ),
        ];
        const projectedIndex = new Map(ordinals.map((ordinal, index) => [ordinal, index]));
        const features: QsSpatialFeatureTransport[] = [];
        let scannedRows = 0;
        let estimatedBytes = 256;
        const rowCount = Math.min(CHUNK_ROWS, session.totalRows - session.nextRow);
        for await (const chunk of session.store.streamRows({
            resultSetId: session.resultSetId,
            rowStart: session.nextRow,
            rowCount,
            chunkRows: CHUNK_ROWS,
            columnOrdinals: ordinals,
            reason: "spatial",
        })) {
            for (let i = 0; i < chunk.values.length; i++) {
                const row = chunk.values[i];
                const rawSpatial = row[projectedIndex.get(session.spatialColumn)!];
                const spatial: SpatialCellEncodingV1 | null =
                    rawSpatial === undefined || rawSpatial === null
                        ? null
                        : isSpatialCellEncodingV1(rawSpatial)
                          ? rawSpatial
                          : {
                                $t: "spatial",
                                version: 1,
                                status: "unrenderable",
                                kind: session.kind,
                                reason: "unsupportedNativeValue",
                            };
                const label =
                    session.labelColumn !== undefined
                        ? boundedText(row[projectedIndex.get(session.labelColumn)!])
                        : undefined;
                const colorValue =
                    session.colorColumn !== undefined
                        ? boundedText(row[projectedIndex.get(session.colorColumn)!])
                        : undefined;
                const feature: QsSpatialFeatureTransport = {
                    ordinal: chunk.start + i,
                    spatial,
                    ...(label !== undefined ? { label } : {}),
                    ...(colorValue !== undefined ? { colorValue } : {}),
                };
                const bytes = estimatedFeatureBytes(feature);
                if (features.length > 0 && estimatedBytes + bytes > MAX_RESPONSE_BYTES) {
                    break;
                }
                features.push(feature);
                estimatedBytes += bytes;
                scannedRows++;
                session.candidateCells++;
                if (spatial === null) {
                    session.nullCells++;
                } else if (spatial.status === "unrenderable") {
                    session.unavailableCells++;
                } else {
                    session.payloadBytes += spatial.wkbBytes;
                }
            }
        }
        // A hard-to-fit feature still advances; typed cell guards cap it at 1 MiB.
        session.nextRow += scannedRows;
        session.nextSequence++;
        const done = session.nextRow >= session.totalRows || scannedRows === 0;
        const provisional = {
            generation: session.generation,
            sequence: params.sequence,
            done,
            features,
            scannedRows,
            wireBytes: 0,
        };
        let wireBytes = 0;
        for (let i = 0; i < 3; i++) {
            const measured = Buffer.byteLength(
                JSON.stringify({ ...provisional, wireBytes }),
                "utf8",
            );
            if (measured === wireBytes) break;
            wireBytes = measured;
        }
        Perf.marker("mssql.queryResults.spatial.chunk.end", "instant", {
            sequence: params.sequence,
            sourceRowsScanned: scannedRows,
            features: features.length,
            payloadBytes: wireBytes,
            done,
            ms: Math.round((performance.now() - startedAt) * 100) / 100,
        });
        if (done) {
            session.prepareEnded = true;
            Perf.marker("mssql.queryResults.spatial.prepare.end", "end", {
                outcome: "ok",
                sourceRowsScanned: session.nextRow,
                candidateCells: session.candidateCells,
                nullCells: session.nullCells,
                transportUnavailableCells: session.unavailableCells,
                payloadBytes: session.payloadBytes,
                partial: session.nextRow < session.totalRows ? "true" : "false",
                partialReason: session.nextRow < session.totalRows ? "storeShortRead" : "none",
                ms: Math.round((performance.now() - session.startedAt) * 100) / 100,
            });
        }
        return { ...provisional, wireBytes };
    }

    cancel(handle: string, generation: number): void {
        const session = this.sessions.get(handle);
        if (session && session.generation === generation) {
            Perf.marker("mssql.queryResults.spatial.prepare.cancel", "instant", {
                reason: "clientCancel",
                sourceRowsScanned: session.nextRow,
            });
            this.close(handle, "cancel");
        }
    }

    close(handle: string, reason = "close"): void {
        const session = this.sessions.get(handle);
        if (!session) {
            return;
        }
        session.closed = true;
        this.sessions.delete(handle);
        if (!session.prepareEnded) {
            session.prepareEnded = true;
            Perf.marker("mssql.queryResults.spatial.prepare.end", "end", {
                outcome: "canceled",
                sourceRowsScanned: session.nextRow,
                candidateCells: session.candidateCells,
                nullCells: session.nullCells,
                transportUnavailableCells: session.unavailableCells,
                payloadBytes: session.payloadBytes,
                partial: "true",
                partialReason: reason,
                ms: Math.round((performance.now() - session.startedAt) * 100) / 100,
            });
        }
        session.lease.dispose();
        Perf.marker("mssql.queryResults.spatial.resources.released", "instant", {
            reason,
            leases: 0,
            sessions: this.sessions.size,
        });
    }

    dispose(): void {
        for (const handle of [...this.sessions.keys()]) {
            this.close(handle);
        }
    }
}
