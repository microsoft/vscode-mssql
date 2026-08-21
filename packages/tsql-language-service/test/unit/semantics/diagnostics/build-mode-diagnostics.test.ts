/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import * as api from "../../../../src/index.ts";
import type {
    AnalysisProfile,
    DeploymentMode,
    InMemoryMetadataInput,
    SemanticSnapshot,
} from "../../../../src/index.ts";
// A data-tier application build replays only CREATE data-definition statements. Every other
// top-level statement is named by its statement phrase and rejected; inside an accepted CREATE
// statement a bounded set of options and system types is still unsupported. Each statement carries
// at most one statement-level result, while unsupported types and execution contexts are reported
// wherever they appear.
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = api;

const catalog = {
    environment: { currentDatabase: "db", defaultSchema: "dbo" },
    schemas: [{ database: "db", name: "dbo" }],
    databases: [{ name: "db" }],
    objects: [
        {
            ref: { id: "t", database: "db" },
            database: "db",
            schema: "dbo",
            name: "t",
            kind: "table",
        },
    ],
    columns: new Map([["t", [{ name: "a", typeDisplay: "int" }]]]),
    principals: [{ id: "u", database: "db", name: "u", kind: "user" }],
} satisfies InMemoryMetadataInput;

function runtime(deploymentMode: DeploymentMode) {
    return new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        new InMemoryMetadataProvider(catalog),
        { deploymentMode },
    );
}

/** Returns only the build-mode results so unrelated catalog diagnostics cannot mask a regression. */
async function build(sql: string, options: { readonly allowSyntaxDiagnostics?: boolean } = {}) {
    const snapshot = await runtime("build").open("file:///build-mode.sql", 1, sql);
    if (!options.allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics
        .filter(({ code }) => code.startsWith("InvalidBuildMode"))
        .map(({ code, message, severity, range }) => ({
            code,
            message,
            severity,
            text: sql.slice(range.start, range.end),
        }));
}

/** Returns every diagnostic a build produces, including the ordinary catalog validations. */
async function buildAll(sql: string): Promise<string[]> {
    const snapshot = await runtime("build").open("file:///build-mode.sql", 1, sql);
    return snapshot.semantics.diagnostics.map(({ code }) => code);
}

async function interactive(sql: string): Promise<string[]> {
    const snapshot = await runtime("interactive").open("file:///build-mode.sql", 1, sql);
    assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics.map(({ code }) => code);
}

const unsupportedStatement = (phrase: string): string =>
    `The '${phrase}' statement is not supported in a data-tier application. Remove the statement before rebuilding.`;

suite("T-SQL build-mode statement validation", () => {
    // The exact output for the simplest rejected statement, ranged across the whole statement.
    test("reports an unsupported statement with exact output", async () => {
        assert.deepEqual(await build("SELECT 1;"), [
            {
                code: "InvalidBuildModeSqlNullStatement",
                message: unsupportedStatement("SELECT"),
                severity: "error",
                text: "SELECT 1",
            },
        ]);
    });

    // The phrase follows the statement kind rather than its spelling, and covers CREATE and ALTER.
    test("names each rejected statement by its statement phrase", async () => {
        const cases: readonly (readonly [string, string, string])[] = [
            ["EXEC dbo.p;", "EXECUTE", "EXEC dbo.p"],
            [
                "ALTER VIEW dbo.v AS SELECT 1 AS a;",
                "ALTER VIEW",
                "ALTER VIEW dbo.v AS SELECT 1 AS a",
            ],
            ["DROP TABLE dbo.t;", "DROP TABLE", "DROP TABLE dbo.t"],
            ["GRANT SELECT ON dbo.t TO u;", "GRANT", "GRANT SELECT ON dbo.t TO u"],
            ["DECLARE @x int;", "DECLARE", "DECLARE @x int"],
            ["DECLARE c CURSOR FOR SELECT 1;", "DECLARE CURSOR", "DECLARE c CURSOR FOR SELECT 1"],
            ["DECLARE @t TABLE (a int);", "DECLARE TABLE", "DECLARE @t TABLE (a int)"],
            ["BEGIN SELECT 1; END", "BEGIN END", "BEGIN SELECT 1; END"],
            ["USE db;", "USE", "USE db"],
            // Statements without a dedicated node are named from their own leading tokens.
            ["CREATE DATABASE d;", "CREATE DATABASE", "CREATE DATABASE d"],
            ["ALTER TABLE dbo.t ADD b int;", "ALTER TABLE", "ALTER TABLE dbo.t ADD b int"],
            ["BEGIN TRANSACTION;", "BEGIN TRANSACTION", "BEGIN TRANSACTION"],
            ["TRUNCATE TABLE dbo.t;", "TRUNCATE TABLE", "TRUNCATE TABLE dbo.t"],
            ["CHECKPOINT;", "CHECKPOINT", "CHECKPOINT"],
        ];
        for (const [sql, phrase, text] of cases) {
            assert.deepEqual(
                (await build(sql)).map((diagnostic) => [
                    diagnostic.code,
                    diagnostic.message,
                    diagnostic.text,
                ]),
                [["InvalidBuildModeSqlNullStatement", unsupportedStatement(phrase), text]],
                sql,
            );
        }
    });

    // Every CREATE data-definition statement the build replays stays silent.
    test("accepts the CREATE data-definition statements a build replays", async () => {
        for (const sql of [
            "CREATE TABLE dbo.t2 (a int);",
            "CREATE VIEW dbo.v AS SELECT 1 AS a;",
            "CREATE OR ALTER VIEW dbo.v AS SELECT 1 AS a;",
            "CREATE PROCEDURE dbo.p AS SELECT 1;",
            "CREATE PROC dbo.p AS SELECT 1;",
            "CREATE FUNCTION dbo.f () RETURNS int AS BEGIN RETURN 1; END;",
            "CREATE TRIGGER tr ON dbo.t AFTER INSERT AS BEGIN RETURN; END;",
            "CREATE INDEX i ON dbo.t (a);",
            "CREATE SCHEMA s;",
            "CREATE SCHEMA AUTHORIZATION u;",
            "CREATE SYNONYM dbo.s FOR dbo.t;",
            "CREATE TYPE dbo.ty FROM int;",
            "CREATE ROLE r;",
            "CREATE LOGIN l FROM WINDOWS;",
            "CREATE LOGIN l FROM CERTIFICATE c;",
        ]) {
            assert.deepEqual(await build(sql), [], sql);
        }
    });

    // Nothing in this family may appear under the interactive default.
    test("never reports a build diagnostic in the interactive profile", async () => {
        for (const sql of [
            "SELECT 1;",
            "ALTER TABLE dbo.t ADD b int;",
            "CREATE PROCEDURE dbo.p WITH ENCRYPTION AS SELECT 1;",
            "CREATE TABLE dbo.g (a geography);",
            "CREATE LOGIN l WITH PASSWORD = 'p';",
        ]) {
            assert.deepEqual(
                (await interactive(sql)).filter((code) => code.startsWith("InvalidBuildMode")),
                [],
                sql,
            );
        }
    });

    // Damaged input has no reliable statement identity, so it must not invent a phrase.
    test("stays silent on malformed editor input", async () => {
        for (const sql of ["CREATE TABLE dbo.", "SELECT", "CREATE PROCEDURE", "ALTER "]) {
            assert.deepEqual(await build(sql, { allowSyntaxDiagnostics: true }), [], sql);
        }
    });

    // Only the script's own statements are built; a module body is part of its CREATE statement.
    test("does not report statements inside an accepted module body", async () => {
        assert.deepEqual(
            await build(`CREATE PROCEDURE dbo.p AS
BEGIN
    SELECT 1;
    UPDATE dbo.t SET a = 1;
END;`),
            [],
        );
        assert.deepEqual(await build("CREATE VIEW dbo.v AS SELECT a FROM dbo.t;"), []);
    });

    // Batch boundaries do not change which statements a build replays.
    test("reports each rejected statement once across batches", async () => {
        assert.deepEqual(
            (await build("SELECT 1;\nGO\nSELECT 2;\n")).map(({ text }) => text),
            ["SELECT 1", "SELECT 2"],
        );
    });

    // Ordinary catalog validation keeps running; the build result is additional, not a replacement.
    test("keeps unrelated validations running in build mode", async () => {
        assert.deepEqual(await buildAll("SELECT a FROM dbo.missing;"), [
            "InvalidBuildModeSqlNullStatement",
            "MSSQL208",
        ]);
    });
});

suite("T-SQL build-mode option validation", () => {
    // Exact output for each statement-level option result, ranged across the whole statement. A
    // mounted module body owns the terminator that follows it, so that statement's range includes it.
    test("reports each unsupported CREATE option with exact output", async () => {
        const cases: readonly (readonly [string, string, string, string])[] = [
            [
                "CREATE SCHEMA s CREATE TABLE t (a int)",
                "InvalidBuildModeStatementCreateSchema",
                "CREATE SCHEMA statements that contain schema elements are not supported in a data-tier application. Remove the elements from the statement or write the elements as separate DDL statements before rebuilding.",
                "CREATE SCHEMA s CREATE TABLE t (a int)",
            ],
            [
                "CREATE INDEX i ON dbo.t (a) WITH (DROP_EXISTING = ON);",
                "InvalidBuildModeStatementCreateIndex",
                "CREATE INDEX statements with a DROP_EXISTING option are not supported in a data-tier application. Remove the statement or the DROP EXISTING option before rebuilding.",
                "CREATE INDEX i ON dbo.t (a) WITH (DROP_EXISTING = ON)",
            ],
            [
                "CREATE PROCEDURE dbo.p @c CURSOR VARYING OUTPUT AS SELECT 1;",
                "InvalidBuildModeStatementCreateProcCursorParams",
                "CREATE PROCEDURE statements with cursor parameters are not supported in a data-tier application. Remove the statement or the cursor parameter before rebuilding.",
                "CREATE PROCEDURE dbo.p @c CURSOR VARYING OUTPUT AS SELECT 1;",
            ],
            [
                "CREATE PROCEDURE dbo.p WITH ENCRYPTION AS SELECT 1;",
                "InvalidBuildModeStatementCreateProcedureWithEncryption",
                "CREATE PROCEDURE statements with ENCRYPTION option are not supported in a data-tier application. Remove the statement or ENCRYPTION option before rebuilding.",
                "CREATE PROCEDURE dbo.p WITH ENCRYPTION AS SELECT 1;",
            ],
            [
                "CREATE FUNCTION dbo.f (@c CURSOR VARYING) RETURNS int AS BEGIN RETURN 1; END;",
                "InvalidBuildModeStatementCreateFunction",
                "CREATE FUNCTION statements with cursor parameters are not supported in a data-tier application. Remove the statement or the cursor parameter before rebuilding.",
                "CREATE FUNCTION dbo.f (@c CURSOR VARYING) RETURNS int AS BEGIN RETURN 1; END;",
            ],
            [
                "CREATE FUNCTION dbo.f () RETURNS int WITH ENCRYPTION AS BEGIN RETURN 1; END;",
                "InvalidBuildModeStatementCreateFunctionWithEncryption",
                "CREATE FUNCTION statements with ENCRYPTION option are not supported in a data-tier application. Remove the statement or ENCRYPTION option before rebuilding.",
                "CREATE FUNCTION dbo.f () RETURNS int WITH ENCRYPTION AS BEGIN RETURN 1; END;",
            ],
            [
                "CREATE LOGIN l WITH PASSWORD = 'p';",
                "InvalidBuildModeStatementCreateLogin",
                "CREATE LOGIN statements with PASSWORD or SID options that do not specify a MUST_CHANGE option are not supported in a data-tier application. Remove the statement or add the MUST_CHANGE option before rebuilding.",
                "CREATE LOGIN l WITH PASSWORD = 'p'",
            ],
            [
                "CREATE LOGIN l WITH PASSWORD = 'p' MUST_CHANGE, DEFAULT_DATABASE = db;",
                "InvalidBuildModeStatementCreateLoginWithDefaultDatabase",
                "CREATE LOGIN statements with DEFAULT_DATABASE option are not supported in a data-tier application. Remove the statement or DEFAULT_DATABASE option before rebuilding.",
                "CREATE LOGIN l WITH PASSWORD = 'p' MUST_CHANGE, DEFAULT_DATABASE = db",
            ],
            [
                "CREATE TRIGGER tr ON DATABASE FOR DROP_TABLE AS BEGIN RETURN; END;",
                "InvalidBuildModeStatementCreateTriggerDdl",
                "CREATE TRIGGER statements for DDL triggers are not supported in a data-tier application. Remove the statement before rebuilding.",
                "CREATE TRIGGER tr ON DATABASE FOR DROP_TABLE AS BEGIN RETURN; END;",
            ],
            [
                "CREATE TRIGGER tr ON dbo.t WITH ENCRYPTION AFTER INSERT AS BEGIN RETURN; END;",
                "InvalidBuildModeStatementCreateTriggerWithEncryption",
                "CREATE TRIGGER statements with ENCRYPTION option are not supported in a data-tier application. Remove the statement or ENCRYPTION option before rebuilding.",
                "CREATE TRIGGER tr ON dbo.t WITH ENCRYPTION AFTER INSERT AS BEGIN RETURN; END;",
            ],
            [
                "CREATE VIEW dbo.v WITH ENCRYPTION AS SELECT 1 AS a;",
                "InvalidBuildModeStatementCreateViewWithEncryption",
                "CREATE VIEW statements with ENCRYPTION option are not supported in a data-tier application. Remove the statement or ENCRYPTION option before rebuilding.",
                "CREATE VIEW dbo.v WITH ENCRYPTION AS SELECT 1 AS a",
            ],
        ];
        for (const [sql, code, message, text] of cases) {
            assert.deepEqual(await build(sql), [{ code, message, severity: "error", text }], sql);
        }
    });

    // A CLR function has no Transact-SQL body to replay, so the whole statement is named instead.
    test("names a CLR function by its statement phrase", async () => {
        assert.deepEqual(
            await build("CREATE FUNCTION dbo.f () RETURNS int AS EXTERNAL NAME asm.[Ns.Type].M;"),
            [
                {
                    code: "InvalidBuildModeSqlNullStatement",
                    message: unsupportedStatement("CREATE FUNCTION"),
                    severity: "error",
                    text: "CREATE FUNCTION dbo.f () RETURNS int AS EXTERNAL NAME asm.[Ns.Type].M",
                },
            ],
        );
    });

    // The nearest valid form of each rejected shape must stay silent.
    test("accepts the closest supported form of each option", async () => {
        for (const sql of [
            "CREATE SCHEMA s;",
            "CREATE SCHEMA s; CREATE TABLE dbo.t2 (a int);",
            "CREATE INDEX i ON dbo.t (a) WITH (DROP_EXISTING = OFF);",
            "CREATE INDEX i ON dbo.t (a) WITH (ONLINE = ON);",
            "CREATE PROCEDURE dbo.p @a int AS SELECT 1;",
            "CREATE PROCEDURE dbo.p WITH RECOMPILE AS SELECT 1;",
            "CREATE FUNCTION dbo.f (@a int) RETURNS int AS BEGIN RETURN 1; END;",
            "CREATE FUNCTION dbo.f () RETURNS int WITH SCHEMABINDING AS BEGIN RETURN 1; END;",
            "CREATE LOGIN l WITH PASSWORD = 'p' MUST_CHANGE;",
            "CREATE LOGIN l FROM WINDOWS WITH DEFAULT_LANGUAGE = us_english;",
            "CREATE TRIGGER tr ON dbo.t AFTER INSERT AS BEGIN RETURN; END;",
            "CREATE TRIGGER tr ON dbo.t WITH EXECUTE AS OWNER AFTER INSERT AS BEGIN RETURN; END;",
            "CREATE VIEW dbo.v WITH SCHEMABINDING AS SELECT 1 AS a;",
        ]) {
            assert.deepEqual(await build(sql), [], sql);
        }
    });

    // SQL Server keeps the last condition that matched, so these outrank the ENCRYPTION option.
    test("keeps one statement result when several conditions match", async () => {
        assert.deepEqual(
            (
                await build(
                    "CREATE PROCEDURE dbo.p @c CURSOR VARYING OUTPUT WITH ENCRYPTION AS SELECT 1;",
                )
            ).map(({ code }) => code),
            ["InvalidBuildModeStatementCreateProcCursorParams"],
        );
        assert.deepEqual(
            (
                await build(
                    "CREATE TRIGGER tr ON ALL SERVER WITH ENCRYPTION FOR DROP_LOGIN AS BEGIN RETURN; END;",
                )
            ).map(({ code }) => code),
            ["InvalidBuildModeStatementCreateTriggerDdl"],
        );
        assert.deepEqual(
            (
                await build(
                    "CREATE FUNCTION dbo.f (@c CURSOR VARYING) RETURNS int WITH ENCRYPTION AS BEGIN RETURN 1; END;",
                )
            ).map(({ code }) => code),
            ["InvalidBuildModeStatementCreateFunction"],
        );
    });

    // Quoted and multipart module names do not change the classification of a statement.
    test("classifies quoted and multipart names identically", async () => {
        assert.deepEqual(
            (await build('CREATE PROCEDURE [my schema]."p.1" WITH ENCRYPTION AS SELECT 1;')).map(
                ({ code }) => code,
            ),
            ["InvalidBuildModeStatementCreateProcedureWithEncryption"],
        );
        assert.deepEqual(
            (
                await build("CREATE TRIGGER [tr] ON [dbo].[t] AFTER INSERT AS BEGIN RETURN; END;")
            ).map(({ code }) => code),
            [],
        );
        assert.deepEqual(
            (await build("CREATE INDEX [i] ON [dbo].[t] ([a]) WITH ([DROP_EXISTING] = ON);")).map(
                ({ code }) => code,
            ),
            ["InvalidBuildModeStatementCreateIndex"],
        );
    });
});

suite("T-SQL build-mode code object validation", () => {
    // The unsupported system types are reported at the type, wherever the type appears.
    test("reports an unsupported data type with exact output", async () => {
        assert.deepEqual(await build("CREATE TABLE dbo.t2 (a geography);"), [
            {
                code: "InvalidBuildModeDataTypeUse",
                message:
                    "Using the 'geography' data type is not supported in a data-tier application. Remove the statement or change the data type before rebuilding.",
                severity: "error",
                text: "geography",
            },
        ]);
    });

    // All three unsupported types are named by their catalog spelling, whatever the source uses.
    test("names every unsupported type by its catalog spelling", async () => {
        for (const [source, name] of [
            ["GEOMETRY", "geometry"],
            ["sys.hierarchyid", "hierarchyid"],
            ["[geography]", "geography"],
        ]) {
            assert.deepEqual(
                (await build(`CREATE TABLE dbo.t2 (a ${source});`)).map(({ code, message }) => [
                    code,
                    message,
                ]),
                [
                    [
                        "InvalidBuildModeDataTypeUse",
                        `Using the '${name}' data type is not supported in a data-tier application. Remove the statement or change the data type before rebuilding.`,
                    ],
                ],
                source,
            );
        }
    });

    // The walk covers the whole CREATE statement, including a mounted module body.
    test("reports every unsupported type inside one statement", async () => {
        assert.deepEqual(
            (
                await build(
                    "CREATE PROCEDURE dbo.p @a geometry AS BEGIN DECLARE @g geography; SELECT 1; END;",
                )
            ).map(({ code, text }) => [code, text]),
            [
                ["InvalidBuildModeDataTypeUse", "geometry"],
                ["InvalidBuildModeDataTypeUse", "geography"],
            ],
        );
    });

    // Supported types, and unrelated identifiers that merely contain the name, stay silent.
    test("accepts supported types and similar identifiers", async () => {
        for (const sql of [
            "CREATE TABLE dbo.t2 (a int, b nvarchar(50), c xml);",
            "CREATE TABLE dbo.t2 (geography int);",
            "CREATE TABLE dbo.t2 (a dbo.geographies);",
        ]) {
            assert.deepEqual(await build(sql), [], sql);
        }
    });

    // EXECUTE AS SELF is ranged at the option, and its supported neighbours stay silent.
    test("reports EXECUTE AS SELF at the module option", async () => {
        assert.deepEqual(await build("CREATE PROCEDURE dbo.p WITH EXECUTE AS SELF AS SELECT 1;"), [
            {
                code: "InvalidBuildModeExecutionContextTypeSelf",
                message:
                    "EXECUTE AS SELF option is not supported in a data-tier application. Specify the principal name explicitly before rebuilding.",
                severity: "error",
                text: "EXECUTE AS SELF",
            },
        ]);
        assert.deepEqual(
            (
                await build(
                    "CREATE TRIGGER tr ON dbo.t WITH EXECUTE AS SELF AFTER INSERT AS BEGIN RETURN; END;",
                )
            ).map(({ code, text }) => [code, text]),
            [["InvalidBuildModeExecutionContextTypeSelf", "EXECUTE AS SELF"]],
        );
        assert.deepEqual(
            (
                await build(
                    "CREATE FUNCTION dbo.f () RETURNS int WITH EXECUTE AS SELF AS BEGIN RETURN 1; END;",
                )
            ).map(({ code, text }) => [code, text]),
            [["InvalidBuildModeExecutionContextTypeSelf", "EXECUTE AS SELF"]],
        );
        for (const principal of ["CALLER", "OWNER", "'dbo'"]) {
            assert.deepEqual(
                await build(`CREATE PROCEDURE dbo.p WITH EXECUTE AS ${principal} AS SELECT 1;`),
                [],
                principal,
            );
        }
    });

    // The code-object walk is independent of the statement-level result, so both are reported.
    test("reports a code object result alongside a statement result", async () => {
        assert.deepEqual(
            (await build("CREATE PROCEDURE dbo.p @a geography WITH ENCRYPTION AS SELECT 1;")).map(
                ({ code }) => code,
            ),
            [
                "InvalidBuildModeStatementCreateProcedureWithEncryption",
                "InvalidBuildModeDataTypeUse",
            ],
        );
    });

    // A rejected statement is not walked, so an unsupported type inside it is not reported twice.
    test("does not walk a statement the build never replays", async () => {
        assert.deepEqual(
            (await build("DECLARE @g geography;")).map(({ code }) => code),
            ["InvalidBuildModeSqlNullStatement"],
        );
    });
});

suite("T-SQL build-mode incremental equivalence", () => {
    const document = (text: string) =>
        new ImmutableTextSnapshot("file:///build-incremental.sql", 1, text);

    // An incremental result must equal a fresh analysis of the same final text and profile.
    test("matches a fresh analysis after an edit", async () => {
        const service = new LezerSyntaxService();
        const binder = new CatalogSemanticBinder();
        const provider = new InMemoryMetadataProvider(catalog);
        const profile: AnalysisProfile = { deploymentMode: "build" };
        const first = "CREATE TABLE dbo.t2 (a int);\nGO\nSELECT 1;\n";
        const final = "CREATE TABLE dbo.t2 (a geography);\nGO\nSELECT 1;\n";
        const initialSyntax = service.parse(document(first));
        const initial = binder.bind({ syntax: initialSyntax, metadata: provider.pin(), profile });
        const change = {
            start: first.indexOf("int"),
            end: first.indexOf("int") + 3,
            text: "geography",
        };
        const updatedSyntax = service.update(
            initialSyntax,
            new ImmutableTextSnapshot("file:///build-incremental.sql", 2, final),
            [change],
        );
        const updated = binder.update(initial, {
            syntax: updatedSyntax,
            metadata: provider.pin(),
            previous: initial,
            changedRanges: updatedSyntax.changedRanges,
            profile,
        });
        const fresh = binder.bind({
            syntax: service.parse(
                new ImmutableTextSnapshot("file:///build-incremental.sql", 2, final),
            ),
            metadata: provider.pin(),
            profile,
        });
        const normalize = (snapshot: SemanticSnapshot): string[] =>
            snapshot.diagnostics
                .map(({ code, message, range }) => `${code}:${range.start}:${range.end}:${message}`)
                .sort();
        assert.deepEqual(normalize(updated), normalize(fresh));
        assert.ok(
            normalize(fresh).some((entry) => entry.startsWith("InvalidBuildModeDataTypeUse")),
        );
    });
});
