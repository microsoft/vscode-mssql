/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PlatformFeature } from "./platformFeatureRegistry.js";

/** Declarative platform/version feature data, separated from availability evaluation. */
export const platformFeatures: readonly PlatformFeature[] = Object.freeze([
    // ---------------------------------------------------------------- removed boxed-server syntax
    {
        id: "statement.disk-init",
        displayName: "The DISK INIT and DISK RESIZE statements",
        family: "server",
        keyword: "DISK",
        nodes: ["LegacyDiskStatement"],
        maximumCompatibility: 80,
        statementUnavailable: true,
        evidence:
            "ScriptDOM parses DISK INIT/RESIZE only through TSql80Parser; TestScripts/MiscTests80.sql.",
    },
    {
        id: "statement.dump",
        displayName: "The DUMP statement",
        family: "backup",
        keyword: "DUMP",
        nodes: ["BackupStatement"],
        textPattern: /^\s*DUMP\b/iu,
        maximumCompatibility: 90,
        statementUnavailable: true,
        evidence:
            "ScriptDOM TestScripts/DumpLoadStatementTests.sql parses under 80/90 parsers only.",
    },
    {
        id: "statement.load",
        displayName: "The LOAD statement",
        family: "backup",
        keyword: "LOAD",
        nodes: ["RestoreStatement"],
        textPattern: /^\s*LOAD\b/iu,
        maximumCompatibility: 90,
        statementUnavailable: true,
        evidence:
            "ScriptDOM TestScripts/DumpLoadStatementTests.sql parses under 80/90 parsers only.",
    },

    // ------------------------------------------------------------- boxed-server-only surface area
    {
        id: "statement.backup",
        displayName: "The BACKUP statement",
        family: "backup",
        keyword: "BACKUP",
        nodes: ["BackupStatement"],
        textPattern: /^\s*BACKUP\b/iu,
        // Managed Instance keeps BACKUP because it is instance-scoped and supports COPY_ONLY
        // backups to URL. Azure SQL Database and the analytics engines have no backup surface.
        profiles: ["sql-server", "azure-sql-managed-instance"],
        evidence:
            "Azure SQL Database exposes no BACKUP surface; Managed Instance keeps BACKUP DATABASE TO URL.",
    },
    {
        id: "statement.restore",
        displayName: "The RESTORE statement",
        family: "backup",
        keyword: "RESTORE",
        nodes: ["RestoreStatement"],
        textPattern: /^\s*RESTORE\b/iu,
        profiles: ["sql-server", "azure-sql-managed-instance"],
        evidence:
            "Azure SQL Database exposes no RESTORE surface; Managed Instance keeps RESTORE FROM URL.",
    },
    {
        id: "statement.availability-group",
        displayName: "Availability group statements",
        family: "server",
        keyword: "AVAILABILITY",
        nodes: ["AvailabilityGroupStatement"],
        profiles: ["sql-server"],
        statementUnavailable: true,
        evidence: "Always On availability groups are a boxed-instance feature.",
    },

    // ----------------------------------------------------------------- version-gated boxed syntax
    {
        id: "clause.named-window",
        displayName: "The named WINDOW clause",
        family: "query",
        keyword: "WINDOW",
        nodes: ["WindowClause"],
        minimumServer: 16,
        minimumCompatibility: 160,
        evidence: "ScriptDOM Only160SyntaxTests; TestScripts/SelectStatementTests160.sql.",
    },
    {
        id: "statement.create-json-index",
        displayName: "CREATE JSON INDEX",
        family: "index",
        keyword: "JSON",
        nodes: ["CreateJsonIndexStatement"],
        minimumServer: 17,
        minimumCompatibility: 170,
        evidence: "ScriptDOM Only170SyntaxTests; TestScripts/CreateJsonIndexStatementTests170.sql.",
    },
    {
        id: "type.json",
        displayName: "The json data type",
        family: "type",
        keyword: "JSON",
        nodes: ["DataType"],
        textPattern: /^\s*json\b/iu,
        minimumServer: 17,
        minimumCompatibility: 170,
        evidence: "ScriptDOM Only170SyntaxTests native JSON type coverage.",
    },
    {
        id: "type.vector",
        displayName: "The vector data type",
        family: "type",
        keyword: "VECTOR",
        nodes: ["DataType"],
        textPattern: /^\s*vector\b/iu,
        minimumServer: 17,
        minimumCompatibility: 170,
        evidence: "ScriptDOM Only170SyntaxTests native VECTOR type coverage.",
    },
    {
        id: "expression.json-object",
        displayName: "The JSON_OBJECT constructor",
        family: "expression",
        keyword: "JSON_OBJECT",
        nodes: ["JsonConstructorExpression"],
        textPattern: /^\s*JSON_OBJECT\b/iu,
        minimumServer: 16,
        minimumCompatibility: 160,
        builtIns: ["JSON_OBJECT"],
        evidence: "ScriptDOM Only160SyntaxTests JSON constructor coverage.",
    },
    {
        id: "expression.json-array",
        displayName: "The JSON_ARRAY constructor",
        family: "expression",
        keyword: "JSON_ARRAY",
        nodes: ["JsonConstructorExpression"],
        textPattern: /^\s*JSON_ARRAY\b/iu,
        minimumServer: 16,
        minimumCompatibility: 160,
        builtIns: ["JSON_ARRAY"],
        evidence: "ScriptDOM Only160SyntaxTests JSON constructor coverage.",
    },
    {
        id: "expression.json-objectagg",
        displayName: "The JSON_OBJECTAGG aggregate",
        family: "expression",
        keyword: "JSON_OBJECTAGG",
        nodes: ["JsonAggregateExpression"],
        textPattern: /^\s*JSON_OBJECTAGG\b/iu,
        minimumServer: 17,
        minimumCompatibility: 170,
        builtIns: ["JSON_OBJECTAGG"],
        evidence: "ScriptDOM Only170SyntaxTests JSON aggregate coverage.",
    },
    {
        id: "expression.json-arrayagg",
        displayName: "The JSON_ARRAYAGG aggregate",
        family: "expression",
        keyword: "JSON_ARRAYAGG",
        nodes: ["JsonAggregateExpression"],
        textPattern: /^\s*JSON_ARRAYAGG\b/iu,
        minimumServer: 17,
        minimumCompatibility: 170,
        builtIns: ["JSON_ARRAYAGG"],
        evidence: "ScriptDOM Only170SyntaxTests JSON aggregate coverage.",
    },
    {
        id: "clause.json-array-wrapper",
        displayName: "The WITH ARRAY WRAPPER clause",
        family: "expression",
        keyword: "ARRAY",
        nodes: ["JsonArrayWrapperClause"],
        minimumServer: 17,
        minimumCompatibility: 170,
        evidence: "ScriptDOM Only170SyntaxTests JSON_QUERY array wrapper coverage.",
    },
    {
        id: "clause.json-returning",
        displayName: "The JSON RETURNING clause",
        family: "expression",
        keyword: "RETURNING",
        nodes: ["JsonReturningClause", "JsonValueReturningClause"],
        minimumServer: 17,
        minimumCompatibility: 170,
        evidence: "ScriptDOM Only170SyntaxTests JSON RETURNING coverage.",
    },
    {
        id: "statement.create-vector-index",
        displayName: "CREATE VECTOR INDEX",
        family: "index",
        keyword: "VECTOR",
        nodes: ["CreateVectorIndexStatement"],
        minimumServer: 17,
        minimumCompatibility: 170,
        evidence: "ScriptDOM Only170SyntaxTests vector index coverage.",
    },
    {
        id: "tablesource.vector-search",
        displayName: "The VECTOR_SEARCH table source",
        family: "query",
        keyword: "VECTOR_SEARCH",
        nodes: ["VectorSearchTableSource"],
        minimumServer: 17,
        minimumCompatibility: 170,
        evidence: "ScriptDOM Only170SyntaxTests VECTOR_SEARCH coverage.",
    },
    {
        id: "expression.approximate",
        displayName: "APPROX and APPROXIMATE aggregates",
        family: "expression",
        keyword: "APPROX",
        nodes: ["ApproximateKeyword"],
        textPattern: /^\s*APPROX\b/iu,
        minimumServer: 17,
        minimumCompatibility: 170,
        evidence: "ScriptDOM Only170SyntaxTests approximate aggregate coverage.",
    },
    {
        id: "expression.approximate-long",
        displayName: "APPROX and APPROXIMATE aggregates",
        family: "expression",
        keyword: "APPROXIMATE",
        nodes: ["ApproximateKeyword"],
        textPattern: /^\s*APPROXIMATE\b/iu,
        minimumServer: 17,
        minimumCompatibility: 170,
        evidence: "ScriptDOM Only170SyntaxTests approximate aggregate coverage.",
    },
    {
        id: "expression.ai-generate-embeddings",
        displayName: "AI_GENERATE_EMBEDDINGS",
        family: "expression",
        keyword: "AI_GENERATE_EMBEDDINGS",
        nodes: ["AiGenerateEmbeddingsExpression"],
        minimumServer: 17,
        minimumCompatibility: 170,
        builtIns: ["AI_GENERATE_EMBEDDINGS"],
        evidence: "ScriptDOM Only170SyntaxTests AI embedding coverage.",
    },

    // ---------------------------------------------------------------- analytics-engine-only syntax
    {
        id: "statement.materialized-view",
        displayName: "Materialized views",
        family: "view",
        keyword: "MATERIALIZED",
        nodes: ["CreateMaterializedViewStatement", "AlterMaterializedViewStatement"],
        profiles: ["azure-synapse-dedicated", "fabric-warehouse"],
        evidence:
            "ScriptDOM materialized-view coverage sits in the SQL DW and Fabric DW script families.",
    },
    {
        id: "clause.order-by-all",
        displayName: "ORDER BY ALL",
        family: "query",
        keyword: "ALL",
        nodes: ["OrderByAllClause"],
        profiles: ["fabric-warehouse"],
        evidence:
            "ScriptDOM TestScripts/OrderByAllTestsFabricDW.sql parses only under TSqlFabricDWParser.",
    },
    {
        id: "module.external-function-body",
        displayName: "External function bodies",
        family: "module",
        keyword: "EXTERNAL",
        nodes: ["ExternalFunctionBody"],
        profiles: ["fabric-warehouse"],
        evidence:
            "ScriptDOM TestScripts/ExternalFunctionTestsFabricDW.sql parses only under TSqlFabricDWParser.",
    },
    {
        id: "table.distribution",
        displayName: "The DISTRIBUTION table option",
        family: "table",
        keyword: "DISTRIBUTION",
        nodes: ["TableOption", "MaterializedViewOption"],
        textPattern: /^\s*DISTRIBUTION\b/iu,
        profiles: ["azure-synapse-dedicated", "fabric-warehouse"],
        evidence:
            "Distributed tables belong to the analytics engines; ScriptDOM TestScripts/CtasStatementTests.sql and CreateAlterTableClusterByTestsFabricDW.sql.",
    },
    {
        id: "table.cluster-by",
        displayName: "The CLUSTER BY table option",
        family: "table",
        keyword: "CLUSTER",
        nodes: ["ClusterByTableOption"],
        profiles: ["fabric-warehouse"],
        evidence:
            "ScriptDOM models clusterByTableOption only in TSqlFabricDW.g; TestScripts/CreateAlterTableClusterByTestsFabricDW.sql errors under every boxed parser.",
    },
    {
        id: "table.clone",
        displayName: "CREATE TABLE AS CLONE OF",
        family: "table",
        keyword: "CLONE",
        nodes: ["CreateTableStatement"],
        textPattern: /\bAS\s+CLONE\s+OF\b/iu,
        profiles: ["fabric-warehouse"],
        evidence:
            "ScriptDOM TestScripts/CloneTableTestsFabricDW.sql reports four errors under every boxed parser and none under TSqlFabricDWParser.",
    },
    {
        id: "query.nested-cte",
        displayName: "A common table expression nested inside another",
        family: "query",
        keyword: "WITH",
        nodes: ["NestedCommonTableExpressionQuery"],
        profiles: ["fabric-warehouse"],
        evidence:
            "ScriptDOM TestScripts/NestedCTETestsFabricDW.sql errors under every boxed parser and parses under TSqlFabricDWParser.",
    },
    {
        id: "query.group-by-all",
        displayName: "GROUP BY ALL",
        family: "query",
        keyword: "ALL",
        nodes: ["GroupByAllClause"],
        // Legacy `GROUP BY ALL <columns>` is boxed SQL Server syntax and shares this node, so the
        // spelling test selects only the modern column-less form.
        textPattern: /^\s*ALL\s*$/iu,
        profiles: ["fabric-warehouse"],
        evidence:
            "ScriptDOM TestScripts/ModernGroupByAllTestsFabricDW.sql reports nine errors under every boxed parser and none under TSqlFabricDWParser.",
    },
    {
        id: "query.predict",
        displayName: "The PREDICT table source",
        family: "query",
        keyword: "PREDICT",
        nodes: ["PredictTableSource"],
        profiles: ["azure-synapse-dedicated"],
        evidence:
            "ScriptDOM predictTableReference is a dedicated SQL pool construct; TestScripts/PredictSqlDwTests.sql.",
    },
    {
        id: "workload.classifier",
        displayName: "Workload classifiers",
        family: "workload",
        keyword: "CLASSIFIER",
        nodes: ["WorkloadClassifierStatement"],
        profiles: ["azure-synapse-dedicated"],
        statementUnavailable: true,
        evidence:
            "ScriptDOM TestScripts/CreateWorkloadClassifierStatementSqlDwTests.sql is a dedicated SQL pool script family.",
    },
    {
        id: "statement.copy-into",
        displayName: "The COPY INTO statement",
        family: "dml",
        keyword: "COPY",
        nodes: ["CopyIntoStatement"],
        profiles: ["azure-synapse-dedicated", "fabric-warehouse"],
        statementUnavailable: true,
        evidence:
            "ScriptDOM TestScripts/CopyCommandTestsDw.sql is a dedicated SQL pool script family; Fabric Data Warehouse keeps the same statement.",
    },
    {
        id: "database.file-definition",
        displayName: "Database file and filegroup control",
        family: "database",
        // One node per construct, never a node and its own child: `DatabaseFileAction` is every
        // ALTER DATABASE action that reaches a file or filegroup — including `ADD FILEGROUP`, which
        // carries no file definition — and the two clauses are CREATE DATABASE's own file and log
        // placement. Gating the nested `FileDefinition` as well would report the same action twice.
        nodes: ["DatabaseFileAction", "DatabaseFileClause", "DatabaseLogClause"],
        // Azure SQL Database and the analytics engines expose no file or filegroup surface at all;
        // Managed Instance is instance-scoped and keeps it.
        profiles: ["sql-server", "azure-sql-managed-instance"],
        evidence:
            "Only an instance-scoped engine exposes database files to T-SQL; the capability table records the same split.",
    },
]);
