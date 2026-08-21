/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import * as api from "../../../../src/index.ts";
import type {
    InMemoryMetadataInput,
    MetadataSectionState,
    SemanticSnapshot,
} from "../../../../src/index.ts";
// A login is authenticated by a server-scoped security object while a user is mapped to one in the
// current database, so each statement searches its own scope; a credential is always server-scoped.
// Collation names resolve against the server's collation catalog, with database_default always
// valid. Every result requires an authoritative catalog: an unready section reports nothing.
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
    // Both catalogs are server-scoped and only authoritative once a backend publishes them.
    completeness: { securables: "ready", collations: "ready" },
    principals: [{ id: "login", database: "db", name: "KnownLogin", kind: "login" }],
    securables: [
        { id: "c1", name: "ServerCert", kind: "certificate" },
        { id: "k1", name: "ServerKey", kind: "asymmetricKey" },
        { id: "cr1", name: "ServerCredential", kind: "credential" },
        { id: "c2", name: "DbCert", kind: "certificate", database: "db" },
        { id: "k2", name: "DbKey", kind: "asymmetricKey", database: "db" },
    ],
    collations: ["SQL_Latin1_General_CP1_CI_AS", "Latin1_General_100_CI_AS_SC"],
} satisfies InMemoryMetadataInput;

interface AnalyzePatch extends InMemoryMetadataInput {
    readonly allowSyntaxDiagnostics?: boolean;
}

async function analyze(sql: string, patch: AnalyzePatch = {}) {
    const { allowSyntaxDiagnostics = false, ...metadataPatch } = patch;
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        new InMemoryMetadataProvider({ ...catalog, ...metadataPatch }),
    );
    const snapshot = await runtime.open("file:///security.sql", 1, sql);
    if (!allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics.map(({ code, message, severity, range }) => ({
        code,
        message,
        severity,
        text: sql.slice(range.start, range.end),
    }));
}

const codes = (diagnostics: readonly { readonly code: string }[]): string[] =>
    diagnostics.map(({ code }) => code);

suite("T-SQL security object validation", () => {
    // Exact output for each security object a principal statement can name.
    test("reports each missing security object with exact output", async () => {
        assert.deepEqual(await analyze("CREATE LOGIN l FROM CERTIFICATE MissingCert;"), [
            {
                code: "CouldNotFindCertificate",
                message:
                    "Cannot find the certificate 'MissingCert', because it does not exist or you do not have permission.",
                severity: "error",
                text: "MissingCert",
            },
        ]);
        assert.deepEqual(await analyze("CREATE LOGIN l FROM ASYMMETRIC KEY MissingKey;"), [
            {
                code: "CouldNotFindAsymmetricKey",
                message:
                    "Cannot find the assymetric key 'MissingKey', because it does not exist or you do not have permission.",
                severity: "error",
                text: "MissingKey",
            },
        ]);
        assert.deepEqual(
            await analyze("CREATE LOGIN l WITH PASSWORD = 'p', CREDENTIAL = MissingCredential;"),
            [
                {
                    code: "CouldNotFindCredential",
                    message:
                        "Cannot find the credential 'MissingCredential', because it does not exist or you do not have permission.",
                    severity: "error",
                    text: "MissingCredential",
                },
            ],
        );
    });

    // Every security object the catalog contains in the right scope stays silent.
    test("accepts security objects the catalog contains", async () => {
        for (const sql of [
            "CREATE LOGIN l FROM CERTIFICATE ServerCert;",
            "CREATE LOGIN l FROM ASYMMETRIC KEY ServerKey;",
            "CREATE LOGIN l WITH PASSWORD = 'p', CREDENTIAL = ServerCredential;",
            "CREATE USER u FOR CERTIFICATE DbCert;",
            "CREATE USER u FROM ASYMMETRIC KEY DbKey;",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // A login searches the server scope and a user searches the database scope; they do not mix.
    test("keeps the server and database scopes separate", async () => {
        assert.deepEqual(codes(await analyze("CREATE USER u FOR CERTIFICATE ServerCert;")), [
            "CouldNotFindCertificate",
        ]);
        assert.deepEqual(codes(await analyze("CREATE LOGIN l FROM CERTIFICATE DbCert;")), [
            "CouldNotFindCertificate",
        ]);
        assert.deepEqual(codes(await analyze("CREATE USER u FROM ASYMMETRIC KEY ServerKey;")), [
            "CouldNotFindAsymmetricKey",
        ]);
    });

    // Quoted names normalize to the same catalog name, and matching is case-insensitive here.
    test("handles quoted and case-varied names", async () => {
        assert.deepEqual(await analyze("CREATE LOGIN l FROM CERTIFICATE [ServerCert];"), []);
        assert.deepEqual(await analyze("CREATE LOGIN l FROM CERTIFICATE servercert;"), []);
        assert.deepEqual(codes(await analyze('CREATE LOGIN l FROM CERTIFICATE "Server Cert";')), [
            "CouldNotFindCertificate",
        ]);
    });

    // Principal statements that name no security object are untouched.
    test("does not report unrelated principal statements", async () => {
        for (const sql of [
            "CREATE LOGIN l FROM WINDOWS;",
            "CREATE LOGIN l WITH PASSWORD = 'p';",
            "CREATE USER u FOR LOGIN KnownLogin;",
            "CREATE USER u WITHOUT LOGIN;",
            "CREATE ROLE r;",
        ]) {
            assert.deepEqual(
                codes(await analyze(sql)).filter((code) => code.startsWith("CouldNotFind")),
                [],
                sql,
            );
        }
    });

    // Absence is only authoritative from a ready securables section.
    test("never reports from an unready securables section", async () => {
        const states: readonly MetadataSectionState[] = [
            "loading",
            "partial",
            "stale",
            "unknown",
            "failed",
        ];
        for (const state of states) {
            assert.deepEqual(
                await analyze("CREATE LOGIN l FROM CERTIFICATE MissingCert;", {
                    completeness: { ...catalog.completeness, securables: state },
                }),
                [],
                state,
            );
        }
    });

    // Damaged input never invents a missing security object.
    test("stays silent on malformed editor input", async () => {
        for (const sql of [
            "CREATE LOGIN l FROM CERTIFICATE",
            "CREATE USER u FOR ASYMMETRIC",
            "CREATE LOGIN",
        ]) {
            assert.deepEqual(
                codes(await analyze(sql, { allowSyntaxDiagnostics: true })).filter((code) =>
                    code.startsWith("CouldNotFind"),
                ),
                [],
                sql,
            );
        }
    });
});

suite("T-SQL collation validation", () => {
    // Exact output for a name the server's collation catalog does not contain.
    test("reports an invalid collation with exact output", async () => {
        assert.deepEqual(
            await analyze("CREATE TABLE dbo.t (a nvarchar(10) COLLATE Bogus_CI_AS);"),
            [
                {
                    code: "InvalidCollation",
                    message: "Invalid collation 'Bogus_CI_AS'.",
                    severity: "error",
                    text: "Bogus_CI_AS",
                },
            ],
        );
    });

    // Every position the grammar accepts a collation name is validated the same way.
    test("validates every collation position", async () => {
        for (const sql of [
            "CREATE TABLE dbo.t (a nvarchar(10) COLLATE Bogus_CI_AS);",
            "ALTER DATABASE db COLLATE Bogus_CI_AS;",
            "CREATE DATABASE d COLLATE Bogus_CI_AS;",
        ]) {
            assert.deepEqual(codes(await analyze(sql)), ["InvalidCollation"], sql);
        }
    });

    // A catalog name and database_default both resolve, whatever their casing.
    test("accepts catalog collations and database_default", async () => {
        for (const collation of [
            "SQL_Latin1_General_CP1_CI_AS",
            "sql_latin1_general_cp1_ci_as",
            "Latin1_General_100_CI_AS_SC",
            "DATABASE_DEFAULT",
            "database_default",
        ]) {
            assert.deepEqual(
                await analyze(`CREATE TABLE dbo.t (a nvarchar(10) COLLATE ${collation});`),
                [],
                collation,
            );
        }
    });

    // An unavailable collation catalog must never become an invalid-collation result.
    test("never reports from an unavailable collation catalog", async () => {
        const states: readonly MetadataSectionState[] = ["unknown", "failed"];
        for (const state of states) {
            assert.deepEqual(
                await analyze("CREATE TABLE dbo.t (a nvarchar(10) COLLATE Bogus_CI_AS);", {
                    completeness: { ...catalog.completeness, collations: state },
                }),
                [],
                state,
            );
        }
    });

    // Statements with no collation at all are untouched.
    test("does not report unrelated statements", async () => {
        for (const sql of [
            "CREATE TABLE dbo.t (a nvarchar(10));",
            "SELECT 1;",
            "CREATE DATABASE d;",
        ]) {
            assert.deepEqual(
                codes(await analyze(sql)).filter((code) => code === "InvalidCollation"),
                [],
                sql,
            );
        }
    });

    // Damaged input never invents a collation result.
    test("stays silent on malformed editor input", async () => {
        for (const sql of ["CREATE TABLE dbo.t (a nvarchar(10) COLLATE", "SELECT 1 COLLATE"]) {
            assert.deepEqual(
                codes(await analyze(sql, { allowSyntaxDiagnostics: true })).filter(
                    (code) => code === "InvalidCollation",
                ),
                [],
                sql,
            );
        }
    });
});

suite("T-SQL security and collation incremental equivalence", () => {
    // Incremental analysis of the same final text and generation must equal a fresh analysis.
    test("matches a fresh analysis after an edit", async () => {
        const service = new LezerSyntaxService();
        const binder = new CatalogSemanticBinder();
        const provider = new InMemoryMetadataProvider(catalog);
        const uri = "file:///security-incremental.sql";
        const first = "SELECT 1;\nGO\nCREATE LOGIN l FROM CERTIFICATE ServerCert;\n";
        const final = "SELECT 1;\nGO\nCREATE LOGIN l FROM CERTIFICATE OtherCert;\n";
        const initialSyntax = service.parse(new ImmutableTextSnapshot(uri, 1, first));
        const initial = binder.bind({ syntax: initialSyntax, metadata: provider.pin() });
        assert.deepEqual(initial.diagnostics, []);
        const change = {
            start: first.indexOf("ServerCert"),
            end: first.indexOf("ServerCert") + "ServerCert".length,
            text: "OtherCert",
        };
        const updatedSyntax = service.update(
            initialSyntax,
            new ImmutableTextSnapshot(uri, 2, final),
            [change],
        );
        const updated = binder.update(initial, {
            syntax: updatedSyntax,
            metadata: provider.pin(),
            previous: initial,
            changedRanges: updatedSyntax.changedRanges,
        });
        const fresh = binder.bind({
            syntax: service.parse(new ImmutableTextSnapshot(uri, 2, final)),
            metadata: provider.pin(),
        });
        const normalize = (snapshot: SemanticSnapshot): string[] =>
            snapshot.diagnostics
                .map(({ code, message, range }) => `${code}:${range.start}:${range.end}:${message}`)
                .sort();
        assert.deepEqual(normalize(updated), normalize(fresh));
        assert.equal(normalize(fresh).length, 1);
    });
});
