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
import { folderDef, OeV2FolderDef, OeV2ScopeFacts, resolveFolders } from "./oeV2Hierarchy";
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

const OBJECT_ICONS: Record<OeV2ObjectKind, string> = {
    table: "Table",
    view: "View",
    procedure: "StoredProcedure",
    scalarFunction: "ScalarValuedFunction",
    tableFunction: "TableValuedFunction",
    synonym: "Synonym",
};

/** Stale-path honesty for folder ids the hierarchy registry doesn't know. */
function unknownFolderError(scope: string, connectionId: string, folder: string): OeV2Node[] {
    return [
        errorNode(
            scope,
            `Folder '${folder}' is not part of the current layout. Refresh the parent node.`,
            connectionId,
            "staleFolder",
        ),
    ];
}

// -- server level ------------------------------------------------------------

/** Item icons per aux folder (classic media/objectTypes assets). */
const AUX_ITEM_ICONS: Record<string, { icon: string; disabledIcon?: string }> = {
    "security/logins": { icon: "ServerLevelLogin", disabledIcon: "ServerLevelLogin_Disabled" },
    "security/serverRoles": { icon: "ServerLevelServerRole" },
    "security/credentials": { icon: "ServerLevelCredential" },
    "security/cryptographicProviders": { icon: "ServerLevelCryptographicProvider" },
    "security/serverAudits": { icon: "ServerLevelServerAudit" },
    "security/serverAuditSpecifications": { icon: "ServerLevelServerAuditSpecification" },
    "serverObjects/endpoints": { icon: "ServerLevelEndpoint" },
    "serverObjects/linkedServers": { icon: "ServerLevelLinkedServer" },
    "serverObjects/serverTriggers": {
        icon: "ServerLevelServerTrigger",
        disabledIcon: "ServerLevelServerTrigger_Disabled",
    },
    "serverObjects/errorMessages": { icon: "MessageType" },
};

/** Aux item facts as the pure layer needs them (service type stays out of tree/). */
export interface OeV2AuxItemFacts {
    readonly name: string;
    readonly schema?: string;
    readonly kind?: string;
    readonly subType?: string;
    readonly isSystem: boolean;
    readonly objectId?: number;
    readonly facts?: Readonly<Record<string, number>>;
}

export interface OeV2AuxSectionFacts {
    readonly readiness: "absent" | "loading" | "ready" | "failed";
    readonly errorMessage?: string;
}

/** Structural window onto an AuxiliaryCatalog (controller injects the real one). */
export interface OeV2AuxAccess {
    status(section: string): OeV2AuxSectionFacts | undefined;
    items(section: string): readonly OeV2AuxItemFacts[] | undefined;
}

function serverFolderNode(connectionId: string, def: OeV2FolderDef): OeV2Node {
    const path: OeV2Path = { kind: "serverFolder", connectionId, folder: def.id };
    return {
        id: encodePath(path),
        path,
        kind: "serverFolder",
        label: def.label,
        collapsible: true,
        connectionId,
        readiness: NOT_APPLICABLE,
        capabilities: { canRefresh: true, ...(def.canFilter ? { canFilter: true } : {}) },
        icon: def.icon ?? "Folder",
    };
}

/**
 * Children of a non-databases server folder (B23): parent folders render
 * their registry children (no IO); aux-backed leaves gate on section state
 * and render item leaf nodes. Failure/loading are explicit — never empty.
 */
export function serverAuxFolderChildren(
    connectionId: string,
    folder: string,
    facts: OeV2ScopeFacts,
    section: OeV2AuxSectionFacts | undefined,
    items: readonly OeV2AuxItemFacts[] | undefined,
): OeV2Node[] {
    const scope = `server/${connectionId}/aux/${folder}`;
    const def = folderDef("server", folder);
    if (!def) {
        return unknownFolderError(scope, connectionId, folder);
    }
    const subfolders = resolveFolders("server", facts, { parentId: def.id });
    if (subfolders.length > 0) {
        return subfolders.map((child) => serverFolderNode(connectionId, child));
    }
    if (!section || section.readiness === "absent" || section.readiness === "loading") {
        return [loadingNode(scope, connectionId)];
    }
    if (section.readiness === "failed" || !items) {
        return [
            errorNode(
                scope,
                `${def.label} unavailable: ${section.errorMessage ?? "section failed"}. Refresh to retry.`,
                connectionId,
            ),
        ];
    }
    if (items.length === 0) {
        return [noItemsNode(scope, connectionId)];
    }
    const icons = AUX_ITEM_ICONS[def.id];
    return items.map((item) => {
        const path: OeV2Path = {
            kind: "serverObjectItem",
            connectionId,
            folder: def.id,
            name: item.name,
        };
        const disabled = item.subType === "disabled";
        return {
            id: encodePath(path),
            path,
            kind: "serverObject",
            label: item.name,
            ...(disabled ? { description: "disabled" } : {}),
            collapsible: false,
            connectionId,
            readiness: NOT_APPLICABLE,
            capabilities: { canCopyName: true },
            icon: disabled && icons?.disabledIcon ? icons.disabledIcon : (icons?.icon ?? "Folder"),
        } satisfies OeV2Node;
    });
}

export function serverChildren(connectionId: string, facts: OeV2ScopeFacts = {}): OeV2Node[] {
    return resolveFolders("server", facts).map((def) => {
        const path: OeV2Path = { kind: "serverFolder", connectionId, folder: def.id };
        return {
            id: encodePath(path),
            path,
            kind: "serverFolder",
            label: def.label,
            collapsible: true,
            connectionId,
            readiness: NOT_APPLICABLE,
            capabilities: { canRefresh: true, ...(def.canFilter ? { canFilter: true } : {}) },
            icon: def.icon ?? "Folder",
        } satisfies OeV2Node;
    });
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
    // v1/SSMS parity (dogfood #6): system databases nest under a "System
    // Databases" folder that leads the list; user databases follow.
    const userDatabases = databases.filter((database) => database.isSystem !== true);
    const systemDatabases = showSystemDatabases
        ? databases.filter((database) => database.isSystem === true)
        : [];
    const children: OeV2Node[] = [
        ...(systemDatabases.length > 0 ? [systemDatabasesFolderNode(connectionId)] : []),
        ...userDatabases.map((database) => databaseNode(connectionId, database)),
    ];
    if (children.length === 0) {
        return withStaleNotice(scope, connectionId, [noItemsNode(scope, connectionId)], freshness);
    }
    return withStaleNotice(scope, connectionId, children, freshness);
}

/** The "System Databases" folder id in serverFolder paths. */
export const SYSTEM_DATABASES_FOLDER = "databases/system";

function systemDatabasesFolderNode(connectionId: string): OeV2Node {
    const path: OeV2Path = {
        kind: "serverFolder",
        connectionId,
        folder: SYSTEM_DATABASES_FOLDER,
    };
    return {
        id: encodePath(path),
        path,
        kind: "serverFolder",
        label: "System Databases",
        collapsible: true,
        connectionId,
        readiness: NOT_APPLICABLE,
        capabilities: { canRefresh: true },
        icon: "Folder",
    };
}

/** Children of the System Databases folder: the system databases only. */
export function systemDatabasesFolderChildren(
    connectionId: string,
    status: ServerCatalogStatus | undefined,
    view: IPinnedServerCatalogView | undefined,
    freshness?: OeV2FreshnessFacts,
): OeV2Node[] {
    const scope = `server/${connectionId}/${SYSTEM_DATABASES_FOLDER}`;
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
    const system = databases.filter((database) => database.isSystem === true);
    if (system.length === 0) {
        return withStaleNotice(scope, connectionId, [noItemsNode(scope, connectionId)], freshness);
    }
    return withStaleNotice(
        scope,
        connectionId,
        system.map((database) => databaseNode(connectionId, database)),
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

function databaseFolderNode(connectionId: string, database: string, def: OeV2FolderDef): OeV2Node {
    const path: OeV2Path = { kind: "databaseFolder", connectionId, database, folder: def.id };
    return {
        id: encodePath(path),
        path,
        kind: "databaseFolder",
        label: def.label,
        collapsible: true,
        connectionId,
        database,
        readiness: NOT_APPLICABLE,
        capabilities: { canRefresh: true, canFilter: def.canFilter === true },
        icon: def.icon ?? "Folder",
    };
}

export function databaseChildren(
    connectionId: string,
    database: string,
    facts: OeV2ScopeFacts = {},
): OeV2Node[] {
    return resolveFolders("database", facts).map((def) =>
        databaseFolderNode(connectionId, database, def),
    );
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

/** Sections served by the main catalog snapshot (vs lazy aux sections). */
const SNAPSHOT_SECTIONS = new Set(["objects", "synonyms", "schemas"]);

/** presence:"nonEmpty" check for facet-selected folders (dropped ledger,
 *  external tables) over facet items. */
function facetItemsExist(aux: OeV2AuxAccess | undefined, def: OeV2FolderDef): boolean {
    const flag = def.facetFlag ?? "isDroppedLedger";
    const items = aux?.items(def.section);
    return items !== undefined && items.some((item) => (item.facts?.[flag] ?? 0) === 1);
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
    facts: OeV2ScopeFacts = {},
    aux?: OeV2AuxAccess,
): OeV2Node[] {
    const scope = `db/${connectionId}/${database}/${folder}${schema ? `/${schema}` : ""}`;
    const def = folderDef("database", folder);
    if (!def) {
        return unknownFolderError(scope, connectionId, folder);
    }
    // Subfolders (System Tables, Dropped Ledger Tables, Programmability's
    // children, …) — never inside a group-by-schema schema node. STS
    // ordering: normal folders BEFORE items, sortLast folders AFTER.
    const subDefs =
        schema === undefined
            ? resolveFolders("database", facts, {
                  parentId: def.id,
                  hasItems: (child) =>
                      child.presence === "nonEmpty" ? facetItemsExist(aux, child) : true,
              })
            : [];
    const before = subDefs
        .filter((child) => !child.sortLast)
        .map((child) => databaseFolderNode(connectionId, database, child));
    const after = subDefs
        .filter((child) => child.sortLast)
        .map((child) => databaseFolderNode(connectionId, database, child));

    let content: OeV2Node[];
    if (def.special === "schemas" || SNAPSHOT_SECTIONS.has(def.section)) {
        const gate = catalogGate(scope, connectionId, status, snapshot, def.section);
        if (gate) {
            return [...before, ...gate, ...after];
        }
        content = withStaleNotice(
            scope,
            connectionId,
            databaseFolderContent(
                scope,
                connectionId,
                database,
                def,
                snapshot!,
                groupBySchema,
                schema,
                aux,
            ),
            freshness,
        );
    } else if (def.facetFlag === "isExternal" && def.objectKinds) {
        // External Tables (v1 parity): items are REAL catalog objects
        // selected from the snapshot by facet — columns expand and object
        // commands work exactly like the main table list.
        const gate = catalogGate(scope, connectionId, status, snapshot, "objects");
        if (gate) {
            return [...before, ...gate, ...after];
        }
        const facetsById = facetMap(aux, def.parentId ?? def.id);
        const objects = snapshot!
            .listObjects(schema, [...def.objectKinds])
            .filter((info) => (facetsById.get(info.objectId)?.[def.facetFlag] ?? 0) === 1);
        content = withStaleNotice(
            scope,
            connectionId,
            objects.length === 0
                ? [noItemsNode(scope, connectionId)]
                : objects.map((info) =>
                      objectNode(
                          connectionId,
                          database,
                          info.schema,
                          info.name,
                          info.kind as OeV2ObjectKind,
                          facetPresentation(facetsById.get(info.objectId)),
                      ),
                  ),
            freshness,
        );
    } else if (def.section === "aux") {
        // Pure parent folder: registry children ARE the content.
        content = before.length + after.length === 0 ? [noItemsNode(scope, connectionId)] : [];
    } else {
        content = databaseAuxLeafContent(scope, connectionId, database, def, facts, aux);
    }
    return [...before, ...content, ...after];
}

/** K3 exclusion: history/dropped/external rows never render in the main
 *  list — external tables live in their own folder (v1 parity). */
function visibleWithFacets(facetValues: Readonly<Record<string, number>> | undefined): boolean {
    if (!facetValues) {
        return true;
    }
    return (
        facetValues.temporalType !== 1 &&
        facetValues.ledgerType !== 1 &&
        facetValues.isDroppedLedger !== 1 &&
        facetValues.isExternal !== 1
    );
}

interface FacetPresentation {
    readonly suffix?: string;
    readonly icon?: string;
    readonly historyTableId?: number;
}

/** SSMS name suffixes + subtype icons (SmoTableCustomNode parity). */
function facetPresentation(
    facetValues: Readonly<Record<string, number>> | undefined,
): FacetPresentation {
    if (!facetValues) {
        return {};
    }
    const history =
        facetValues.historyTableId && facetValues.historyTableId > 0
            ? { historyTableId: facetValues.historyTableId }
            : {};
    if (facetValues.ledgerType === 2) {
        return { suffix: "(Updatable Ledger)", icon: "Table_Ledger", ...history };
    }
    if (facetValues.ledgerType === 3) {
        return { suffix: "(Append-Only Ledger)", icon: "Table_Ledger" };
    }
    if (facetValues.temporalType === 2) {
        return { suffix: "(System-Versioned)", icon: "Table_Temporal", ...history };
    }
    if (facetValues.isExternal === 1) {
        return { suffix: "(External)", icon: "ExternalTable" };
    }
    if (facetValues.isFileTable === 1) {
        return { suffix: "(FileTable)" };
    }
    if (facetValues.isNode === 1) {
        return { icon: "Table_GraphNode" };
    }
    if (facetValues.isEdge === 1) {
        return { icon: "Table_GraphEdge" };
    }
    return {};
}

const FACETS_SECTION_BY_FOLDER: Record<string, string> = {
    tables: "tableFacets",
    views: "viewFacets",
};

function facetMap(
    aux: OeV2AuxAccess | undefined,
    folderId: string,
): Map<number, Readonly<Record<string, number>>> {
    const map = new Map<number, Readonly<Record<string, number>>>();
    const section = FACETS_SECTION_BY_FOLDER[folderId];
    if (!section || !aux) {
        return map;
    }
    for (const item of aux.items(section) ?? []) {
        if (item.objectId !== undefined && item.facts) {
            map.set(item.objectId, item.facts);
        }
    }
    return map;
}

function databaseFolderContent(
    scope: string,
    connectionId: string,
    database: string,
    def: OeV2FolderDef,
    snapshot: CatalogSnapshot,
    groupBySchema: boolean,
    schema?: string,
    aux?: OeV2AuxAccess,
): OeV2Node[] {
    if (def.special === "schemas") {
        const schemas = snapshot.listSchemas();
        return schemas.length === 0
            ? [noItemsNode(scope, connectionId)]
            : schemas.map((info) => schemaNode(connectionId, database, info.name));
    }
    const objectKinds = [...(def.objectKinds ?? [])];
    const facets = facetMap(aux, def.id);
    if (groupBySchema && schema === undefined) {
        const withObjects = new Set(
            snapshot
                .listObjects(undefined, objectKinds)
                .filter((o) => visibleWithFacets(facets.get(o.objectId)))
                .map((o) => o.schema),
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
                folder: def.id,
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
    const objects = snapshot
        .listObjects(schema, objectKinds)
        .filter((info) => visibleWithFacets(facets.get(info.objectId)));
    if (objects.length === 0) {
        return [noItemsNode(scope, connectionId)];
    }
    return objects.map((info) =>
        objectNode(
            connectionId,
            database,
            info.schema,
            info.name,
            info.kind as OeV2ObjectKind,
            facetPresentation(facets.get(info.objectId)),
        ),
    );
}

/** Item icons per database aux folder (classic media/objectTypes assets). */
const DB_AUX_ITEM_ICONS: Record<string, { icon: string; disabledIcon?: string }> = {
    "security/users": { icon: "User", disabledIcon: "User_Disabled" },
    "security/roles/databaseRoles": { icon: "DatabaseRole" },
    "security/roles/applicationRoles": { icon: "ApplicationRole" },
    "security/asymmetricKeys": { icon: "AsymmetricKey" },
    "security/certificates": { icon: "Certificate" },
    "security/symmetricKeys": { icon: "SymmetricKey" },
    "security/databaseScopedCredentials": { icon: "DatabaseScopedCredential" },
    "security/databaseAuditSpecifications": { icon: "DatabaseAuditSpecification" },
    "security/securityPolicies": { icon: "SecurityPolicy" },
    "security/alwaysEncryptedKeys/columnMasterKeys": { icon: "ColumnMasterKey" },
    "security/alwaysEncryptedKeys/columnEncryptionKeys": { icon: "ColumnEncryptionKey" },
    "serviceBroker/messageTypes": { icon: "MessageType" },
    "serviceBroker/contracts": { icon: "Contract" },
    "serviceBroker/queues": { icon: "Queue" },
    "serviceBroker/services": { icon: "Service" },
    "serviceBroker/remoteServiceBindings": { icon: "RemoteServiceBinding" },
    "serviceBroker/brokerPriorities": { icon: "BrokerPriority" },
    "storage/fileGroups": { icon: "FileGroup" },
    "storage/fullTextCatalogs": { icon: "FullTextCatalog" },
    "storage/fullTextStopLists": { icon: "FullTextStopList" },
    "storage/logFiles": { icon: "FileGroupFile" },
    "storage/partitionFunctions": { icon: "PartitionFunction" },
    "storage/partitionSchemes": { icon: "PartitionScheme" },
    "storage/searchPropertyLists": { icon: "SearchPropertyList" },
    "programmability/databaseTriggers": {
        icon: "DatabaseTrigger",
        disabledIcon: "Trigger_Disabled",
    },
    "programmability/assemblies": { icon: "Assembly" },
    "programmability/sequences": { icon: "Sequence" },
    "programmability/types/userDefinedDataTypes": { icon: "UserDefinedDataType" },
    "programmability/types/userDefinedTableTypes": { icon: "UserDefinedTableType" },
    "programmability/types/xmlSchemaCollections": { icon: "XmlSchemaCollection" },
};

/**
 * Aux-backed database leaves (B24): security/broker/storage/programmability
 * items, K2 system-object folders, and dropped-ledger folders. Same honesty
 * gates as the server scope; K2 hides system items outside system databases
 * for sections that carry them.
 */
function databaseAuxLeafContent(
    scope: string,
    connectionId: string,
    database: string,
    def: OeV2FolderDef,
    facts: OeV2ScopeFacts,
    aux: OeV2AuxAccess | undefined,
): OeV2Node[] {
    const section = aux?.status(def.section);
    if (!section || section.readiness === "absent" || section.readiness === "loading") {
        return [loadingNode(scope, connectionId)];
    }
    const items = aux?.items(def.section);
    if (section.readiness === "failed" || !items) {
        return [
            errorNode(
                scope,
                `${def.label} unavailable: ${section.errorMessage ?? "section failed"}. Refresh to retry.`,
                connectionId,
            ),
        ];
    }
    let visible = [...items];
    if (def.section === "systemObjects") {
        visible = visible.filter(
            (item) => item.kind !== undefined && def.objectKinds?.includes(item.kind as never),
        );
    } else if (def.section === "tableFacets" || def.section === "viewFacets") {
        const flag = def.facetFlag ?? "isDroppedLedger";
        visible = visible.filter((item) => (item.facts?.[flag] ?? 0) === 1);
    }
    if (def.hideSystemItems && facts.isSystemDatabase !== true) {
        visible = visible.filter((item) => !item.isSystem);
    }
    if (visible.length === 0) {
        return [noItemsNode(scope, connectionId)];
    }
    const droppedLedger = def.section === "tableFacets" || def.section === "viewFacets";
    const icons = DB_AUX_ITEM_ICONS[def.id];
    return visible.map((item) => {
        const path: OeV2Path = {
            kind: "databaseObjectItem",
            connectionId,
            database,
            folder: def.id,
            name: item.schema ? `${item.schema}.${item.name}` : item.name,
        };
        const disabled = item.subType === "disabled";
        const icon =
            def.section === "systemObjects"
                ? OBJECT_ICONS[item.kind as OeV2ObjectKind]
                : droppedLedger
                  ? "Table_LedgerHistory"
                  : disabled && icons?.disabledIcon
                    ? icons.disabledIcon
                    : (icons?.icon ?? "Folder");
        return {
            id: encodePath(path),
            path,
            kind: "databaseObject",
            label: item.schema ? `${item.schema}.${item.name}` : item.name,
            ...(disabled ? { description: "disabled" } : {}),
            collapsible: false,
            connectionId,
            database,
            ...(item.schema ? { schema: item.schema, objectName: item.name } : {}),
            readiness: NOT_APPLICABLE,
            capabilities: {
                canCopyName: true,
                ...(item.schema ? { canCopyQualifiedName: true } : {}),
            },
            icon,
        } satisfies OeV2Node;
    });
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
    presentation: { suffix?: string; icon?: string } = {},
): OeV2Node {
    const path: OeV2Path = { kind: "object", connectionId, database, schema, name, objectKind };
    const isTable = objectKind === "table";
    return {
        id: encodePath(path),
        path,
        kind: "object",
        label: presentation.suffix
            ? `${schema}.${name} ${presentation.suffix}`
            : `${schema}.${name}`,
        collapsible: objectKind !== "synonym",
        connectionId,
        database,
        schema,
        objectName: name,
        readiness: NOT_APPLICABLE,
        capabilities: {
            canCopyName: true,
            canCopyQualifiedName: true,
            canGenerateScript: true,
            ...(isTable || objectKind === "view" ? { canSelectTop: true } : {}),
            ...(objectKind === "procedure" ? { canScriptExecute: true } : {}),
        },
        icon: presentation.icon ?? OBJECT_ICONS[objectKind],
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

export function objectChildren(
    path: Extract<OeV2Path, { kind: "object" }>,
    historyTable?: { schema: string; name: string },
): OeV2Node[] {
    // K3: a system-versioned/updatable-ledger table nests its history table
    // FIRST (SSMS SqlHistoryTableQuerier parity), then the child folders.
    const history = historyTable
        ? [
              objectNode(
                  path.connectionId,
                  path.database,
                  historyTable.schema,
                  historyTable.name,
                  "table",
                  { suffix: "(History)", icon: "HistoryTable" },
              ),
          ]
        : [];
    return history.concat(objectChildFolders(path));
}

function objectChildFolders(path: Extract<OeV2Path, { kind: "object" }>): OeV2Node[] {
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
