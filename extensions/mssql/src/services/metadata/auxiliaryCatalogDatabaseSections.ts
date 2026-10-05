/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Database-scoped auxiliary sections (B24, OE_V1_PARITY_PLAN §2.2/§2.3):
 * SSMS-parity Security/Service Broker/Storage/Programmability leaves, the
 * K2 system-objects listing (kept OUT of H2 so completions and schema-
 * context goldens never see MS-shipped objects), and the K3 table/view
 * facets that drive ledger/temporal organization. All lazy, one query per
 * section, per-section failure honesty — same engine as the server scope.
 */

import { AuxCatalogItem, AuxSectionSpec } from "./auxiliaryCatalog";

const num = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

const truthy = (value: unknown): boolean => value === true || num(value) === 1;

const mapNameOnly = (row: unknown[]): AuxCatalogItem | undefined =>
    row[0] === null || row[0] === undefined ? undefined : { name: String(row[0]), isSystem: false };

const mapSchemaQualified = (row: unknown[]): AuxCatalogItem | undefined =>
    row[0] === null || row[0] === undefined
        ? undefined
        : {
              name: String(row[0]),
              ...(row[1] !== null && row[1] !== undefined ? { schema: String(row[1]) } : {}),
              isSystem: false,
          };

/**
 * Table facets (K3): version-tolerant via sp_executesql — the column list is
 * assembled from COL_LENGTH probes so one query serves 2016 through 2022+.
 * Pre-2016 servers fail the section and browse renders flat, like today.
 */
const TABLE_FACETS_SQL = [
    "DECLARE @sql nvarchar(max) = N'SELECT t.object_id, t.name, SCHEMA_NAME(t.schema_id), ' + ",
    "CASE WHEN COL_LENGTH('sys.tables','temporal_type') IS NULL THEN N'0, 0' ",
    "ELSE N't.temporal_type, COALESCE(t.history_table_id, 0)' END + N', ' + ",
    "CASE WHEN COL_LENGTH('sys.tables','ledger_type') IS NULL THEN N'0, 0' ",
    "ELSE N't.ledger_type, CASE WHEN t.is_dropped_ledger_table = 1 THEN 1 ELSE 0 END' END + N', ' + ",
    "CASE WHEN COL_LENGTH('sys.tables','is_external') IS NULL THEN N'0' ",
    "ELSE N'CAST(t.is_external AS int)' END + N', ' + ",
    "CASE WHEN COL_LENGTH('sys.tables','is_node') IS NULL THEN N'0, 0' ",
    "ELSE N'CAST(t.is_node AS int), CAST(t.is_edge AS int)' END + N', ' + ",
    "CASE WHEN COL_LENGTH('sys.tables','is_filetable') IS NULL THEN N'0' ",
    "ELSE N'CAST(t.is_filetable AS int)' END + ",
    "N' FROM sys.tables t ORDER BY t.object_id'; EXEC sp_executesql @sql;",
].join("");

const VIEW_FACETS_SQL = [
    "DECLARE @vsql nvarchar(max) = N'SELECT v.object_id, v.name, SCHEMA_NAME(v.schema_id), ' + ",
    "CASE WHEN COL_LENGTH('sys.views','is_dropped_ledger_view') IS NULL THEN N'0' ",
    "ELSE N'CASE WHEN v.is_dropped_ledger_view = 1 THEN 1 ELSE 0 END' END + ",
    "N' FROM sys.views v ORDER BY v.object_id'; EXEC sp_executesql @vsql;",
].join("");

const mapTableFacets = (row: unknown[]): AuxCatalogItem | undefined =>
    row[0] === null || row[0] === undefined
        ? undefined
        : {
              name: String(row[1] ?? ""),
              ...(row[2] !== null && row[2] !== undefined ? { schema: String(row[2]) } : {}),
              kind: "table",
              isSystem: false,
              objectId: num(row[0]),
              facts: {
                  temporalType: num(row[3]),
                  historyTableId: num(row[4]),
                  ledgerType: num(row[5]),
                  isDroppedLedger: num(row[6]),
                  isExternal: num(row[7]),
                  isNode: num(row[8]),
                  isEdge: num(row[9]),
                  isFileTable: num(row[10]),
              },
          };

const mapViewFacets = (row: unknown[]): AuxCatalogItem | undefined =>
    row[0] === null || row[0] === undefined
        ? undefined
        : {
              name: String(row[1] ?? ""),
              ...(row[2] !== null && row[2] !== undefined ? { schema: String(row[2]) } : {}),
              kind: "view",
              isSystem: false,
              objectId: num(row[0]),
              facts: { isDroppedLedger: num(row[3]) },
          };

const mapSystemObject = (row: unknown[]): AuxCatalogItem | undefined => {
    if (row[0] === null || row[0] === undefined) {
        return undefined;
    }
    const type = String(row[2] ?? "");
    const kind =
        type === "U"
            ? "table"
            : type === "V"
              ? "view"
              : type === "P"
                ? "procedure"
                : type === "FN"
                  ? "scalarFunction"
                  : "tableFunction";
    return {
        name: String(row[0]),
        ...(row[1] !== null && row[1] !== undefined ? { schema: String(row[1]) } : {}),
        kind,
        isSystem: true,
    };
};

export const DATABASE_AUX_SECTIONS: readonly AuxSectionSpec[] = [
    { key: "tableFacets", scope: "database", sql: TABLE_FACETS_SQL, map: mapTableFacets },
    { key: "viewFacets", scope: "database", sql: VIEW_FACETS_SQL, map: mapViewFacets },
    {
        key: "systemObjects",
        scope: "database",
        sql:
            "SELECT o.name, SCHEMA_NAME(o.schema_id) AS schema_name, RTRIM(o.type) AS type " +
            "FROM sys.objects o WHERE o.type IN ('U','V','P','FN','IF','TF') " +
            "AND o.is_ms_shipped = 1 ORDER BY SCHEMA_NAME(o.schema_id), o.name;",
        map: mapSystemObject,
    },
    {
        key: "security/users",
        scope: "database",
        sql:
            "SELECT p.name, p.principal_id FROM sys.database_principals p " +
            "WHERE p.type IN ('S','U','G','C','K','E','X') AND p.name NOT LIKE '##%' " +
            "ORDER BY p.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : { name: String(row[0]), isSystem: num(row[1]) <= 4 },
    },
    {
        key: "security/roles/databaseRoles",
        scope: "database",
        sql:
            "SELECT p.name, p.is_fixed_role FROM sys.database_principals p " +
            "WHERE p.type = 'R' ORDER BY p.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: String(row[0]),
                      isSystem: truthy(row[1]) || String(row[0]) === "public",
                  },
    },
    {
        key: "security/roles/applicationRoles",
        scope: "database",
        sql: "SELECT p.name FROM sys.database_principals p WHERE p.type = 'A' ORDER BY p.name;",
        map: mapNameOnly,
    },
    {
        key: "security/asymmetricKeys",
        scope: "database",
        sql: "SELECT k.name FROM sys.asymmetric_keys k ORDER BY k.name;",
        map: mapNameOnly,
    },
    {
        key: "security/certificates",
        scope: "database",
        sql: "SELECT c.name FROM sys.certificates c ORDER BY c.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : { name: String(row[0]), isSystem: String(row[0]).startsWith("##") },
    },
    {
        key: "security/symmetricKeys",
        scope: "database",
        sql: "SELECT k.name FROM sys.symmetric_keys k ORDER BY k.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : { name: String(row[0]), isSystem: String(row[0]).startsWith("##") },
    },
    {
        key: "security/databaseScopedCredentials",
        scope: "database",
        sql: "SELECT c.name FROM sys.database_scoped_credentials c ORDER BY c.name;",
        map: mapNameOnly,
    },
    {
        key: "security/databaseAuditSpecifications",
        scope: "database",
        sql:
            "SELECT s.name, s.is_state_enabled FROM sys.database_audit_specifications s " +
            "ORDER BY s.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: String(row[0]),
                      isSystem: false,
                      ...(truthy(row[1]) ? {} : { subType: "disabled" }),
                  },
    },
    {
        key: "security/securityPolicies",
        scope: "database",
        sql:
            "SELECT p.name, SCHEMA_NAME(p.schema_id) AS schema_name FROM sys.security_policies p " +
            "ORDER BY p.name;",
        map: mapSchemaQualified,
    },
    {
        key: "security/alwaysEncryptedKeys/columnMasterKeys",
        scope: "database",
        sql: "SELECT k.name FROM sys.column_master_keys k ORDER BY k.name;",
        map: mapNameOnly,
    },
    {
        key: "security/alwaysEncryptedKeys/columnEncryptionKeys",
        scope: "database",
        sql: "SELECT k.name FROM sys.column_encryption_keys k ORDER BY k.name;",
        map: mapNameOnly,
    },
    {
        key: "serviceBroker/messageTypes",
        scope: "database",
        sql: "SELECT m.name, m.message_type_id FROM sys.service_message_types m ORDER BY m.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : { name: String(row[0]), isSystem: num(row[1]) <= 65535 },
    },
    {
        key: "serviceBroker/contracts",
        scope: "database",
        sql: "SELECT c.name, c.service_contract_id FROM sys.service_contracts c ORDER BY c.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : { name: String(row[0]), isSystem: num(row[1]) <= 65535 },
    },
    {
        key: "serviceBroker/queues",
        scope: "database",
        sql:
            "SELECT q.name, SCHEMA_NAME(q.schema_id) AS schema_name, q.is_ms_shipped " +
            "FROM sys.service_queues q ORDER BY q.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: String(row[0]),
                      ...(row[1] !== null && row[1] !== undefined
                          ? { schema: String(row[1]) }
                          : {}),
                      isSystem: truthy(row[2]),
                  },
    },
    {
        key: "serviceBroker/services",
        scope: "database",
        sql: "SELECT s.name, s.service_id FROM sys.services s ORDER BY s.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : { name: String(row[0]), isSystem: num(row[1]) <= 3 },
    },
    {
        key: "serviceBroker/remoteServiceBindings",
        scope: "database",
        sql: "SELECT b.name FROM sys.remote_service_bindings b ORDER BY b.name;",
        map: mapNameOnly,
    },
    {
        key: "serviceBroker/brokerPriorities",
        scope: "database",
        sql: "SELECT p.name FROM sys.conversation_priorities p ORDER BY p.name;",
        map: mapNameOnly,
    },
    {
        key: "storage/fileGroups",
        scope: "database",
        sql: "SELECT g.name FROM sys.filegroups g ORDER BY g.name;",
        map: mapNameOnly,
    },
    {
        key: "storage/fullTextCatalogs",
        scope: "database",
        sql: "SELECT c.name FROM sys.fulltext_catalogs c ORDER BY c.name;",
        map: mapNameOnly,
    },
    {
        key: "storage/fullTextStopLists",
        scope: "database",
        sql: "SELECT l.name FROM sys.fulltext_stoplists l ORDER BY l.name;",
        map: mapNameOnly,
    },
    {
        key: "storage/logFiles",
        scope: "database",
        sql: "SELECT f.name FROM sys.database_files f WHERE f.type_desc = 'LOG' ORDER BY f.name;",
        map: mapNameOnly,
    },
    {
        key: "storage/partitionFunctions",
        scope: "database",
        sql: "SELECT f.name FROM sys.partition_functions f ORDER BY f.name;",
        map: mapNameOnly,
    },
    {
        key: "storage/partitionSchemes",
        scope: "database",
        sql: "SELECT s.name FROM sys.partition_schemes s ORDER BY s.name;",
        map: mapNameOnly,
    },
    {
        key: "storage/searchPropertyLists",
        scope: "database",
        sql: "SELECT l.name FROM sys.registered_search_property_lists l ORDER BY l.name;",
        map: mapNameOnly,
    },
    {
        key: "programmability/databaseTriggers",
        scope: "database",
        sql:
            "SELECT t.name, t.is_disabled FROM sys.triggers t WHERE t.parent_class = 0 " +
            "ORDER BY t.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: String(row[0]),
                      isSystem: false,
                      ...(truthy(row[1]) ? { subType: "disabled" } : {}),
                  },
    },
    {
        key: "programmability/assemblies",
        scope: "database",
        sql: "SELECT a.name, a.is_user_defined FROM sys.assemblies a ORDER BY a.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : { name: String(row[0]), isSystem: !truthy(row[1]) },
    },
    {
        key: "programmability/sequences",
        scope: "database",
        sql:
            "SELECT s.name, SCHEMA_NAME(s.schema_id) AS schema_name FROM sys.sequences s " +
            "ORDER BY SCHEMA_NAME(s.schema_id), s.name;",
        map: mapSchemaQualified,
    },
    {
        key: "programmability/types/userDefinedDataTypes",
        scope: "database",
        sql:
            "SELECT t.name, SCHEMA_NAME(t.schema_id) AS schema_name FROM sys.types t " +
            "WHERE t.is_user_defined = 1 AND t.is_table_type = 0 " +
            "ORDER BY SCHEMA_NAME(t.schema_id), t.name;",
        map: mapSchemaQualified,
    },
    {
        key: "programmability/types/userDefinedTableTypes",
        scope: "database",
        sql:
            "SELECT t.name, SCHEMA_NAME(t.schema_id) AS schema_name FROM sys.table_types t " +
            "WHERE t.is_user_defined = 1 ORDER BY SCHEMA_NAME(t.schema_id), t.name;",
        map: mapSchemaQualified,
    },
    {
        key: "programmability/types/xmlSchemaCollections",
        scope: "database",
        sql:
            "SELECT x.name, SCHEMA_NAME(x.schema_id) AS schema_name " +
            "FROM sys.xml_schema_collections x WHERE x.xml_collection_id > 1 " +
            "ORDER BY SCHEMA_NAME(x.schema_id), x.name;",
        map: mapSchemaQualified,
    },
];
