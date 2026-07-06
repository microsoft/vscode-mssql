/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Browse expansion rules (oe_view_design §10): pure builders from PINNED
 * metadata views to OeV2Node[]. Pin once per expand — every function takes
 * an already-pinned view/snapshot and never re-reads. Readiness honesty:
 * failure/loading/permission states render their own children; only a
 * truly-empty ready section renders "No items".
 *
 * Freshness honesty (CACHE-5, addendum §7.2, extends the §13 table): the
 * controller runs ensureFresh(oeBrowse) per expand and hands the VERDICT
 * down as plain OeV2FreshnessFacts — this pure layer never touches leases
 * or services. A stale/unavailable verdict over rendered data prepends a
 * status child naming the staleness; stale data NEVER renders silently as
 * current.
 */

import type { CatalogSnapshot, ObjectKind } from "../../../services/metadata/catalogModel";
import type { MetadataStatus } from "../../../services/metadata/metadataService";
import type {
    IPinnedServerCatalogView,
    ServerCatalogStatus,
    ServerDatabaseInfo,
} from "../../../services/metadata/serverMetadataService";
import { NOT_APPLICABLE, OeV2Node } from "./oeV2Node";
import {
    encodePath,
    OeV2DatabaseFolder,
    OeV2ObjectFolder,
    OeV2ObjectKind,
    OeV2Path,
} from "./oeV2Path";
import { errorNode, loadingNode, noItemsNode, statusNode } from "./oeV2Readiness";

/**
 * Freshness verdict facts injected by the controller (CACHE-5 §7.2) —
 * duplicated as a local shape so the pure layer's seam stays data-only.
 */
export interface OeV2FreshnessFacts {
    readonly freshness: "live" | "validated" | "stale" | "refreshing" | "unavailable";
    readonly staleReason?: string;
}

/**
 * §7.2 honesty tail: validated/live verdicts render children as-is;
 * "refreshing" means shared work is in flight over current data (no banner
 * — the loading/status gates already cover in-flight hydration); a
 * stale/unavailable verdict over RENDERED data prepends a status child
 * naming the staleness. Loading/failed gates return before this point.
 */
function withStaleNotice(
    scope: string,
    connectionId: string | undefined,
    children: OeV2Node[],
    facts?: OeV2FreshnessFacts,
): OeV2Node[] {
    if (!facts || (facts.freshness !== "stale" && facts.freshness !== "unavailable")) {
        return children;
    }
    const detail =
        facts.staleReason === "accessChanged"
            ? "database access may have changed"
            : facts.staleReason === "permissionChanged"
              ? "permissions may have changed"
              : "using last known catalog";
    return [
        statusNode(
            `${scope}#staleNotice`,
            `Metadata not validated — ${detail} (refresh to retry).`,
            connectionId,
        ),
        ...children,
    ];
}

const FOLDER_LABELS: Record<OeV2DatabaseFolder, string> = {
    tables: "Tables",
    views: "Views",
    storedProcedures: "Stored Procedures",
    functions: "Functions",
    synonyms: "Synonyms",
    schemas: "Schemas",
};

const FOLDER_KINDS: Record<Exclude<OeV2DatabaseFolder, "schemas">, ObjectKind[]> = {
    tables: ["table"],
    views: ["view"],
    storedProcedures: ["procedure"],
    functions: ["scalarFunction", "tableFunction"],
    synonyms: ["synonym"],
};

const OBJECT_ICONS: Record<OeV2ObjectKind, string> = {
    table: "Table",
    view: "View",
    procedure: "StoredProcedure",
    scalarFunction: "ScalarValuedFunction",
    tableFunction: "TableValuedFunction",
    synonym: "Synonym",
};

/** Section key in snapshot.readiness backing each folder's honesty. */
const FOLDER_SECTION: Record<OeV2DatabaseFolder, string> = {
    tables: "objects",
    views: "objects",
    storedProcedures: "objects",
    functions: "objects",
    synonyms: "synonyms",
    schemas: "schemas",
};

// -- server level ------------------------------------------------------------

export function serverChildren(connectionId: string): OeV2Node[] {
    const path: OeV2Path = { kind: "serverFolder", connectionId, folder: "databases" };
    return [
        {
            id: encodePath(path),
            path,
            kind: "serverFolder",
            label: "Databases",
            collapsible: true,
            connectionId,
            readiness: NOT_APPLICABLE,
            capabilities: { canRefresh: true },
            icon: "Folder",
        },
    ];
}

export function databasesFolderChildren(
    connectionId: string,
    status: ServerCatalogStatus | undefined,
    view: IPinnedServerCatalogView | undefined,
    showSystemDatabases: boolean,
    freshness?: OeV2FreshnessFacts,
): OeV2Node[] {
    const scope = `server/${connectionId}/databases`;
    if (!status || status.readiness === "absent" || status.readiness === "loading") {
        return [loadingNode(scope, connectionId)];
    }
    if (status.readiness === "failed") {
        return [
            errorNode(
                scope,
                `Databases unavailable: ${status.errorMessage ?? "server catalog failed"}. Refresh to retry.`,
                connectionId,
            ),
        ];
    }
    const databases = view?.listDatabases();
    if (!databases) {
        return [loadingNode(scope, connectionId)];
    }
    const visible = showSystemDatabases
        ? databases
        : databases.filter((database) => database.isSystem !== true);
    if (visible.length === 0) {
        return withStaleNotice(scope, connectionId, [noItemsNode(scope, connectionId)], freshness);
    }
    return withStaleNotice(
        scope,
        connectionId,
        visible.map((database) => databaseNode(connectionId, database)),
        freshness,
    );
}

export function databaseNode(connectionId: string, info: ServerDatabaseInfo): OeV2Node {
    const path: OeV2Path = { kind: "database", connectionId, database: info.name };
    const inaccessible = info.accessState === "inaccessible";
    const stateNote = info.state && info.state !== "ONLINE" ? info.state.toLowerCase() : undefined;
    const description = [
        stateNote,
        inaccessible ? "no access" : undefined,
        info.isReadOnly ? "read-only" : undefined,
    ]
        .filter(Boolean)
        .join(" · ");
    return {
        id: encodePath(path),
        path,
        kind: "database",
        label: info.name,
        ...(description ? { description } : {}),
        collapsible: !inaccessible,
        connectionId,
        database: info.name,
        readiness: inaccessible
            ? { kind: "permissionDenied", message: "No access to this database." }
            : NOT_APPLICABLE,
        capabilities: {
            canRefresh: true,
            canOpenQuery: !inaccessible,
            canSearch: !inaccessible,
        },
        icon: "Database",
    };
}

// -- database level ----------------------------------------------------------

export function databaseChildren(connectionId: string, database: string): OeV2Node[] {
    return (Object.keys(FOLDER_LABELS) as OeV2DatabaseFolder[]).map((folder) => {
        const path: OeV2Path = { kind: "databaseFolder", connectionId, database, folder };
        return {
            id: encodePath(path),
            path,
            kind: "databaseFolder",
            label: FOLDER_LABELS[folder],
            collapsible: true,
            connectionId,
            database,
            readiness: NOT_APPLICABLE,
            capabilities: { canRefresh: true, canFilter: folder !== "schemas" },
            icon: "Folder",
        };
    });
}

function catalogGate(
    scope: string,
    connectionId: string,
    status: MetadataStatus | undefined,
    snapshot: CatalogSnapshot | undefined,
    section: string,
): OeV2Node[] | undefined {
    if (!status || status.readiness === "absent" || status.readiness === "loading") {
        return [loadingNode(scope, connectionId)];
    }
    if (status.readiness === "failed" || !snapshot) {
        return [errorNode(scope, "Metadata failed to load. Refresh to retry.", connectionId)];
    }
    const sectionState = (snapshot.readiness as Record<string, string>)[section];
    if (sectionState === "failed") {
        return [
            errorNode(
                scope,
                `Metadata section '${section}' failed. Refresh to retry.`,
                connectionId,
            ),
        ];
    }
    return undefined; // ready (possibly stale) — render real children
}

export function databaseFolderChildren(
    connectionId: string,
    database: string,
    folder: OeV2DatabaseFolder,
    status: MetadataStatus | undefined,
    snapshot: CatalogSnapshot | undefined,
    groupBySchema: boolean,
    schema?: string,
    freshness?: OeV2FreshnessFacts,
): OeV2Node[] {
    const scope = `db/${connectionId}/${database}/${folder}${schema ? `/${schema}` : ""}`;
    const gate = catalogGate(scope, connectionId, status, snapshot, FOLDER_SECTION[folder]);
    if (gate) {
        return gate;
    }
    return withStaleNotice(
        scope,
        connectionId,
        databaseFolderContent(
            scope,
            connectionId,
            database,
            folder,
            snapshot!,
            groupBySchema,
            schema,
        ),
        freshness,
    );
}

function databaseFolderContent(
    scope: string,
    connectionId: string,
    database: string,
    folder: OeV2DatabaseFolder,
    snapshot: CatalogSnapshot,
    groupBySchema: boolean,
    schema?: string,
): OeV2Node[] {
    if (folder === "schemas") {
        const schemas = snapshot.listSchemas();
        return schemas.length === 0
            ? [noItemsNode(scope, connectionId)]
            : schemas.map((info) => schemaNode(connectionId, database, info.name));
    }
    if (groupBySchema && schema === undefined) {
        const withObjects = new Set(
            snapshot.listObjects(undefined, FOLDER_KINDS[folder]).map((o) => o.schema),
        );
        if (withObjects.size === 0) {
            return [noItemsNode(scope, connectionId)];
        }
        return [...withObjects].sort().map((name) => {
            const path: OeV2Path = {
                kind: "schemaFolder",
                connectionId,
                database,
                schema: name,
                folder,
            };
            return {
                id: encodePath(path),
                path,
                kind: "schema",
                label: name,
                collapsible: true,
                connectionId,
                database,
                schema: name,
                readiness: NOT_APPLICABLE,
                capabilities: {},
                icon: "Schema",
            } satisfies OeV2Node;
        });
    }
    const objects = snapshot.listObjects(schema, FOLDER_KINDS[folder]);
    if (objects.length === 0) {
        return [noItemsNode(scope, connectionId)];
    }
    return objects.map((info) =>
        objectNode(connectionId, database, info.schema, info.name, info.kind as OeV2ObjectKind),
    );
}

function schemaNode(connectionId: string, database: string, schema: string): OeV2Node {
    const path: OeV2Path = { kind: "schema", connectionId, database, schema };
    return {
        id: encodePath(path),
        path,
        kind: "schema",
        label: schema,
        collapsible: false,
        connectionId,
        database,
        schema,
        readiness: NOT_APPLICABLE,
        capabilities: { canCopyName: true },
        icon: "Schema",
    };
}

export function objectNode(
    connectionId: string,
    database: string,
    schema: string,
    name: string,
    objectKind: OeV2ObjectKind,
): OeV2Node {
    const path: OeV2Path = { kind: "object", connectionId, database, schema, name, objectKind };
    const isTable = objectKind === "table";
    return {
        id: encodePath(path),
        path,
        kind: "object",
        label: `${schema}.${name}`,
        collapsible: objectKind !== "synonym",
        connectionId,
        database,
        schema,
        objectName: name,
        readiness: NOT_APPLICABLE,
        capabilities: {
            canCopyName: true,
            canCopyQualifiedName: true,
            ...(isTable || objectKind === "view"
                ? { canSelectTop: true, canPreviewTable: isTable }
                : {}),
        },
        icon: OBJECT_ICONS[objectKind],
    };
}

// -- object level -------------------------------------------------------------

const OBJECT_CHILD_FOLDERS: Record<OeV2ObjectKind, { folder: OeV2ObjectFolder; label: string }[]> =
    {
        table: [
            { folder: "columns", label: "Columns" },
            { folder: "keys", label: "Keys" },
            { folder: "foreignKeys", label: "Foreign Keys" },
        ],
        view: [{ folder: "columns", label: "Columns" }],
        procedure: [{ folder: "parameters", label: "Parameters" }],
        scalarFunction: [{ folder: "parameters", label: "Parameters" }],
        tableFunction: [
            { folder: "columns", label: "Columns" },
            { folder: "parameters", label: "Parameters" },
        ],
        synonym: [],
    };

export function objectChildren(path: Extract<OeV2Path, { kind: "object" }>): OeV2Node[] {
    return OBJECT_CHILD_FOLDERS[path.objectKind].map(({ folder, label }) => {
        const folderPath: OeV2Path = { ...path, kind: "objectFolder", folder };
        return {
            id: encodePath(folderPath),
            path: folderPath,
            kind: "objectFolder",
            label,
            collapsible: true,
            connectionId: path.connectionId,
            database: path.database,
            schema: path.schema,
            objectName: path.name,
            readiness: NOT_APPLICABLE,
            capabilities: { canRefresh: true },
            icon: "Folder",
        } satisfies OeV2Node;
    });
}

const FOLDER_TO_SECTION: Record<OeV2ObjectFolder, string> = {
    columns: "columns",
    keys: "keys",
    foreignKeys: "foreignKeys",
    parameters: "parameters",
};

export function objectFolderChildren(
    path: Extract<OeV2Path, { kind: "objectFolder" }>,
    status: MetadataStatus | undefined,
    snapshot: CatalogSnapshot | undefined,
    freshness?: OeV2FreshnessFacts,
): OeV2Node[] {
    const scope = `obj/${path.connectionId}/${path.database}/${path.schema}.${path.name}/${path.folder}`;
    const gate = catalogGate(
        scope,
        path.connectionId,
        status,
        snapshot,
        FOLDER_TO_SECTION[path.folder],
    );
    if (gate) {
        return gate;
    }
    // Kind-exact lookup (names can collide across kinds; ids across
    // generations are stale-path errors, not guesses).
    const objectId = snapshot!
        .listObjects(path.schema, [path.objectKind as ObjectKind])
        .find((info) => info.name === path.name)?.objectId;
    if (objectId === undefined) {
        return [
            errorNode(
                scope,
                "Object not found in the current catalog generation. Refresh the parent folder.",
                path.connectionId,
                "staleObject",
            ),
        ];
    }
    return withStaleNotice(
        scope,
        path.connectionId,
        objectFolderContent(scope, path, snapshot!, objectId),
        freshness,
    );
}

function objectFolderContent(
    scope: string,
    path: Extract<OeV2Path, { kind: "objectFolder" }>,
    snapshot: CatalogSnapshot,
    objectId: number,
): OeV2Node[] {
    const base = { connectionId: path.connectionId, database: path.database };
    switch (path.folder) {
        case "columns": {
            const pkColumns = new Set(snapshot.getPrimaryKeyColumns(objectId));
            const columns = snapshot.getColumns(objectId);
            return columns.length === 0
                ? [noItemsNode(scope, path.connectionId)]
                : columns.map((column) => {
                      const columnPath: OeV2Path = {
                          kind: "column",
                          ...base,
                          schema: path.schema,
                          objectName: path.name,
                          column: column.name,
                      };
                      const badges = [
                          pkColumns.has(column.name) ? "PK" : undefined,
                          column.isIdentity ? "identity" : undefined,
                          column.isComputed ? "computed" : undefined,
                          column.nullable ? "null" : "not null",
                      ].filter(Boolean);
                      return {
                          id: encodePath(columnPath),
                          path: columnPath,
                          kind: "column",
                          label: column.name,
                          description: `${column.typeDisplay}, ${badges.join(", ")}`,
                          collapsible: false,
                          ...base,
                          schema: path.schema,
                          objectName: path.name,
                          readiness: NOT_APPLICABLE,
                          capabilities: { canCopyName: true },
                          icon: "Column",
                      } satisfies OeV2Node;
                  });
        }
        case "keys": {
            const constraints = snapshot.getKeyConstraints(objectId);
            return constraints.length === 0
                ? [noItemsNode(scope, path.connectionId)]
                : constraints.map((constraint) => {
                      const keyPath: OeV2Path = {
                          kind: "column",
                          ...base,
                          schema: path.schema,
                          objectName: path.name,
                          column: `key:${constraint.name}`,
                      };
                      return {
                          id: encodePath(keyPath),
                          path: keyPath,
                          kind: "key",
                          label: constraint.name,
                          description: `${
                              constraint.kind === "primaryKey" ? "PK" : "UQ"
                          } (${constraint.columns.join(", ")})`,
                          collapsible: false,
                          ...base,
                          readiness: NOT_APPLICABLE,
                          capabilities: { canCopyName: true },
                          icon:
                              constraint.kind === "primaryKey" ? "Key_PrimaryKey" : "Key_UniqueKey",
                      } satisfies OeV2Node;
                  });
        }
        case "foreignKeys": {
            const details = snapshot.getForeignKeyDetailsFrom(objectId);
            return details.length === 0
                ? [noItemsNode(scope, path.connectionId)]
                : details.map((detail) => {
                      const target = snapshot.getObject(detail.toObjectId);
                      const fkPath: OeV2Path = {
                          kind: "column",
                          ...base,
                          schema: path.schema,
                          objectName: path.name,
                          column: `fk:${detail.name}`,
                      };
                      const pairs = detail.columns
                          .map((pair) => `${pair.fromColumn}→${pair.toColumn}`)
                          .join(", ");
                      return {
                          id: encodePath(fkPath),
                          path: fkPath,
                          kind: "foreignKey",
                          label: detail.name,
                          description: `→ ${
                              target ? `${target.schema}.${target.name}` : "(unknown)"
                          } (${pairs})`,
                          collapsible: false,
                          ...base,
                          readiness: NOT_APPLICABLE,
                          capabilities: { canCopyName: true },
                          icon: "Key_ForeignKey",
                      } satisfies OeV2Node;
                  });
        }
        case "parameters": {
            const parameters = snapshot!
                .getParameters(objectId)
                .filter((parameter) => parameter.ordinal > 0 || parameter.name !== "");
            return parameters.length === 0
                ? [noItemsNode(scope, path.connectionId)]
                : parameters.map((parameter) => {
                      const parameterPath: OeV2Path = {
                          kind: "parameter",
                          ...base,
                          schema: path.schema,
                          objectName: path.name,
                          parameter: parameter.name || `(return)`,
                          ordinal: parameter.ordinal,
                      };
                      return {
                          id: encodePath(parameterPath),
                          path: parameterPath,
                          kind: "parameter",
                          label: parameter.name || "(return value)",
                          description: `${parameter.typeDisplay}${parameter.isOutput ? ", output" : ""}`,
                          collapsible: false,
                          ...base,
                          readiness: NOT_APPLICABLE,
                          capabilities: { canCopyName: true },
                          icon: parameter.isOutput
                              ? "StoredProcedureParameter_Output"
                              : "StoredProcedureParameter_Input",
                      } satisfies OeV2Node;
                  });
        }
    }
}
