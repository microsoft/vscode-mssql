/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Marker sink (design §10): the append-only landing zone for every semantic
 * marker in a repetition. Validates each marker against the schema, appends
 * line-delimited JSON to `markers.jsonl`, keeps an in-memory index for
 * normalization and waitForMarker resolution, and tracks the required
 * scenario.start/scenario.end bookkeeping that decides rep validity.
 */

import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { REQUIRED_SCENARIO_MARKERS, validateMarker, type Marker } from "@mssqlperf/contracts";
import type { HarnessLogger } from "../telemetry/logger";

export interface MarkerSinkEvents {
    marker: (marker: Marker) => void;
}

export type MarkerSource = "ws" | "http";

export class MarkerSink extends EventEmitter {
    private stream: WriteStream | undefined;
    private readonly entries: Array<{ marker: Marker; source: MarkerSource }> = [];
    private rejectedCount = 0;

    constructor(
        private readonly filePath: string,
        private readonly logger: HarnessLogger,
    ) {
        super();
    }

    /** Validate and record a marker. Invalid markers are logged and dropped. */
    ingest(data: unknown, source: MarkerSource): boolean {
        const outcome = validateMarker(data);
        if (!outcome.valid) {
            this.rejectedCount += 1;
            this.logger.warn("marker.rejected", `invalid marker from ${source}`, {
                errors: outcome.errors,
                source,
            });
            return false;
        }
        const marker = data as Marker;
        this.entries.push({ marker, source });
        if (!this.stream) {
            mkdirSync(dirname(this.filePath), { recursive: true });
            this.stream = createWriteStream(this.filePath, { flags: "a" });
        }
        this.stream.write(JSON.stringify(marker) + "\n");
        this.logger.trace("marker.ingested", marker.name, {
            phase: marker.phase,
            processRole: marker.process.role,
            source,
        });
        this.emit("marker", marker, source);
        return true;
    }

    all(): Marker[] {
        return this.entries.map((e) => e.marker);
    }

    allWithSource(): Array<{ marker: Marker; source: MarkerSource }> {
        return [...this.entries];
    }

    byName(name: string): Marker[] {
        return this.entries.filter((e) => e.marker.name === name).map((e) => e.marker);
    }

    first(name: string, attrs?: Record<string, unknown>): Marker | undefined {
        return this.entries.find((e) => e.marker.name === name && attrsMatch(e.marker, attrs))
            ?.marker;
    }

    get rejected(): number {
        return this.rejectedCount;
    }

    /** true when every required scenario marker was seen exactly once or more. */
    hasRequiredScenarioMarkers(): boolean {
        return REQUIRED_SCENARIO_MARKERS.every((name) => this.byName(name).length > 0);
    }

    /**
     * Resolve when a marker with the given name (and matching attrs subset)
     * arrives; resolves immediately if already seen. Rejects on timeout.
     */
    waitForMarker(
        name: string,
        options: { attrs?: Record<string, unknown>; timeoutMs: number },
    ): Promise<Marker> {
        const existing = this.first(name, options.attrs);
        if (existing) {
            return Promise.resolve(existing);
        }
        return new Promise<Marker>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off("marker", onMarker);
                reject(
                    new Error(
                        `Timed out after ${options.timeoutMs}ms waiting for marker '${name}'`,
                    ),
                );
            }, options.timeoutMs);
            const onMarker = (marker: Marker): void => {
                if (marker.name === name && attrsMatch(marker, options.attrs)) {
                    clearTimeout(timer);
                    this.off("marker", onMarker);
                    resolve(marker);
                }
            };
            this.on("marker", onMarker);
        });
    }

    async close(): Promise<void> {
        const stream = this.stream;
        this.stream = undefined;
        if (stream) {
            await new Promise<void>((resolve, reject) =>
                stream.end((err: NodeJS.ErrnoException | null | undefined) =>
                    err ? reject(err) : resolve(),
                ),
            );
        }
    }
}

function attrsMatch(marker: Marker, attrs?: Record<string, unknown>): boolean {
    if (!attrs) {
        return true;
    }
    for (const [key, value] of Object.entries(attrs)) {
        if (marker.attrs?.[key] !== value) {
            return false;
        }
    }
    return true;
}
