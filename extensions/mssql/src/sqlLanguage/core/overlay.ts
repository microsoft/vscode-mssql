/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Script overlay (design 05 §7.4): objects the script creates before any
 * execution — CTEs are statement-scoped (handled by the binder from the
 * sketch, not stored here), table variables are batch-scoped from their
 * declaration onward, temp tables live in document order from creation until
 * a DROP, and script-local real DDL is visible (speculatively) from its
 * statement onward. Columns are names-only when types are unknowable
 * (SELECT INTO).
 */

import { StatementSketch } from "./sketch";

export type OverlayObjectKind = "tempTable" | "tableVariable" | "scriptTable";

export interface OverlayObject {
    readonly name: string; // includes # / ## / @ prefixes; script tables may be schema-qualified
    readonly parts: readonly string[];
    readonly kind: OverlayObjectKind;
    /** Known column names (types unknown unless declared). */
    readonly columns: readonly string[];
    /** True when columns exist but their types are unknown (SELECT INTO). */
    readonly columnsUntyped?: boolean;
    /** Global statement ordinal from which the object is visible. */
    readonly fromStatement: number;
    /** Exclusive end (DROP) when known. */
    readonly untilStatement?: number;
    readonly batchIndex: number;
    /** True for real-object DDL that has not executed (speculative). */
    readonly speculative?: boolean;
}

export interface SketchedStatement {
    readonly batchIndex: number;
    /** Global ordinal across the document. */
    readonly ordinal: number;
    readonly sketch: StatementSketch;
}

export interface ScriptOverlay {
    readonly objects: readonly OverlayObject[];
    /** Batch-scoped variable declarations (scalar + table). */
    readonly variables: readonly {
        readonly name: string;
        readonly typeText?: string;
        readonly isTable?: boolean;
        readonly batchIndex: number;
        readonly fromStatement: number;
    }[];
    visibleObjectsAt(batchIndex: number, ordinal: number): readonly OverlayObject[];
    visibleVariablesAt(
        batchIndex: number,
        ordinal: number,
    ): readonly {
        readonly name: string;
        readonly typeText?: string;
        readonly isTable?: boolean;
    }[];
    findObject(name: string, batchIndex: number, ordinal: number): OverlayObject | undefined;
}

export function buildOverlay(statements: readonly SketchedStatement[]): ScriptOverlay {
    const objects: OverlayObject[] = [];
    const variables: {
        name: string;
        typeText?: string;
        isTable?: boolean;
        columns?: readonly string[];
        batchIndex: number;
        fromStatement: number;
    }[] = [];

    for (const { batchIndex, ordinal, sketch } of statements) {
        // DECLARE — scalars and table variables (batch-scoped).
        for (const decl of sketch.declares) {
            variables.push({
                name: decl.name,
                typeText: decl.typeText,
                isTable: decl.isTable,
                batchIndex,
                fromStatement: ordinal,
            });
            if (decl.isTable === true) {
                objects.push({
                    name: decl.name,
                    parts: [decl.name],
                    kind: "tableVariable",
                    columns: decl.tableColumns ?? [],
                    fromStatement: ordinal,
                    batchIndex,
                });
            }
        }

        // CREATE TABLE — temp or script-local real table.
        if (sketch.createdTable !== undefined) {
            const lastPart = sketch.createdTable.parts[sketch.createdTable.parts.length - 1];
            const isTemp = lastPart.startsWith("#");
            objects.push({
                name: lastPart,
                parts: sketch.createdTable.parts,
                kind: isTemp ? "tempTable" : "scriptTable",
                columns: sketch.createdTable.columns,
                fromStatement: ordinal,
                batchIndex,
                speculative: isTemp ? undefined : true,
            });
        }

        // SELECT ... INTO target — columns from the select list when named.
        if (sketch.selectInto !== undefined) {
            const lastPart = sketch.selectInto.parts[sketch.selectInto.parts.length - 1];
            const rootItems = sketch.selectItems.filter((it) => it.scopeId === 0 && !it.isStar);
            const columns = rootItems
                .map((it) => it.alias)
                .filter((c): c is string => c !== undefined);
            objects.push({
                name: lastPart,
                parts: sketch.selectInto.parts,
                kind: lastPart.startsWith("#") ? "tempTable" : "scriptTable",
                columns,
                columnsUntyped: true,
                fromStatement: ordinal,
                batchIndex,
                speculative: lastPart.startsWith("#") ? undefined : true,
            });
        }

        // DROP TABLE tracking (untilStatement) lands with the B10 sketch
        // support for DROP; until then dropped temp names stay visible —
        // tolerant, never wrong-positive for diagnostics (suppression covers).
    }

    const visibleObjectsAt = (batchIndex: number, ordinal: number): OverlayObject[] =>
        objects.filter((o) => {
            if (o.fromStatement > ordinal) {
                return false;
            }
            if (o.untilStatement !== undefined && ordinal >= o.untilStatement) {
                return false;
            }
            // Table variables are batch-scoped; temp/script objects span batches.
            if (o.kind === "tableVariable" && o.batchIndex !== batchIndex) {
                return false;
            }
            return true;
        });

    return {
        objects,
        variables,
        visibleObjectsAt,
        visibleVariablesAt: (batchIndex, ordinal) =>
            variables.filter((v) => v.batchIndex === batchIndex && v.fromStatement <= ordinal),
        findObject: (name, batchIndex, ordinal) => {
            const folded = name.toLowerCase();
            const visible = visibleObjectsAt(batchIndex, ordinal);
            for (let i = visible.length - 1; i >= 0; i--) {
                if (visible[i].name.toLowerCase() === folded) {
                    return visible[i];
                }
            }
            return undefined;
        },
    };
}
