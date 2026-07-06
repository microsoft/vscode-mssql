/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Synthesizes the inline-completion RawSchemaContextPayload from a
 * MetadataService catalog snapshot, replicating the fetch semantics of the
 * completions branch's mega query (dev/karlb/completions @ 065208582):
 *
 * - Detail ranking is relevance-agnostic: default-schema objects first, then
 *   schema name, then object name (case-insensitive) — relevance ranking
 *   happens later in selectSchemaContextForPrompt.
 * - Objects past the detail caps land in the name-only inventories.
 * - Columns are ordered primary-key-first (key ordinal), then column order;
 *   definitions render as "<name> <type>[ NOT NULL]" (typeDisplay already
 *   matches the query's type-name formatting).
 * - FK targets are schema-qualified ("schema.table"), one FK annotation per
 *   column (first by table FK order), plus the table-level foreignKeys list.
 * - System objects come from the curated static catalog gated by engine
 *   edition; masterSymbols is empty on every branch — both exactly as the
 *   original query behaves.
 */

import {
    CatalogSnapshot,
    ObjectInfo,
    ObjectKind,
    ordinalCompare,
} from "../services/metadata/catalogModel";
import {
    RawObjectColumn,
    RawRoutine,
    RawSchemaContextPayload,
    RawSchemaObject,
    SqlInlineCompletionResolvedSchemaBudget,
} from "./completionSchemaContextCore";
import {
    engineEditionDisplayName,
    selectCuratedSystemObjects,
} from "./completionSystemObjectCatalog";

export interface CatalogPayloadConnectionFacts {
    server?: string;
    database?: string;
    /** Overrides the snapshot's engine edition when the caller knows better. */
    engineEdition?: number;
}

const excludedSchemaNames = new Set(["sys", "information_schema"]);

export function buildRawSchemaContextPayload(
    snapshot: CatalogSnapshot,
    budget: SqlInlineCompletionResolvedSchemaBudget,
    facts: CatalogPayloadConnectionFacts = {},
): RawSchemaContextPayload {
    const defaultSchema = snapshot.defaultSchema || "dbo";
    const engineEdition = facts.engineEdition ?? snapshot.engineEdition;

    const schemas = snapshot
        .listSchemas()
        .map((schema) => schema.name)
        .filter((name) => !excludedSchemaNames.has(name.toLowerCase()))
        .sort(rankNameComparer(defaultSchema, (name) => name));

    const tables = rankObjects(snapshot, ["table"], defaultSchema);
    const views = rankObjects(snapshot, ["view"], defaultSchema);
    const routines = rankRoutineObjects(snapshot, defaultSchema);

    const detailedTables = tables.slice(0, budget.maxFetchedTables);
    const detailedViews = views.slice(0, budget.maxFetchedViews);
    const detailedRoutines = routines.slice(0, budget.maxFetchedRoutines);

    const tableInventoryCap = Math.max(
        budget.maxTableNameOnlyInventory,
        budget.largeTableNameOnlyInventory,
    );
    const viewInventoryCap = Math.max(
        budget.maxViewNameOnlyInventory,
        budget.largeViewNameOnlyInventory,
    );
    const routineInventoryCap = Math.max(
        budget.maxRoutineNameOnlyInventory,
        budget.largeRoutineNameOnlyInventory,
    );

    return {
        server: facts.server,
        database: facts.database,
        defaultSchema,
        engineEdition,
        engineEditionName: engineEditionDisplayName(engineEdition),
        totalTableCount: tables.length,
        totalViewCount: views.length,
        totalRoutineCount: routines.length,
        schemas: schemas.map((name) => ({ name })),
        tables: detailedTables.map((object) => toRawSchemaObject(snapshot, object, true)),
        views: detailedViews.map((object) => toRawSchemaObject(snapshot, object, false)),
        routines: detailedRoutines.map((object) => toRawRoutine(snapshot, object)),
        tableNameOnlyInventory: tables
            .slice(budget.maxFetchedTables, budget.maxFetchedTables + tableInventoryCap)
            .map((object) => ({ schema: object.schema, name: object.name })),
        viewNameOnlyInventory: views
            .slice(budget.maxFetchedViews, budget.maxFetchedViews + viewInventoryCap)
            .map((object) => ({ schema: object.schema, name: object.name })),
        routineNameOnlyInventory: routines
            .slice(budget.maxFetchedRoutines, budget.maxFetchedRoutines + routineInventoryCap)
            .map((object) => ({ schema: object.schema, name: object.name })),
        systemObjects: selectCuratedSystemObjects(engineEdition).map((object) => ({
            schema: object.schema,
            name: object.name,
            columns: object.columns.map((column) => ({ name: column })),
        })),
        masterSymbols: [],
    };
}

function rankNameComparer(
    defaultSchema: string,
    schemaOf: (value: string) => string,
): (a: string, b: string) => number {
    const folded = defaultSchema.toLowerCase();
    return (a, b) => {
        const aDefault = schemaOf(a).toLowerCase() === folded ? 0 : 1;
        const bDefault = schemaOf(b).toLowerCase() === folded ? 0 : 1;
        if (aDefault !== bDefault) {
            return aDefault - bDefault;
        }
        return ordinalCompare(a, b);
    };
}

function rankObjects(
    snapshot: CatalogSnapshot,
    kinds: ObjectKind[],
    defaultSchema: string,
): ObjectInfo[] {
    const folded = defaultSchema.toLowerCase();
    return snapshot
        .listObjects(undefined, kinds)
        .filter((object) => !excludedSchemaNames.has(object.schema.toLowerCase()))
        .sort(
            (a, b) =>
                defaultSchemaRank(a, folded) - defaultSchemaRank(b, folded) ||
                ordinalCompare(a.schema, b.schema) ||
                ordinalCompare(a.name, b.name),
        );
}

function rankRoutineObjects(snapshot: CatalogSnapshot, defaultSchema: string): ObjectInfo[] {
    const folded = defaultSchema.toLowerCase();
    return snapshot
        .listObjects(undefined, ["procedure", "scalarFunction", "tableFunction"])
        .filter((object) => !excludedSchemaNames.has(object.schema.toLowerCase()))
        .sort(
            (a, b) =>
                defaultSchemaRank(a, folded) - defaultSchemaRank(b, folded) ||
                routineKindRank(a.kind) - routineKindRank(b.kind) ||
                ordinalCompare(a.schema, b.schema) ||
                ordinalCompare(a.name, b.name),
        );
}

function defaultSchemaRank(object: ObjectInfo, foldedDefaultSchema: string): number {
    return object.schema.toLowerCase() === foldedDefaultSchema ? 0 : 1;
}

function routineKindRank(kind: ObjectKind): number {
    // The query ranks procedures (P/PC) before functions.
    return kind === "procedure" ? 0 : 1;
}

function toRawSchemaObject(
    snapshot: CatalogSnapshot,
    object: ObjectInfo,
    includeForeignKeys: boolean,
): RawSchemaObject {
    const primaryKeyColumns = snapshot.getPrimaryKeyColumns(object.objectId);
    const primaryKeyRank = new Map<string, number>();
    primaryKeyColumns.forEach((name, ordinal) => primaryKeyRank.set(name.toLowerCase(), ordinal));

    const foreignKeyPairs = includeForeignKeys
        ? collectForeignKeyPairs(snapshot, object.objectId)
        : [];
    const firstForeignKeyByColumn = new Map<string, { table: string; column: string }>();
    for (const pair of foreignKeyPairs) {
        const key = pair.column.toLowerCase();
        if (!firstForeignKeyByColumn.has(key)) {
            firstForeignKeyByColumn.set(key, {
                table: pair.referencedTable,
                column: pair.referencedColumn,
            });
        }
    }

    const columns = [...snapshot.getColumns(object.objectId)].sort((a, b) => {
        const aPk = primaryKeyRank.get(a.name.toLowerCase());
        const bPk = primaryKeyRank.get(b.name.toLowerCase());
        if (aPk !== undefined || bPk !== undefined) {
            if (aPk === undefined) {
                return 1;
            }
            if (bPk === undefined) {
                return -1;
            }
            return aPk - bPk;
        }
        return a.ordinal - b.ordinal;
    });

    return {
        schema: object.schema,
        name: object.name,
        columns: columns.map((column): RawObjectColumn => {
            const foreignKey = firstForeignKeyByColumn.get(column.name.toLowerCase());
            return {
                name: column.name,
                definition: columnDefinition(column.name, column.typeDisplay, column.nullable),
                isPrimaryKey: primaryKeyRank.has(column.name.toLowerCase()),
                ...(foreignKey
                    ? {
                          referencedTable: foreignKey.table,
                          referencedColumn: foreignKey.column,
                      }
                    : {}),
            };
        }),
        ...(includeForeignKeys
            ? {
                  foreignKeys: foreignKeyPairs.map((pair) => ({
                      column: pair.column,
                      referencedTable: pair.referencedTable,
                      referencedColumn: pair.referencedColumn,
                  })),
              }
            : {}),
    };
}

interface ForeignKeyPair {
    column: string;
    referencedTable: string;
    referencedColumn: string;
}

function collectForeignKeyPairs(snapshot: CatalogSnapshot, objectId: number): ForeignKeyPair[] {
    const pairs: ForeignKeyPair[] = [];
    const details = snapshot
        .getForeignKeyDetailsFrom(objectId)
        .sort((a, b) => ordinalCompare(a.name, b.name));
    for (const detail of details) {
        const target = snapshot.getObject(detail.toObjectId);
        if (!target) {
            continue;
        }
        const referencedTable = `${target.schema}.${target.name}`;
        for (const columnPair of detail.columns) {
            pairs.push({
                column: columnPair.fromColumn,
                referencedTable,
                referencedColumn: columnPair.toColumn,
            });
        }
    }
    return pairs;
}

function columnDefinition(name: string, typeDisplay: string, nullable: boolean): string {
    return `${name} ${typeDisplay}${nullable ? "" : " NOT NULL"}`;
}

function toRawRoutine(snapshot: CatalogSnapshot, object: ObjectInfo): RawRoutine {
    const parameters = snapshot.getParameters(object.objectId);
    const returnValue = parameters.find((parameter) => parameter.ordinal === 0);
    const inputParameters = parameters.filter((parameter) => parameter.ordinal > 0);
    const isTableFunction = object.kind === "tableFunction";

    return {
        schema: object.schema,
        name: object.name,
        type: routineTypeCode(object.kind),
        parameters: inputParameters.map((parameter) => ({
            name: parameter.name,
            definition: `${parameter.name} ${parameter.typeDisplay}${
                parameter.isOutput ? " OUTPUT" : ""
            }`,
            direction: parameter.isOutput ? "OUTPUT" : "IN",
        })),
        ...(isTableFunction
            ? {
                  returnColumns: snapshot.getColumns(object.objectId).map((column) => ({
                      name: column.name,
                      definition: columnDefinition(
                          column.name,
                          column.typeDisplay,
                          column.nullable,
                      ),
                  })),
              }
            : returnValue
              ? { returnType: returnValue.typeDisplay }
              : {}),
    };
}

function routineTypeCode(kind: ObjectKind): string {
    switch (kind) {
        case "procedure":
            return "P";
        case "scalarFunction":
            return "FN";
        case "tableFunction":
            return "TF";
        default:
            return "";
    }
}
