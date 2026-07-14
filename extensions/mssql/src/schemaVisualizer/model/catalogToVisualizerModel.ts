/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CatalogSnapshot → SchemaVisualizerCatalogModel (SV-R2; addendum §4).
 * Pure, deterministic, tables-only (P0 — D5: views deferred). One snapshot
 * in, one model out; the caller pins EXACTLY ONE snapshot per render
 * (§6.4) — this module never touches leases, sessions, or clocks.
 *
 * Honesty mapping:
 * - whole-DB section outcomes → capability matrix (§5.8): a failed
 *   descriptions section limits `descriptions`, it does NOT block the
 *   diagram; a failed columns section limits `diagramNodes` — consumers
 *   must render the limitation, never an empty-success diagram.
 * - per-column facts the substrate did not capture → `unknown(reason)`,
 *   never fabricated (§4.2). `known(null)` = definitively absent.
 */

import {
    CatalogSnapshot,
    ColumnInfo,
    FkDetail,
    SectionState,
} from "../../services/metadata/catalogModel";
import {
    Available,
    columnGraphId,
    fkGraphId,
    known,
    SchemaVisualizerCatalogModel,
    SqlTypeSpec,
    tableGraphId,
    unknown,
    VisualizerCapabilities,
    VisualizerCapabilityState,
    VisualizerColumn,
    VisualizerForeignKey,
    VisualizerTable,
} from "./schemaVisualizerModel";

export interface CatalogModelInput {
    serverFingerprint: string;
    database: string;
}

/** Sections a capability depends on → capability state (§5.8). */
function capabilityFrom(
    readiness: Readonly<Record<string, SectionState>>,
    sections: readonly string[],
): VisualizerCapabilityState {
    const failed = sections.filter((s) => {
        const state = readiness[s];
        return state !== "ready" && state !== "lite";
    });
    if (failed.length === 0) {
        return { state: "available" };
    }
    const anyFailed = failed.some((s) => readiness[s] === "failed");
    return {
        state: "limited",
        reason: anyFailed ? "sectionUnavailable" : "notHydrated",
        failedSections: failed,
    };
}

/** Derived one-way display facts — never reverse-parsed (§20.8). */
function typeSpecFrom(column: ColumnInfo): Available<SqlTypeSpec> {
    const detail = column.detail;
    if (detail === undefined) {
        return unknown("notHydrated");
    }
    const spec: SqlTypeSpec = {
        displayText: column.typeDisplay,
        typeName: detail.typeName,
        systemTypeId: detail.systemTypeId,
        userTypeId: detail.userTypeId,
        isUserDefined: detail.isUserDefined,
        isAssemblyType: detail.isAssemblyType,
        maxLengthBytes: detail.maxLengthBytes,
        precision: detail.precision,
        scale: detail.scale,
    };
    if (detail.typeSchema !== undefined) {
        spec.typeSchema = detail.typeSchema;
    }
    if (detail.baseTypeName !== undefined) {
        spec.baseTypeName = detail.baseTypeName;
    }
    if (detail.collationName !== undefined) {
        spec.collationName = detail.collationName;
    }
    const lowered = detail.typeName.toLowerCase();
    if (["nchar", "nvarchar"].includes(lowered)) {
        spec.logicalLength = detail.maxLengthBytes < 0 ? "max" : detail.maxLengthBytes / 2;
    } else if (["char", "varchar", "binary", "varbinary"].includes(lowered)) {
        spec.logicalLength = detail.maxLengthBytes < 0 ? "max" : detail.maxLengthBytes;
    }
    if (
        lowered === "vector" &&
        detail.maxLengthBytes > 8 &&
        (detail.maxLengthBytes - 8) % 4 === 0
    ) {
        // Documented storage layout: 8-byte header + 4 bytes per dimension.
        spec.vectorDimensions = (detail.maxLengthBytes - 8) / 4;
    }
    return known(spec);
}

export function buildVisualizerModel(
    snapshot: CatalogSnapshot,
    input: CatalogModelInput,
): SchemaVisualizerCatalogModel {
    const readiness = snapshot.readiness;
    const capabilities: VisualizerCapabilities = {
        tableList: capabilityFrom(readiness, ["schemas", "objects"]),
        diagramNodes: capabilityFrom(readiness, ["schemas", "objects", "columns"]),
        relationshipEdges: capabilityFrom(readiness, [
            "schemas",
            "objects",
            "columns",
            "foreignKeys",
        ]),
        keyProperties: capabilityFrom(readiness, ["keys"]),
        descriptions: capabilityFrom(readiness, ["descriptions"]),
        informationalScript: capabilityFrom(readiness, [
            "schemas",
            "objects",
            "columns",
            "keys",
            "foreignKeys",
        ]),
        // Downgraded below if any rendered column lacks a real column_id.
        columnIdentityGrade: { state: "available" },
    };

    const keysOk = capabilities.keyProperties.state === "available";
    const descriptionsOk = capabilities.descriptions.state === "available";

    // Tables sorted by objectId — numeric, deterministic, collation-free.
    const tableInfos = snapshot
        .listObjects(undefined, ["table"])
        .slice()
        .sort((a, z) => a.objectId - z.objectId);

    let anyColumnWithoutId = false;
    const tables: VisualizerTable[] = tableInfos.map((info) => {
        const pkColumns = new Set(keysOk ? snapshot.getPrimaryKeyColumns(info.objectId) : []);
        const columns: VisualizerColumn[] = snapshot.getColumns(info.objectId).map((column) => {
            if (column.columnId === undefined) {
                anyColumnWithoutId = true;
            }
            const detail = column.detail;
            const isIdentity = column.isIdentity === true;
            const isComputed = column.isComputed === true;
            let identitySpec: VisualizerColumn["identitySpec"];
            if (!isIdentity) {
                identitySpec = unknown("notApplicable");
            } else if (detail?.identity !== undefined) {
                identitySpec = known(detail.identity);
            } else {
                identitySpec = unknown("notHydrated");
            }
            let computed: VisualizerColumn["computed"];
            if (!isComputed) {
                computed = known<{ definition: string; persisted: boolean } | null>(null);
            } else if (detail?.computed !== undefined) {
                computed = known<{ definition: string; persisted: boolean } | null>(
                    detail.computed,
                );
            } else {
                computed = unknown("notHydrated");
            }
            const identity: VisualizerColumn["identity"] = { objectId: info.objectId };
            if (column.columnId !== undefined) {
                identity.columnId = column.columnId;
            }
            return {
                identity,
                graphId: columnGraphId(info.objectId, column.columnId, column.ordinal),
                ordinal: column.ordinal,
                name: column.name,
                typeDisplay: column.typeDisplay,
                nullable: column.nullable,
                isIdentity,
                isComputed,
                inPrimaryKey: keysOk
                    ? known(pkColumns.has(column.name))
                    : unknown(readiness.keys === "failed" ? "sectionUnavailable" : "notHydrated"),
                type: typeSpecFrom(column),
                defaultConstraint:
                    detail === undefined
                        ? unknown("notHydrated")
                        : known<{ name?: string; definition: string } | null>(
                              detail.default ?? null,
                          ),
                identitySpec,
                computed,
                description: descriptionsOk
                    ? known<string | null>(
                          snapshot.getDescription(info.objectId, column.name) ?? null,
                      )
                    : unknown(
                          readiness.descriptions === "failed"
                              ? "sectionUnavailable"
                              : "notHydrated",
                      ),
            };
        });
        return {
            identity: { objectId: info.objectId },
            graphId: tableGraphId(info.objectId),
            schema: info.schema,
            name: info.name,
            columns,
            keyConstraints: keysOk
                ? snapshot.getKeyConstraints(info.objectId).map((constraint) => ({
                      name: constraint.name,
                      kind: constraint.kind,
                      columns: [...constraint.columns],
                  }))
                : [],
            description: descriptionsOk
                ? known<string | null>(snapshot.getDescription(info.objectId) ?? null)
                : unknown(
                      readiness.descriptions === "failed" ? "sectionUnavailable" : "notHydrated",
                  ),
        };
    });
    if (anyColumnWithoutId) {
        capabilities.columnIdentityGrade = {
            state: "limited",
            reason: "notHydrated",
            failedSections: ["columns"],
        };
    }

    // FK edges: one entry per constraint, sourced from each table's
    // outgoing details (FKs exist only on tables). Deterministic order.
    const foreignKeys: VisualizerForeignKey[] = [];
    for (const table of tableInfos) {
        for (const detail of snapshot.getForeignKeyDetailsFrom(table.objectId)) {
            foreignKeys.push(visualizerFk(detail));
        }
    }
    foreignKeys.sort((a, z) => {
        const aId = a.identity.constraintObjectId ?? Number.MAX_SAFE_INTEGER;
        const zId = z.identity.constraintObjectId ?? Number.MAX_SAFE_INTEGER;
        return aId - zId || a.fromObjectId - z.fromObjectId || (a.name < z.name ? -1 : 1);
    });

    return {
        databaseIdentity: {
            serverFingerprint: input.serverFingerprint,
            database: input.database,
        },
        caseSensitive: snapshot.caseSensitive,
        tables,
        foreignKeys,
        capabilities,
        source: {
            generation: snapshot.generation,
            capturedAtUtc: snapshot.capturedAtUtc,
            mode: snapshot.mode,
            sectionReadiness: { ...snapshot.readiness },
        },
    };
}

function visualizerFk(detail: FkDetail): VisualizerForeignKey {
    const identity: VisualizerForeignKey["identity"] = {};
    if (detail.constraintObjectId !== undefined) {
        identity.constraintObjectId = detail.constraintObjectId;
    }
    return {
        identity,
        graphId: fkGraphId(detail.constraintObjectId, detail.fromObjectId, detail.name),
        name: detail.name,
        fromObjectId: detail.fromObjectId,
        toObjectId: detail.toObjectId,
        columnPairs: detail.columns.map((pair) => {
            const mapped: VisualizerForeignKey["columnPairs"][number] = {
                fromColumnName: pair.fromColumn,
                toColumnName: pair.toColumn,
            };
            if (pair.ordinal !== undefined) {
                mapped.ordinal = pair.ordinal;
            }
            if (pair.fromColumnId !== undefined) {
                mapped.fromColumnId = pair.fromColumnId;
            }
            if (pair.toColumnId !== undefined) {
                mapped.toColumnId = pair.toColumnId;
            }
            return mapped;
        }),
        onDelete: detail.onDelete !== undefined ? known(detail.onDelete) : unknown("notHydrated"),
        onUpdate: detail.onUpdate !== undefined ? known(detail.onUpdate) : unknown("notHydrated"),
    };
}
