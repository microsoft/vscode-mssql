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
    const type = String(row[3] ?? "");
    const kind =
        type === "U"
            ? "table"
            : type === "V"
              ? "view"
              : type === "P" || type === "PC" || type === "X"
                ? "procedure"
                : type === "FN" || type === "FS" || type === "AF"
                  ? "scalarFunction"
                  : type === "SN"
                    ? "synonym"
                    : "tableFunction";
    return {
        name: String(row[1] ?? ""),
        ...(row[2] !== null && row[2] !== undefined ? { schema: String(row[2]) } : {}),
        kind,
        isSystem: true,
        objectId: num(row[0]),
        attributes: {
            objectType: type,
            schemaBound: truthy(row[4]),
            checkOption: truthy(row[5]),
            extendedProcedure: type === "X",
            ...(row[6] !== null && row[6] !== undefined ? { returnType: String(row[6]) } : {}),
        },
    };
};

const text = (value: unknown): string | undefined =>
    value === null || value === undefined ? undefined : String(value);

const SYSTEM_OBJECTS_SQL =
    "SELECT o.object_id, o.name, SCHEMA_NAME(o.schema_id) AS schema_name, RTRIM(o.type) AS type, " +
    "CONVERT(int, ISNULL(OBJECTPROPERTYEX(o.object_id, 'IsSchemaBound'), 0)) AS is_schema_bound, " +
    "CONVERT(int, ISNULL(v.with_check_option, 0)) AS with_check_option, " +
    "CASE WHEN p.object_id IS NULL THEN NULL ELSE " +
    "QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name) + " +
    "CASE WHEN t.name IN (N'varchar',N'char',N'varbinary',N'binary') THEN N'(' + CASE WHEN p.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), p.max_length) END + N')' " +
    "WHEN t.name IN (N'nvarchar',N'nchar') THEN N'(' + CASE WHEN p.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), p.max_length / 2) END + N')' " +
    "WHEN t.name IN (N'decimal',N'numeric') THEN N'(' + CONVERT(nvarchar(10), p.precision) + N',' + CONVERT(nvarchar(10), p.scale) + N')' ELSE N'' END END AS return_type " +
    "FROM sys.system_objects o LEFT JOIN sys.views v ON v.object_id = o.object_id " +
    "LEFT JOIN sys.all_parameters p ON p.object_id = o.object_id AND p.parameter_id = 0 " +
    "LEFT JOIN sys.types t ON t.user_type_id = p.user_type_id " +
    "WHERE o.type IN ('U','V','P','FN','IF','TF','SN','PC','FS','FT','AF','X') " +
    "ORDER BY o.object_id;";

const SYSTEM_COLUMNS_SQL =
    "SELECT c.object_id, c.column_id, c.name, t.name, c.max_length, c.precision, c.scale, " +
    "c.is_nullable, c.is_identity, c.is_computed, " +
    "CONVERT(int, ISNULL(COLUMNPROPERTY(c.object_id, c.name, 'IsHidden'), 0)) AS is_hidden " +
    "FROM sys.all_columns c JOIN sys.types t ON t.user_type_id = c.user_type_id " +
    "JOIN sys.system_objects o ON o.object_id = c.object_id " +
    "WHERE o.type IN ('U','V','IF','TF','FT') ORDER BY c.object_id, c.column_id;";

const HIDDEN_COLUMNS_SQL =
    "SELECT c.object_id, c.column_id, c.name, t.name, c.max_length, c.precision, c.scale, " +
    "c.is_nullable, c.is_identity, c.is_computed, 1 AS is_hidden " +
    "FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id " +
    "WHERE ISNULL(COLUMNPROPERTY(c.object_id, c.name, 'IsHidden'), 0)=1 " +
    "ORDER BY c.object_id,c.column_id;";

const SYSTEM_PARAMETERS_SQL =
    "SELECT p.object_id, p.parameter_id, p.name, t.name, p.max_length, p.precision, p.scale, p.is_output " +
    "FROM sys.all_parameters p JOIN sys.types t ON t.user_type_id=p.user_type_id " +
    "JOIN sys.system_objects o ON o.object_id=p.object_id " +
    "WHERE o.type IN ('P','FN','IF','TF','PC','FS','FT','AF','X') ORDER BY p.object_id,p.parameter_id;";

const INDEXES_AND_STATISTICS_SQL =
    "SELECT i.object_id, i.index_id, i.name, i.type, i.is_unique, " +
    "CASE WHEN i.type IN (1,5) THEN 1 ELSE 0 END AS is_clustered, 0 AS is_statistics, " +
    "ic.key_ordinal, ic.is_included_column, ic.is_descending_key, c.name AS column_name " +
    "FROM sys.indexes i LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id " +
    "LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id " +
    "WHERE i.name IS NOT NULL AND i.is_hypothetical=0 " +
    "UNION ALL " +
    "SELECT s.object_id, s.stats_id, s.name, 0, 0, 0, 1, sc.stats_column_id, 0, 0, c.name " +
    "FROM sys.stats s JOIN sys.stats_columns sc ON sc.object_id=s.object_id AND sc.stats_id=s.stats_id " +
    "JOIN sys.columns c ON c.object_id=sc.object_id AND c.column_id=sc.column_id " +
    "WHERE NOT EXISTS (SELECT 1 FROM sys.indexes i WHERE i.object_id=s.object_id AND i.index_id=s.stats_id AND i.name=s.name) " +
    "ORDER BY object_id, is_statistics, index_id, key_ordinal;";

const TRIGGERS_SQL =
    "SELECT t.parent_id, t.object_id, t.name, t.is_instead_of_trigger, t.is_disabled, " +
    "CONVERT(int, OBJECTPROPERTYEX(t.object_id, 'ExecIsInsertTrigger')), " +
    "CONVERT(int, OBJECTPROPERTYEX(t.object_id, 'ExecIsUpdateTrigger')), " +
    "CONVERT(int, OBJECTPROPERTYEX(t.object_id, 'ExecIsDeleteTrigger')) " +
    "FROM sys.triggers t WHERE t.parent_class = 1 ORDER BY t.parent_id, t.object_id;";

const USER_TYPES_SQL =
    "SELECT t.user_type_id, t.name, SCHEMA_NAME(t.schema_id), " +
    "CASE WHEN t.is_table_type=1 THEN N'table' WHEN t.is_assembly_type=1 THEN N'clr' ELSE N'alias' END, " +
    "t.is_assembly_type, a.name, at.assembly_class " +
    "FROM sys.types t LEFT JOIN sys.assembly_types at ON at.user_type_id=t.user_type_id " +
    "LEFT JOIN sys.assemblies a ON a.assembly_id=at.assembly_id " +
    "WHERE t.is_user_defined=1 OR t.is_assembly_type=1 ORDER BY t.user_type_id;";

const OBJECT_FACTS_SQL =
    "SELECT o.object_id, RTRIM(o.type), " +
    "CONVERT(int, ISNULL(OBJECTPROPERTYEX(o.object_id, 'IsSchemaBound'), 0)), " +
    "CONVERT(int, ISNULL(v.with_check_option, 0)), " +
    "CASE WHEN p.object_id IS NULL THEN NULL ELSE " +
    "QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name) + " +
    "CASE WHEN t.name IN (N'varchar',N'char',N'varbinary',N'binary') THEN N'(' + CASE WHEN p.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), p.max_length) END + N')' " +
    "WHEN t.name IN (N'nvarchar',N'nchar') THEN N'(' + CASE WHEN p.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), p.max_length / 2) END + N')' " +
    "WHEN t.name IN (N'decimal',N'numeric') THEN N'(' + CONVERT(nvarchar(10), p.precision) + N',' + CONVERT(nvarchar(10), p.scale) + N')' ELSE N'' END END " +
    "FROM sys.objects o LEFT JOIN sys.views v ON v.object_id=o.object_id " +
    "LEFT JOIN sys.parameters p ON p.object_id=o.object_id AND p.parameter_id=0 " +
    "LEFT JOIN sys.types t ON t.user_type_id=p.user_type_id " +
    "WHERE o.type IN ('U','V','P','FN','IF','TF','SN','PC','FS','FT','AF','X') ORDER BY o.object_id;";

const PRINCIPALS_SQL =
    "SELECT p.principal_id, p.name, RTRIM(p.type), " +
    "CASE WHEN p.principal_id <= 4 OR p.is_fixed_role=1 THEN 1 ELSE 0 END " +
    "FROM sys.database_principals p WHERE p.name NOT LIKE '##%' " +
    "AND p.type IN ('S','U','G','C','K','E','X','R','A') ORDER BY p.principal_id;";

const SECURABLES_SQL =
    "SELECT N'certificate', c.certificate_id, c.name FROM sys.certificates c " +
    "UNION ALL SELECT N'asymmetricKey', k.asymmetric_key_id, k.name FROM sys.asymmetric_keys k " +
    "ORDER BY 1, 2;";

const COLLATIONS_SQL = "SELECT name FROM sys.fn_helpcollations() ORDER BY name;";

// Fast cross-database identity pass. It deliberately avoids columns, keys, parameters, and
// descriptions so three-part-name completion does not wait for the full H0-H7 catalog ladder.
const LANGUAGE_IDENTITY_SQL =
    "SELECT N'schema', s.schema_id, s.name, NULL, NULL, 0, NULL FROM sys.schemas s " +
    "UNION ALL " +
    "SELECT N'object', o.object_id, o.name, SCHEMA_NAME(o.schema_id), RTRIM(o.type), 0, NULL " +
    "FROM sys.objects o WHERE o.type IN ('U','V','P','FN','IF','TF','SN','PC','FS','FT','AF','X') AND o.is_ms_shipped=0 " +
    "UNION ALL " +
    "SELECT N'object', o.object_id, o.name, SCHEMA_NAME(o.schema_id), RTRIM(o.type), 1, NULL " +
    "FROM sys.system_objects o WHERE o.type IN ('U','V','P','FN','IF','TF','SN','PC','FS','FT','AF','X') " +
    "UNION ALL " +
    "SELECT N'type', t.user_type_id, t.name, SCHEMA_NAME(t.schema_id), N'TT', 0, " +
    "CASE WHEN t.is_table_type=1 THEN N'table' WHEN t.is_assembly_type=1 THEN N'clr' ELSE N'alias' END " +
    "FROM sys.types t WHERE t.is_user_defined=1 OR t.is_assembly_type=1 " +
    "ORDER BY 1, 2;";

export const DATABASE_AUX_SECTIONS: readonly AuxSectionSpec[] = [
    {
        key: "language/identity",
        scope: "database",
        sql: LANGUAGE_IDENTITY_SQL,
        map: (row) => {
            if (row[0] === null || row[1] === null || row[2] === null) return undefined;
            const entry = String(row[0]);
            const objectType = text(row[4]);
            const kind =
                entry === "schema"
                    ? "schema"
                    : entry === "type"
                      ? "type"
                      : objectType === "U"
                        ? "table"
                        : objectType === "V"
                          ? "view"
                          : objectType === "P" || objectType === "PC" || objectType === "X"
                            ? "procedure"
                            : objectType === "FN" || objectType === "FS" || objectType === "AF"
                              ? "scalarFunction"
                              : objectType === "SN"
                                ? "synonym"
                                : "tableFunction";
            return {
                name: String(row[2]),
                ...(text(row[3]) ? { schema: String(row[3]) } : {}),
                kind,
                isSystem: truthy(row[5]),
                objectId: num(row[1]),
                attributes: {
                    entry,
                    objectType,
                    typeCategory: text(row[6]),
                },
            };
        },
    },
    { key: "tableFacets", scope: "database", sql: TABLE_FACETS_SQL, map: mapTableFacets },
    { key: "viewFacets", scope: "database", sql: VIEW_FACETS_SQL, map: mapViewFacets },
    {
        key: "systemObjects",
        scope: "database",
        sql: SYSTEM_OBJECTS_SQL,
        map: mapSystemObject,
    },
    {
        key: "language/systemColumns",
        scope: "database",
        sql: SYSTEM_COLUMNS_SQL,
        map: (row) =>
            row[0] === null || row[0] === undefined || row[2] === null || row[2] === undefined
                ? undefined
                : {
                      name: String(row[2]),
                      isSystem: true,
                      objectId: num(row[0]),
                      facts: { columnId: num(row[1]) },
                      attributes: {
                          typeName: text(row[3]),
                          maxLength: num(row[4]),
                          precision: num(row[5]),
                          scale: num(row[6]),
                          nullable: truthy(row[7]),
                          identity: truthy(row[8]),
                          computed: truthy(row[9]),
                          hidden: truthy(row[10]),
                      },
                  },
    },
    {
        key: "language/systemParameters",
        scope: "database",
        sql: SYSTEM_PARAMETERS_SQL,
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: text(row[2]) ?? "",
                      isSystem: true,
                      objectId: num(row[0]),
                      facts: { ordinal: num(row[1]) },
                      attributes: {
                          typeName: text(row[3]),
                          maxLength: num(row[4]),
                          precision: num(row[5]),
                          scale: num(row[6]),
                          output: truthy(row[7]),
                      },
                  },
    },
    {
        key: "language/hiddenColumns",
        scope: "database",
        sql: HIDDEN_COLUMNS_SQL,
        map: (row) =>
            row[0] === null || row[0] === undefined || row[2] === null || row[2] === undefined
                ? undefined
                : {
                      name: String(row[2]),
                      isSystem: false,
                      objectId: num(row[0]),
                      facts: { columnId: num(row[1]) },
                      attributes: {
                          typeName: text(row[3]),
                          maxLength: num(row[4]),
                          precision: num(row[5]),
                          scale: num(row[6]),
                          nullable: truthy(row[7]),
                          identity: truthy(row[8]),
                          computed: truthy(row[9]),
                          hidden: true,
                      },
                  },
    },
    {
        key: "language/indexes",
        scope: "database",
        sql: INDEXES_AND_STATISTICS_SQL,
        map: (row) =>
            row[0] === null || row[0] === undefined || row[2] === null || row[2] === undefined
                ? undefined
                : {
                      name: String(row[2]),
                      isSystem: false,
                      objectId: num(row[0]),
                      facts: {
                          indexId: num(row[1]),
                          sqlType: num(row[3]),
                          keyOrdinal: num(row[7]),
                      },
                      attributes: {
                          unique: truthy(row[4]),
                          clustered: truthy(row[5]),
                          statistics: truthy(row[6]),
                          included: truthy(row[8]),
                          descending: truthy(row[9]),
                          columnName: text(row[10]),
                      },
                  },
    },
    {
        key: "language/triggers",
        scope: "database",
        sql: TRIGGERS_SQL,
        map: (row) =>
            row[0] === null || row[0] === undefined || row[2] === null || row[2] === undefined
                ? undefined
                : {
                      name: String(row[2]),
                      isSystem: false,
                      objectId: num(row[0]),
                      facts: { triggerId: num(row[1]) },
                      attributes: {
                          insteadOf: truthy(row[3]),
                          disabled: truthy(row[4]),
                          insert: truthy(row[5]),
                          update: truthy(row[6]),
                          delete: truthy(row[7]),
                      },
                  },
    },
    {
        key: "language/userTypes",
        scope: "database",
        sql: USER_TYPES_SQL,
        map: (row) =>
            row[0] === null || row[0] === undefined || row[1] === null || row[1] === undefined
                ? undefined
                : {
                      name: String(row[1]),
                      ...(text(row[2]) ? { schema: text(row[2]) } : {}),
                      kind: "type",
                      isSystem: false,
                      objectId: num(row[0]),
                      attributes: {
                          typeCategory: text(row[3]),
                          assemblyType: truthy(row[4]),
                          assemblyName: text(row[5]),
                          className: text(row[6]),
                      },
                  },
    },
    {
        key: "language/objectFacts",
        scope: "database",
        sql: OBJECT_FACTS_SQL,
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: String(row[0]),
                      isSystem: false,
                      objectId: num(row[0]),
                      attributes: {
                          objectType: text(row[1]),
                          schemaBound: truthy(row[2]),
                          checkOption: truthy(row[3]),
                          extendedProcedure: text(row[1]) === "X",
                          returnType: text(row[4]),
                      },
                  },
    },
    {
        key: "language/principals",
        scope: "database",
        sql: PRINCIPALS_SQL,
        map: (row) =>
            row[0] === null || row[0] === undefined || row[1] === null || row[1] === undefined
                ? undefined
                : {
                      name: String(row[1]),
                      kind: text(row[2]),
                      isSystem: truthy(row[3]),
                      objectId: num(row[0]),
                  },
    },
    {
        key: "language/securables",
        scope: "database",
        sql: SECURABLES_SQL,
        map: (row) =>
            row[0] === null || row[0] === undefined || row[2] === null || row[2] === undefined
                ? undefined
                : {
                      name: String(row[2]),
                      kind: String(row[0]),
                      isSystem: false,
                      objectId: num(row[1]),
                  },
    },
    {
        key: "language/collations",
        scope: "database",
        sql: COLLATIONS_SQL,
        map: mapNameOnly,
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
