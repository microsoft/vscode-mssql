/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    InMemoryMetadataProvider,
    type SimpleQueryExecutor,
    type SimpleQueryMetadataPublisher,
    type SimpleQueryResult,
} from "@vscode-mssql/tsql-language-service";
import { VscodeMssqlSimpleQueryMetadataLoader } from "../../src/languageservice/preview/simpleQueryMetadata";
import {
    computeSingleTextChange,
    isPreviewStatsCodeLensEnabled,
    metadataSectionsInvalidatedByExecutedSql,
} from "../../src/languageservice/preview/previewLanguageService";

suite("Preview language service integration", () => {
    test("publishes identities first and hydrates object details on demand", async () => {
        const queries: string[] = [];
        const executor: SimpleQueryExecutor = {
            execute: async (query) => {
                queries.push(query);
                return resultFor(query);
            },
        };
        const store = new InMemoryMetadataProvider();
        const generations: number[] = [];
        store.onDidChange(() => generations.push(store.pin().generation));
        const publisher: SimpleQueryMetadataPublisher = {
            replace: (input) => store.replace(input),
            merge: (input) => store.merge(input),
            replaceSection: (section, input) => store.replaceSection(section, input),
        };
        const loader = new VscodeMssqlSimpleQueryMetadataLoader();
        await loader.refresh(executor, publisher);
        let view = store.pin();

        expect(view.environment).to.deep.include({
            currentDatabase: "LargeDb",
            defaultSchema: "custom",
            caseSensitive: false,
            compatibilityLevel: 170,
        });
        expect(view.databases()).to.deep.equal([{ name: "LargeDb" }, { name: "ArchiveDb" }]);
        expect(view.schemas()).to.deep.equal([{ database: "LargeDb", name: "dbo" }]);
        expect(view.searchPrincipals({ kinds: ["login"] })).to.deep.include({
            id: "server-principal:11",
            name: "AppLogin",
            kind: "login",
            system: undefined,
        });
        const resolution = view.resolveObject(["dbo", "Customers"]);
        expect(resolution.kind).to.equal("resolved");
        if (resolution.kind !== "resolved") throw new Error("Expected resolved object");
        expect(resolution.object).to.deep.include({
            schema: "dbo",
            name: "Customers",
            kind: "table",
        });
        const systemResolution = view.resolveObject(["sys", "objects"]);
        expect(systemResolution.kind).to.equal("resolved");
        if (systemResolution.kind !== "resolved") throw new Error("Expected system catalog view");
        expect(systemResolution.object).to.deep.include({
            schema: "sys",
            name: "objects",
            kind: "view",
            system: true,
        });
        const typeResolution = view.resolveObject(["dbo", "OrderNumber"]);
        expect(typeResolution.kind).to.equal("resolved");
        if (typeResolution.kind !== "resolved") throw new Error("Expected resolved user type");
        expect(typeResolution.object).to.deep.include({
            kind: "type",
            typeCategory: "alias",
        });
        expect(view.columnState(resolution.object.ref)).to.deep.equal({ kind: "notLoaded" });
        expect(view.parameterState(resolution.object.ref)).to.deep.equal({ kind: "notLoaded" });
        expect(view.completeness).to.deep.include({
            databases: "ready",
            schemas: "ready",
            objects: "ready",
            columns: "partial",
            parameters: "partial",
            principals: "ready",
            definitions: "unknown",
        });
        expect(generations).to.have.length(4);
        expect(queries).to.have.length(5);

        await loader.hydrate(
            executor,
            { section: "columns", object: resolution.object.ref, priority: "interactive" },
            publisher,
        );
        await loader.hydrate(
            executor,
            { section: "parameters", object: resolution.object.ref, priority: "interactive" },
            publisher,
        );
        await loader.hydrate(
            executor,
            {
                section: "columns",
                object: systemResolution.object.ref,
                priority: "interactive",
            },
            publisher,
        );
        view = store.pin();
        expect(view.columnState(resolution.object.ref)).to.deep.equal({
            kind: "loaded",
            value: [
                {
                    name: "Name",
                    typeDisplay: "nvarchar(100)",
                    nullable: true,
                    identity: undefined,
                    computed: undefined,
                    primaryKeyOrdinal: 1,
                },
            ],
        });
        expect(view.parameterState(resolution.object.ref)).to.deep.equal({
            kind: "loaded",
            value: [{ ordinal: 1, name: "@id", typeDisplay: "int", output: false }],
        });
        expect(view.columnState(systemResolution.object.ref).kind).to.equal("loaded");
        expect(queries).to.have.length(8);

        await loader.hydrate(
            executor,
            { section: "schemas", database: "ArchiveDb", priority: "interactive" },
            publisher,
        );
        await loader.hydrate(
            executor,
            { section: "objects", database: "ArchiveDb", priority: "interactive" },
            publisher,
        );
        view = store.pin();
        expect(view.schemas("ArchiveDb")).to.deep.equal([
            { database: "ArchiveDb", name: "history" },
        ]);
        const archive = view.resolveObject(["ArchiveDb", "history", "Orders"]);
        expect(archive.kind).to.equal("resolved");
        if (archive.kind !== "resolved") throw new Error("Expected cross-database object");
        expect(archive.object.kind).to.equal("view");
        expect(view.resolveObject(["dbo", "Customers"]).kind).to.equal("resolved");

        for (const query of queries) {
            for (const line of query.split(/\r?\n/)) {
                if (/\b(?:FROM|JOIN)\s+(?:\[[^\]]+\]\.)?sys\./i.test(line)) {
                    expect(line, `catalog read must use NOLOCK: ${line}`).to.match(
                        /\bWITH\s*\(NOLOCK\)/i,
                    );
                }
            }
        }
    });

    test("replaces principal metadata without reloading the object catalog", async () => {
        let principalRefresh = false;
        const queries: string[] = [];
        const executor: SimpleQueryExecutor = {
            execute: async (query) => {
                queries.push(query);
                if (query.includes("sys.server_principals") && principalRefresh) {
                    return table(
                        [
                            "entry_kind",
                            "database_name",
                            "metadata_id",
                            "schema_name",
                            "principal_name",
                            "principal_kind",
                            "is_system",
                        ],
                        [
                            [
                                "principal",
                                undefined,
                                "server-principal:12",
                                undefined,
                                "NewLogin",
                                "login",
                                "0",
                            ],
                        ],
                    );
                }
                return resultFor(query);
            },
        };
        const store = new InMemoryMetadataProvider({
            completeness: { principals: "ready", objects: "ready" },
            principals: [
                { id: "server-principal:11", name: "AppLogin", kind: "login" },
            ],
            objects: [
                { ref: { id: "42" }, schema: "dbo", name: "Customers", kind: "table" },
            ],
        });
        const publisher: SimpleQueryMetadataPublisher = {
            replace: (input) => store.replace(input),
            merge: (input) => store.merge(input),
            replaceSection: (section, input) => store.replaceSection(section, input),
        };

        principalRefresh = true;
        await new VscodeMssqlSimpleQueryMetadataLoader().hydrate(
            executor,
            { section: "principals", priority: "background" },
            publisher,
        );

        expect(store.pin().searchPrincipals({ prefix: "" }).map((item) => item.name)).to.deep.equal([
            "NewLogin",
        ]);
        expect(store.pin().resolveObject(["dbo", "Customers"]).kind).to.equal("resolved");
        expect(queries).to.have.length(1);
        expect(queries[0]).to.include("sys.server_principals WITH (NOLOCK)");
    });

    test("computes an equivalent minimal UTF-16 edit", () => {
        const previous = "SELECT N'😀';\nSELECT 1;";
        const next = "SELECT N'😀';\nSELECT dbo.Customers;";
        const change = computeSingleTextChange(previous, next)!;

        expect(previous.slice(0, change.start) + change.text + previous.slice(change.end)).to.equal(
            next,
        );
        expect(change.start).to.equal(previous.lastIndexOf("1"));
        expect(change.end).to.equal(previous.lastIndexOf("1") + 1);
    });

    test("requires both preview flags before showing the stats CodeLens", () => {
        expect(isPreviewStatsCodeLensEnabled(false, false)).to.equal(false);
        expect(isPreviewStatsCodeLensEnabled(true, false)).to.equal(false);
        expect(isPreviewStatsCodeLensEnabled(false, true)).to.equal(false);
        expect(isPreviewStatsCodeLensEnabled(true, true)).to.equal(true);
    });

    test("invalidates only principal metadata for successful principal DDL text", () => {
        expect(metadataSectionsInvalidatedByExecutedSql("CREATE LOGIN tempChange WITH PASSWORD='x';"))
            .to.deep.equal(["principals"]);
        expect(
            metadataSectionsInvalidatedByExecutedSql(
                "USE master;\nGO\nALTER SERVER ROLE [sysadmin] ADD MEMBER [tempChange];",
            ),
        ).to.deep.equal(["principals"]);
        expect(metadataSectionsInvalidatedByExecutedSql("DROP USER [tempChange];")).to.deep.equal([
            "principals",
        ]);
    });

    test("invalidates the complete catalog for object, schema, permission, and legacy catalog DDL", () => {
        const allSections = [
            "databases",
            "schemas",
            "objects",
            "columns",
            "parameters",
            "principals",
            "definitions",
        ];
        for (const sql of [
            "CREATE TABLE dbo.T (id int);",
            "ALTER TABLE dbo.T ADD name nvarchar(50);",
            "DROP VIEW dbo.V;",
            "CREATE OR ALTER PROCEDURE dbo.p AS SELECT 1;",
            "CREATE UNIQUE CLUSTERED INDEX IX_T ON dbo.T(id);",
            "CREATE TYPE dbo.Phone FROM nvarchar(30);",
            "CREATE SCHEMA sales;",
            "GRANT SELECT ON dbo.T TO app_user;",
            "DISABLE TRIGGER dbo.tr_T ON dbo.T;",
            "SELECT id INTO dbo.T2 FROM dbo.T;",
            "EXEC sys.sp_rename N'dbo.T', N'T2';",
        ]) {
            expect(metadataSectionsInvalidatedByExecutedSql(sql), sql).to.deep.equal(allSections);
        }
    });

    test("combines principal and object DDL into a complete catalog invalidation", () => {
        expect(
            metadataSectionsInvalidatedByExecutedSql(
                "CREATE USER tempChange WITHOUT LOGIN;\nCREATE TABLE dbo.T (id int);",
            ),
        ).to.deep.equal([
            "databases",
            "schemas",
            "objects",
            "columns",
            "parameters",
            "principals",
            "definitions",
        ]);
    });

    test("does not invalidate metadata for comments, strings, identifiers, or data-only SQL", () => {
        expect(
            metadataSectionsInvalidatedByExecutedSql(
                "-- CREATE LOGIN fake\nSELECT N'ALTER USER fake'; /* DROP ROLE fake */",
            ),
        ).to.deep.equal([]);
        expect(
            metadataSectionsInvalidatedByExecutedSql(
                "SELECT [create], [login] FROM dbo.PrincipalWords;",
            ),
        ).to.deep.equal([]);
        expect(metadataSectionsInvalidatedByExecutedSql("INSERT dbo.T(id) VALUES (1);"))
            .to.deep.equal([]);
        expect(metadataSectionsInvalidatedByExecutedSql("SELECT 1 INTO #local_temp;")).to.deep.equal(
            [],
        );
    });
});

function resultFor(query: string): SimpleQueryResult {
    if (query.includes("SERVERPROPERTY")) {
        return table(
            [
                "current_database",
                "default_schema",
                "case_sensitive",
                "engine_edition",
                "server_version",
                "compatibility_level",
            ],
            [["LargeDb", "custom", "0", "3", "17.0", "170"]],
        );
    }
    if (query.includes("FROM sys.databases") && query.includes("HAS_DBACCESS")) {
        return table(["database_name"], [["LargeDb"], ["ArchiveDb"]]);
    }
    if (query.includes("sys.server_principals")) {
        return table(
            [
                "entry_kind",
                "database_name",
                "metadata_id",
                "schema_name",
                "principal_name",
                "principal_kind",
                "is_system",
            ],
            [
                ["schema", "LargeDb", "schema:1:1", "dbo", undefined, undefined, "0"],
                [
                    "principal",
                    undefined,
                    "server-principal:11",
                    undefined,
                    "AppLogin",
                    "login",
                    "0",
                ],
            ],
        );
    }
    if (query.includes("[ArchiveDb].sys.schemas")) {
        return table(["schema_name"], [["history"]]);
    }
    if (query.includes("[ArchiveDb].sys.types")) {
        return table(
            ["user_type_id", "schema_name", "type_name", "type_category"],
            [["301", "history", "OrderCode", "alias"]],
        );
    }
    if (/FROM\s+(?:\[[^\]]+\]\.)?sys\.all_columns/i.test(query)) {
        return table(
            [
                "object_id",
                "column_id",
                "column_name",
                "type_name",
                "max_length",
                "precision",
                "scale",
                "is_nullable",
                "is_identity",
                "is_computed",
                "primary_key_ordinal",
            ],
            [["42", "1", "Name", "nvarchar", "200", "0", "0", "1", "0", "0", "1"]],
        );
    }
    if (/FROM\s+(?:\[[^\]]+\]\.)?sys\.all_parameters/i.test(query)) {
        return table(
            [
                "object_id",
                "parameter_id",
                "parameter_name",
                "type_name",
                "max_length",
                "precision",
                "scale",
                "is_output",
            ],
            [["42", "1", "@id", "int", "4", "10", "0", "0"]],
        );
    }
    if (query.includes("[ArchiveDb].sys.all_objects")) {
        return table(
            ["object_id", "schema_name", "object_name", "object_type", "is_ms_shipped"],
            [["84", "history", "Orders", "V ", "0"]],
        );
    }
    if (query.includes("FROM sys.types")) {
        return table(
            ["user_type_id", "schema_name", "type_name", "type_category"],
            [
                ["256", "dbo", "OrderNumber", "alias"],
                ["257", "dbo", "OrderTable", "table"],
            ],
        );
    }
    if (query.includes("FROM sys.all_objects")) {
        return table(
            ["object_id", "schema_name", "object_name", "object_type", "is_ms_shipped"],
            [
                ["-2147483646", "sys", "objects", "V ", "1"],
                ["42", "dbo", "Customers", "U ", "0"],
            ],
        );
    }
    throw new Error(`Unexpected metadata query: ${query}`);
}

function table(
    columns: readonly string[],
    rows: readonly (readonly (string | undefined)[])[],
): SimpleQueryResult {
    return { columns: columns.map((name) => ({ name })), rows };
}
