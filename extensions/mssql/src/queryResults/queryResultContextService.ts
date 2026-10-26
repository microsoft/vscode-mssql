/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QueryResultContextService (C2D-4, plan §12): owns the answer to "what does
 * the user mean by *these results*". Grids feed throttled selection-shape
 * updates (never values); commands, the status surface, and later the
 * `@query` participant and LM tool consult `current()` instead of guessing.
 *
 * v1 resolution: most-recent update wins across live grids and pinned
 * documents; a source/snapshot going away clears its entry. The full §12.2
 * focus ladder lands with the chat surfaces that need it.
 *
 * VS Code context keys (booleans/enums only — no ids, names, or SQL):
 *   mssql.queryResults.hasActiveSource
 *   mssql.queryResults.hasActiveSelection
 *   mssql.queryResults.activeSourceKind = queryStudio | pinnedSnapshot
 */

import { Perf } from "../perf/perfTelemetry";
import { QsGridSelectionUpdate } from "../sharedInterfaces/queryStudio";

export interface QueryResultResolvedContext {
    readonly kind: "queryStudio" | "pinnedSnapshot";
    /** Live source id (queryStudio) — never a URI. */
    readonly sourceId?: string;
    readonly snapshotId?: string;
    readonly resultSetId: string;
    readonly active?: { row: number; column: number };
    readonly spatial?: { row: number; column: number };
    readonly selectedCellCount: number;
    readonly selectedRowCount: number;
    readonly updatedEpochMs: number;
}

export type ContextKeySetter = (key: string, value: unknown) => void;

export class QueryResultContextService {
    private current_: QueryResultResolvedContext | undefined;

    constructor(
        private readonly setContextKey: ContextKeySetter = () => undefined,
        private readonly now: () => number = () => Date.now(),
    ) {}

    updateFromQueryStudio(sourceId: string, update: QsGridSelectionUpdate): void {
        this.apply({ kind: "queryStudio", sourceId }, update);
    }

    updateFromPinnedDocument(snapshotId: string, update: QsGridSelectionUpdate): void {
        this.apply({ kind: "pinnedSnapshot", snapshotId }, update);
    }

    private apply(
        owner:
            | { kind: "queryStudio"; sourceId: string }
            | { kind: "pinnedSnapshot"; snapshotId: string },
        update: QsGridSelectionUpdate,
    ): void {
        const selectedCellCount = update.selectedCellCount ?? (update.active ? 1 : 0);
        this.current_ = {
            kind: owner.kind,
            ...(owner.kind === "queryStudio" ? { sourceId: owner.sourceId } : {}),
            ...(owner.kind === "pinnedSnapshot" ? { snapshotId: owner.snapshotId } : {}),
            resultSetId: update.resultSetId,
            ...(update.active ? { active: update.active } : {}),
            ...(update.spatial ? { spatial: update.spatial } : {}),
            selectedCellCount,
            selectedRowCount: update.selectedRowCount ?? (update.active ? 1 : 0),
            updatedEpochMs: this.now(),
        };
        this.pushContextKeys();
        Perf.marker("mssql.queryResults.context.update", "instant", {
            sourceKind: owner.kind,
            reason: update.reason,
            hasSelection: selectedCellCount > 0,
            selectedCells: selectedCellCount,
        });
    }

    /** A live source or snapshot went away — drop a context that points at it. */
    clearForSource(sourceId: string): void {
        if (this.current_?.sourceId === sourceId) {
            this.current_ = undefined;
            this.pushContextKeys();
        }
    }

    clearForSnapshot(snapshotId: string): void {
        if (this.current_?.snapshotId === snapshotId) {
            this.current_ = undefined;
            this.pushContextKeys();
        }
    }

    current(): QueryResultResolvedContext | undefined {
        return this.current_;
    }

    private pushContextKeys(): void {
        const current = this.current_;
        this.setContextKey("mssql.queryResults.hasActiveSource", current !== undefined);
        this.setContextKey(
            "mssql.queryResults.hasActiveSelection",
            current !== undefined && current.selectedCellCount > 0,
        );
        this.setContextKey("mssql.queryResults.activeSourceKind", current?.kind ?? "");
    }
}

let instance: QueryResultContextService | undefined;
let contextKeySetter: ContextKeySetter = () => undefined;

/** The provider edge injects the real `setContext` executor at activation. */
export function bindQueryResultContextKeys(setter: ContextKeySetter): void {
    contextKeySetter = setter;
}

export function getQueryResultContextService(): QueryResultContextService {
    instance ??= new QueryResultContextService((key, value) => contextKeySetter(key, value));
    return instance;
}

export function disposeQueryResultContextService(): void {
    instance = undefined;
}
