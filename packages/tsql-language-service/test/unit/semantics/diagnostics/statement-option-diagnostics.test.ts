/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import * as api from "../../../../src/index.ts";
import type { SemanticDiagnostic, SemanticSnapshot } from "../../../../src/index.ts";
import { createSemanticHarness } from "../../support/semanticHarness.ts";
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    LezerSyntaxService,
} = api;

const { analyze, open } = createSemanticHarness({ uri: "file:///statement-options.sql" });

const family = (diagnostics: readonly SemanticDiagnostic[], code: string): SemanticDiagnostic[] =>
    diagnostics.filter((diagnostic) => diagnostic.code === code);
const observed = (sql: string, diagnostics: readonly SemanticDiagnostic[]) =>
    diagnostics.map(({ code, message, severity, range }) => ({
        code,
        message,
        severity,
        text: sql.slice(range.start, range.end),
    }));

suite("T-SQL EXECUTE option validation", () => {
    // EXECUTE accepts RECOMPILE, while a module-only option is diagnosed on the misplaced option.
    test("reports the exact misplaced module option", async () => {
        const sql = "EXEC dbo.p WITH ENCRYPTION;";
        assert.deepEqual(observed(sql, family(await analyze(sql), "InvalidExecuteOption")), [
            {
                code: "InvalidExecuteOption",
                message: 'An invalid option was specified for the statement "EXECUTE".',
                severity: "error",
                text: "ENCRYPTION",
            },
        ]);
    });

    // Every known module option that is illegal on EXECUTE remains classifiable without admitting
    // arbitrary identifiers into this recovery-sensitive tail.
    test("classifies each bounded invalid option form", async () => {
        for (const option of [
            "SCHEMABINDING",
            "VIEW_METADATA",
            "NATIVE_COMPILATION",
            "EXECUTE AS OWNER",
            "RETURNS NULL ON NULL INPUT",
            "CALLED ON NULL INPUT",
            "INLINE = ON",
        ]) {
            assert.equal(
                family(await analyze(`EXEC dbo.p WITH ${option};`), "InvalidExecuteOption").length,
                1,
                option,
            );
        }
    });

    // Legal EXECUTE options and the same words in module definitions stay silent.
    test("accepts legal options and keeps the rule statement-local", async () => {
        for (const sql of [
            "EXEC dbo.p WITH RECOMPILE;",
            "EXEC dbo.p WITH RESULT SETS NONE;",
            "CREATE PROCEDURE dbo.p WITH ENCRYPTION AS SELECT 1;",
        ]) {
            assert.deepEqual(family(await analyze(sql), "InvalidExecuteOption"), [], sql);
        }
    });

    // A damaged tail remains a syntax recovery problem instead of receiving a confident semantic
    // classification.
    test("does not classify a damaged option tail", async () => {
        const snapshot = await open("EXEC dbo.p WITH ENCRYPTION,");
        assert.notDeepEqual(snapshot.syntax.diagnostics, []);
        assert.deepEqual(family(snapshot.semantics.diagnostics, "InvalidExecuteOption"), []);
    });
});

suite("T-SQL legacy CREATE INDEX option validation", () => {
    // Legacy WITH syntax reports the option name with its original spelling and exact range.
    test("reports an invalid legacy option with exact output", async () => {
        const sql = "CREATE INDEX ix ON dbo.T (Id) WITH maxdop = 20;";
        assert.deepEqual(observed(sql, family(await analyze(sql), "InvalidUsageOfIndexOption")), [
            {
                code: "InvalidUsageOfIndexOption",
                message: "Invalid usage of the option maxdop in the CREATE INDEX statement.",
                severity: "error",
                text: "maxdop",
            },
        ]);
    });

    // Only the historical standalone flags and an assigned FILLFACTOR belong to this syntax.
    test("separates valid and invalid legacy options", async () => {
        const valid =
            "CREATE INDEX ix ON dbo.T (Id) WITH PAD_INDEX, SORT_IN_TEMPDB, IGNORE_DUP_KEY, STATISTICS_NORECOMPUTE, DROP_EXISTING, FILLFACTOR = 80;";
        assert.deepEqual(family(await analyze(valid), "InvalidUsageOfIndexOption"), []);
        for (const option of ["RANDOM_OPTION", "RANDOM_OPTION = 1", "STATISTICS_INCREMENTAL"]) {
            assert.equal(
                family(
                    await analyze(`CREATE INDEX ix ON dbo.T (Id) WITH ${option};`),
                    "InvalidUsageOfIndexOption",
                ).length,
                1,
                option,
            );
        }
    });

    // Once the option name itself is known to be invalid, a separately malformed value must not
    // hide that semantic result.
    test("keeps the invalid name diagnostic beside value recovery", async () => {
        const sql = "CREATE INDEX ix ON dbo.T (Id) WITH RANDOM_OPTION = ON;";
        const snapshot = await open(sql);
        assert.notDeepEqual(snapshot.syntax.diagnostics, []);
        assert.deepEqual(
            observed(sql, family(snapshot.semantics.diagnostics, "InvalidUsageOfIndexOption")),
            [
                {
                    code: "InvalidUsageOfIndexOption",
                    message:
                        "Invalid usage of the option RANDOM_OPTION in the CREATE INDEX statement.",
                    severity: "error",
                    text: "RANDOM_OPTION",
                },
            ],
        );
    });

    // Parenthesized modern options use their own option matrix and never enter the legacy rule.
    test("leaves modern option syntax to the modern validator", async () => {
        assert.deepEqual(
            family(
                await analyze("CREATE INDEX ix ON dbo.T (Id) WITH (MAXDOP = 2);"),
                "InvalidUsageOfIndexOption",
            ),
            [],
        );
    });

    // Incomplete assignment recovery suppresses a semantic classification.
    test("does not classify a damaged legacy option", async () => {
        const snapshot = await open("CREATE INDEX ix ON dbo.T (Id) WITH FILLFACTOR =;");
        assert.notDeepEqual(snapshot.syntax.diagnostics, []);
        assert.deepEqual(family(snapshot.semantics.diagnostics, "InvalidUsageOfIndexOption"), []);
    });
});

suite("T-SQL database-scoped configuration validation", () => {
    // The message names the setting, but the diagnostic range identifies its invalid value.
    test("reports exact output for an invalid MAXDOP value", async () => {
        const sql = "ALTER DATABASE SCOPED CONFIGURATION SET MAXDOP = ON;";
        assert.deepEqual(
            observed(sql, family(await analyze(sql), "InvalidUsageOfScopedConfiguration")),
            [
                {
                    code: "InvalidUsageOfScopedConfiguration",
                    message:
                        "Invalid usage of the scoped configuration MAXDOP in the ALTER DATABASE statement.",
                    severity: "error",
                    text: "ON",
                },
            ],
        );
    });

    // MAXDOP has an integer/PRIMARY value family; the three boolean settings use ON/OFF/PRIMARY.
    test("validates each known value family including secondary settings", async () => {
        for (const sql of [
            "ALTER DATABASE SCOPED CONFIGURATION SET MAXDOP = 8;",
            "ALTER DATABASE SCOPED CONFIGURATION SET MAXDOP = -1;",
            "ALTER DATABASE SCOPED CONFIGURATION SET MAXDOP = PRIMARY;",
            "ALTER DATABASE SCOPED CONFIGURATION SET LEGACY_CARDINALITY_ESTIMATION = ON;",
            "ALTER DATABASE SCOPED CONFIGURATION SET PARAMETER_SNIFFING = OFF;",
            "ALTER DATABASE SCOPED CONFIGURATION FOR SECONDARY SET QUERY_OPTIMIZER_HOTFIXES = PRIMARY;",
        ]) {
            assert.deepEqual(
                family(await analyze(sql), "InvalidUsageOfScopedConfiguration"),
                [],
                sql,
            );
        }
        for (const sql of [
            "ALTER DATABASE SCOPED CONFIGURATION SET MAXDOP = OFF;",
            "ALTER DATABASE SCOPED CONFIGURATION SET LEGACY_CARDINALITY_ESTIMATION = 1;",
            "ALTER DATABASE SCOPED CONFIGURATION FOR SECONDARY SET PARAMETER_SNIFFING = value;",
            "ALTER DATABASE SCOPED CONFIGURATION SET QUERY_OPTIMIZER_HOTFIXES = 'ON';",
        ]) {
            assert.equal(
                family(await analyze(sql), "InvalidUsageOfScopedConfiguration").length,
                1,
                sql,
            );
        }
    });

    // Unknown settings remain forward-compatible because their value contracts are server-owned.
    test("does not invent a value rule for an unknown setting", async () => {
        assert.deepEqual(
            family(
                await analyze("ALTER DATABASE SCOPED CONFIGURATION SET FUTURE_SETTING = value;"),
                "InvalidUsageOfScopedConfiguration",
            ),
            [],
        );
    });

    // Missing values remain syntax diagnostics and do not receive a semantic classification.
    test("does not classify a damaged setting", async () => {
        const snapshot = await open("ALTER DATABASE SCOPED CONFIGURATION SET MAXDOP =;");
        assert.notDeepEqual(snapshot.syntax.diagnostics, []);
        assert.deepEqual(
            family(snapshot.semantics.diagnostics, "InvalidUsageOfScopedConfiguration"),
            [],
        );
    });
});

suite("T-SQL statement option incremental equivalence", () => {
    // Incremental binding must produce the same three diagnostics as a fresh final snapshot.
    test("matches a fresh analysis after a batch-local edit", () => {
        const service = new LezerSyntaxService();
        const binder = new CatalogSemanticBinder();
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
            schemas: [{ database: "db", name: "dbo" }],
            databases: [{ name: "db" }],
        });
        const uri = "file:///statement-options-incremental.sql";
        const first = `EXEC dbo.p WITH RECOMPILE;
GO
CREATE INDEX ix ON dbo.T (Id) WITH DROP_EXISTING;
GO
ALTER DATABASE SCOPED CONFIGURATION SET MAXDOP = 8;`;
        const final = first
            .replace("RECOMPILE", "ENCRYPTION")
            .replace("DROP_EXISTING", "MAXDOP = 20")
            .replace("MAXDOP = 8", "MAXDOP = ON");
        const firstDocument = new ImmutableTextSnapshot(uri, 1, first);
        const initialSyntax = service.parse(firstDocument);
        const initial = binder.bind({ syntax: initialSyntax, metadata: provider.pin() });
        const updatedDocument = new ImmutableTextSnapshot(uri, 2, final);
        const updatedSyntax = service.update(initialSyntax, updatedDocument, [
            { start: 0, end: first.length, text: final },
        ]);
        const updated = binder.update(initial, {
            syntax: updatedSyntax,
            metadata: provider.pin(),
            previous: initial,
            changedRanges: updatedSyntax.changedRanges,
        });
        const fresh = binder.bind({
            syntax: service.parse(updatedDocument),
            metadata: provider.pin(),
        });
        const normalize = (snapshot: SemanticSnapshot): string[] =>
            snapshot.diagnostics
                .filter(({ code }) =>
                    [
                        "InvalidExecuteOption",
                        "InvalidUsageOfIndexOption",
                        "InvalidUsageOfScopedConfiguration",
                    ].includes(code),
                )
                .map(({ code, message, range }) => `${code}:${range.start}:${range.end}:${message}`)
                .sort();
        assert.deepEqual(normalize(updated), normalize(fresh));
        assert.equal(normalize(fresh).length, 3);
    });
});
