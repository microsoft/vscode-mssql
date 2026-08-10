/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Connection, Request } from "tedious";
import {
    MappingCatalogProvider,
    type SqlCatalogMapping as SchemaMapping,
} from "@vscode-mssql/tsql-language-service";
import {
    formatAnalysisType as formatType,
    PackageAnalysisSession as SqlSession,
    symbolAt,
} from "../packageAnalysisSession";

interface CatalogRow {
    schema: string;
    table: string;
    column: string;
    type: string;
}

interface CatalogTable {
    schema: string;
    name: string;
    columns: CatalogRow[];
}

suite("Beta SQL language service parser integration", function () {
    let connection: Connection;
    let schema: MappingCatalogProvider;
    let table: CatalogTable;
    let systemTable: CatalogTable;

    suiteSetup(async function () {
        const config = readConnectionConfig();
        if (!config) {
            this.skip();
            return;
        }
        connection = new Connection(config);
        const rows = await queryCatalog(connection);
        expect(rows, "The live database must contain a user table with columns").to.not.be.empty;

        const tables = groupTables(rows);
        const firstTable = tables.find((candidate) => candidate.columns.length >= 2) ?? tables[0];
        if (!firstTable) {
            throw new Error("No user table metadata was returned.");
        }
        table = firstTable;
        const systemObjects = tables.find(
            (candidate) => candidate.schema === "sys" && candidate.name === "objects",
        );
        if (!systemObjects) {
            throw new Error("No sys.objects metadata was returned.");
        }
        systemTable = systemObjects;
        const mapping: SchemaMapping = {};
        for (const row of rows) {
            const tables = (mapping[row.schema] ??= {});
            const columns = (tables[row.table] ??= {});
            if (typeof columns !== "string") {
                columns[row.column] = row.type;
            }
        }
        schema = new MappingCatalogProvider(mapping, 1, "closed");
    });

    suiteTeardown(async function () {
        connection?.close();
    });

    /** Verifies a real catalog table appears in relation-name completion. */
    test("completes a table name from live catalog metadata", () => {
        const sql = `SELECT * FROM ${quoteIdentifier(table.schema)}.${table.name.slice(0, 2)}`;
        const session = SqlSession.create(sql, { schema });
        const completions = session.completeAt(sql.length);

        expect(completions.map((completion) => completion.label)).to.include(table.name);
    });

    /** Verifies all live columns are available through a table alias. */
    test("completes live columns through a table alias", () => {
        const sql = `SELECT t. FROM ${quoteTable(table)} AS t`;
        const completions = SqlSession.create(sql, { schema }).completeAt("SELECT t.".length);

        expect(completions.map((completion) => completion.label)).to.include.members(
            table.columns.map((column) => column.column),
        );
    });

    /** Verifies closed-world analysis rejects a column absent from the live table. */
    test("reports an unknown column using live table metadata", () => {
        const column = table.columns[0];
        const sql = `SELECT ${quoteIdentifier(column.column)}, __sql_lens_missing_column__ FROM ${quoteTable(table)}`;
        const diagnostics = SqlSession.create(sql, { schema }).diagnostics();

        expect(
            diagnostics.some((diagnostic) =>
                diagnostic.code.toLowerCase().includes("unknown-column"),
            ),
        ).to.be.true;
    });

    /** Verifies a live self-join diagnoses an unqualified duplicate column. */
    test("reports an ambiguous live column in a self join", () => {
        const column = table.columns[0];
        const columnSql = quoteIdentifier(column.column);
        const tableSql = quoteTable(table);
        const sql = `SELECT ${columnSql} FROM ${tableSql} AS left_table JOIN ${tableSql} AS right_table ON left_table.${columnSql} = right_table.${columnSql}`;
        const diagnostics = SqlSession.create(sql, { schema }).diagnostics();

        expect(
            diagnostics.some((diagnostic) =>
                diagnostic.code.toLowerCase().includes("ambiguous-column"),
            ),
        ).to.be.true;
    });

    /** Verifies live SQL Server types flow into derived symbols and hover data. */
    test("provides a typed symbol for a live column", () => {
        const column = table.columns[0];
        const sql = `SELECT ${quoteIdentifier(column.column)} FROM ${quoteTable(table)}`;
        const session = SqlSession.create(sql, { schema });
        const offset = sql.indexOf(column.column);
        const symbol = symbolAt(session.deriveSymbols(), offset);

        expect(symbol?.kind).to.equal("column");
        expect(symbol?.name).to.equal(column.column);
        expect(symbol?.type).to.not.be.undefined;
        expect(formatType(symbol!.type!)).to.not.equal("unknown");
        expect(formatType(session.typeAt(offset))).to.equal(formatType(symbol!.type!));
    });

    /** Verifies CTE navigation survives binding against a live catalog table. */
    test("resolves a definition through a CTE backed by live metadata", () => {
        const column = table.columns[0];
        const columnSql = quoteIdentifier(column.column);
        const sql = `WITH live_rows AS (SELECT ${columnSql} FROM ${quoteTable(table)}) SELECT ${columnSql} FROM live_rows`;
        const session = SqlSession.create(sql, { schema });
        const referenceOffset = sql.lastIndexOf(column.column);
        const symbol = symbolAt(session.deriveSymbols(), referenceOffset);
        const definitionStart = sql.indexOf(columnSql);

        expect(symbol?.kind).to.equal("column");
        expect(symbol?.definition?.start).to.equal(definitionStart);
        expect(symbol?.definition?.end).to.equal(definitionStart + columnSql.length);
    });

    /** Verifies a live projected column remains bound through a subquery alias. */
    test("resolves projected columns through a subquery", () => {
        const column = table.columns[0];
        const columnSql = quoteIdentifier(column.column);
        const sql = `SELECT projected.${columnSql} FROM (SELECT ${columnSql} FROM ${quoteTable(table)}) AS projected`;
        const session = SqlSession.create(sql, { schema });
        const symbol = symbolAt(session.deriveSymbols(), sql.indexOf(column.column));

        expect(session.diagnostics()).to.be.empty;
        expect(symbol?.kind).to.equal("column");
    });

    /** Verifies qualified join columns bind cleanly against real metadata. */
    test("analyzes qualified columns in joins using live metadata", () => {
        const column = table.columns[0];
        const columnSql = quoteIdentifier(column.column);
        const tableSql = quoteTable(table);
        const sql =
            `SELECT left_table.${columnSql}, right_table.${columnSql} ` +
            `FROM ${tableSql} AS left_table ` +
            `INNER JOIN ${tableSql} AS right_table ` +
            `ON left_table.${columnSql} = right_table.${columnSql}`;
        const session = SqlSession.create(sql, { schema });

        expect(session.syntaxDiagnostics).to.be.empty;
        expect(session.diagnostics()).to.be.empty;
    });

    /** Verifies aggregation, grouping, ordering, and window analysis over live types. */
    test("analyzes aggregates, grouping, ordering, and window functions", () => {
        const column = table.columns[0];
        const columnSql = quoteIdentifier(column.column);
        const sql =
            `SELECT ${columnSql}, COUNT(*) AS AggregateValue, ` +
            `ROW_NUMBER() OVER (ORDER BY ${columnSql}) AS WindowPosition ` +
            `FROM ${quoteTable(table)} ` +
            `GROUP BY ${columnSql} ORDER BY ${columnSql}`;
        const session = SqlSession.create(sql, { schema });

        expect(session.syntaxDiagnostics).to.be.empty;
        expect(session.diagnostics().map((diagnostic) => diagnostic.message)).to.be.empty;
        expect(session.deriveSymbols().map((symbol) => symbol.name)).to.include.members([
            "COUNT",
            "ROW_NUMBER",
        ]);
    });

    /** Verifies one session analyzes multiple live-catalog statements independently. */
    test("analyzes multiple statements against the same live catalog", () => {
        const firstColumn = table.columns[0];
        const secondColumn = table.columns[1] ?? firstColumn;
        const tableSql = quoteTable(table);
        const sql =
            `SELECT ${quoteIdentifier(firstColumn.column)} FROM ${tableSql}; ` +
            `SELECT ${quoteIdentifier(secondColumn.column)} FROM ${tableSql}`;
        const session = SqlSession.create(sql, { schema });

        expect(session.doc.statements).to.have.lengthOf(2);
        expect(session.diagnostics()).to.be.empty;
    });

    /** Verifies common DML parses against a real table without mutating it. */
    test("parses common DML against a live table without executing it", () => {
        const column = table.columns[0];
        const columnSql = quoteIdentifier(column.column);
        const tableSql = quoteTable(table);
        const statements = [
            `INSERT INTO ${tableSql} (${columnSql}) SELECT ${columnSql} FROM ${tableSql}`,
            `UPDATE ${tableSql} SET ${columnSql} = ${columnSql}`,
            `DELETE FROM ${tableSql} WHERE ${columnSql} = ${columnSql}`,
        ];

        for (const sql of statements) {
            const session = SqlSession.create(sql, { schema });
            expect(session.doc.statements[0]?.category).to.equal("dml");
            expect(session.syntaxDiagnostics).to.be.empty;
        }
    });

    suite("system metadata", () => {
        /** Verifies sys schema metadata participates in relation completion. */
        test("completes system views in the sys schema", () => {
            const sql = "SELECT * FROM sys.obj";
            const completions = SqlSession.create(sql, { schema }).completeAt(sql.length);

            expect(completions.map((completion) => completion.label)).to.include("objects");
        });

        /** Verifies every live system-view column is available through an alias. */
        test("completes columns from a system-view alias", () => {
            const sql = "SELECT system_object. FROM sys.objects AS system_object";
            const completions = SqlSession.create(sql, { schema }).completeAt(
                "SELECT system_object.".length,
            );

            expect(completions.map((completion) => completion.label)).to.include.members(
                systemTable.columns.map((column) => column.column),
            );
        });

        /** Verifies system columns expose live types without semantic diagnostics. */
        test("provides typed hover symbols and clean diagnostics for system columns", () => {
            const objectId = systemTable.columns.find((column) => column.column === "object_id");
            expect(objectId, "sys.objects must expose object_id").to.not.be.undefined;
            const sql = "SELECT system_object.object_id FROM sys.objects AS system_object";
            const session = SqlSession.create(sql, { schema });
            const symbol = symbolAt(session.deriveSymbols(), sql.indexOf("object_id"));

            expect(session.diagnostics()).to.be.empty;
            expect(symbol?.kind).to.equal("column");
            expect(formatType(symbol!.type!)).to.equal("int");
        });

        /** Verifies definition navigation through a CTE backed by sys.objects. */
        test("resolves definitions through a CTE backed by a system view", () => {
            const sql =
                "WITH system_objects AS (SELECT object_id FROM sys.objects) " +
                "SELECT object_id FROM system_objects";
            const session = SqlSession.create(sql, { schema });
            const symbol = symbolAt(session.deriveSymbols(), sql.lastIndexOf("object_id"));

            expect(session.diagnostics()).to.be.empty;
            expect(symbol?.definition?.start).to.equal(sql.indexOf("object_id"));
            expect(symbol?.definition?.end).to.equal(sql.indexOf("object_id") + "object_id".length);
        });
    });
});

function readConnectionConfig() {
    const values = {
        server: process.env.SERVER_NAME,
        database: process.env.DATABASE_NAME,
        user: process.env.USER_NAME,
        password: process.env.PASSWORD,
    };
    const missing = Object.entries(values)
        .filter(([name, value]) => name !== "password" && value === undefined)
        .map(([name]) => name);
    if (missing.length > 0) {
        return undefined;
    }

    const [server, port] = values.server!.split(",", 2);
    return {
        server,
        authentication: {
            type: "default" as const,
            options: {
                userName: values.user!,
                password: values.password!,
            },
        },
        options: {
            database: values.database!,
            port: Number.parseInt(port ?? "1433", 10),
            encrypt: true,
            trustServerCertificate: true,
        },
    };
}

function queryCatalog(connection: Connection): Promise<CatalogRow[]> {
    return new Promise((resolve, reject) => {
        const rows: CatalogRow[] = [];
        const request = new Request(
            `SELECT
    s.name AS schema_name,
    t.name AS table_name,
    c.name AS column_name,
    CASE
        WHEN ty.name IN ('nvarchar', 'nchar') AND c.max_length <> -1
            THEN CONCAT(ty.name, '(', c.max_length / 2, ')')
        WHEN ty.name IN ('varchar', 'char', 'varbinary', 'binary')
            THEN CONCAT(ty.name, '(', CASE WHEN c.max_length = -1 THEN 'max' ELSE CONVERT(varchar(10), c.max_length) END, ')')
        WHEN ty.name IN ('decimal', 'numeric')
            THEN CONCAT(ty.name, '(', c.precision, ',', c.scale, ')')
        WHEN ty.name IN ('datetime2', 'datetimeoffset', 'time')
            THEN CONCAT(ty.name, '(', c.scale, ')')
        ELSE ty.name
    END AS type_name
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.columns AS c ON c.object_id = t.object_id
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
WHERE t.is_ms_shipped = 0
UNION ALL
SELECT
    s.name AS schema_name,
    o.name AS table_name,
    c.name AS column_name,
    CASE
        WHEN ty.name IN ('nvarchar', 'nchar') AND c.max_length <> -1
            THEN CONCAT(ty.name, '(', c.max_length / 2, ')')
        WHEN ty.name IN ('varchar', 'char', 'varbinary', 'binary')
            THEN CONCAT(ty.name, '(', CASE WHEN c.max_length = -1 THEN 'max' ELSE CONVERT(varchar(10), c.max_length) END, ')')
        WHEN ty.name IN ('decimal', 'numeric')
            THEN CONCAT(ty.name, '(', c.precision, ',', c.scale, ')')
        WHEN ty.name IN ('datetime2', 'datetimeoffset', 'time')
            THEN CONCAT(ty.name, '(', c.scale, ')')
        ELSE ty.name
    END AS type_name
FROM sys.all_objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
JOIN sys.all_columns AS c ON c.object_id = o.object_id
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
WHERE s.name = N'sys' AND o.name IN (N'objects', N'tables', N'columns', N'schemas', N'types')
ORDER BY schema_name, table_name, column_name`,
            (error) => (error ? reject(error) : resolve(rows)),
        );
        request.on("row", (columns) => {
            const values = columns.map((column) => String(column.value ?? ""));
            if (values.every(Boolean)) {
                rows.push({
                    schema: values[0]!,
                    table: values[1]!,
                    column: values[2]!,
                    type: values[3]!,
                });
            }
        });
        connection.on("connect", (error) => {
            if (error) {
                reject(error);
                return;
            }
            connection.execSql(request);
        });
        connection.connect();
    });
}

function groupTables(rows: CatalogRow[]): CatalogTable[] {
    const tables = new Map<string, CatalogTable>();
    for (const row of rows) {
        const key = `${row.schema}.${row.table}`;
        const table = tables.get(key) ?? { schema: row.schema, name: row.table, columns: [] };
        table.columns.push(row);
        tables.set(key, table);
    }
    return [...tables.values()];
}

/** Quotes a SQL Server identifier while preserving any literal closing brackets in its name. */
function quoteIdentifier(identifier: string): string {
    return `[${identifier.replaceAll("]", "]]")}]`;
}

/** Quotes both parts of a live catalog relation so unusual schema and table names remain valid SQL. */
function quoteTable(table: CatalogTable): string {
    return `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
}
