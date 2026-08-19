/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
    builtInArity,
    builtInsOfKind,
    formatSignature,
    lookupBuiltIn,
} = require("../../dist/index.js");

const uri = "file:///registry.sql";

suite("built-in registry consistency", () => {
    // The parameter list a user reads in signature help and the count a diagnostic enforces are
    // the same fact. Deriving one from the other is what stops them drifting apart.
    test("derives argument counts from the published signatures", () => {
        for (const entry of builtInsOfKind("routine")) {
            if (!entry.signatures || entry.signatures.length === 0) {
                assert.equal(
                    builtInArity(entry.name),
                    undefined,
                    `${entry.name} has a count without a signature to justify it`,
                );
                continue;
            }
            const arity = builtInArity(entry.name);
            assert.ok(arity, `${entry.name} publishes signatures but no count`);
            assert.ok(
                arity.minimum <= arity.maximum,
                `${entry.name} requires more arguments than it accepts`,
            );
            for (const signature of entry.signatures) {
                const named = signature.parameters.filter((parameter) => !parameter.variadic);
                const required = named.filter((parameter) => !parameter.optional);
                assert.ok(
                    arity.minimum <= required.length,
                    `${entry.name} requires fewer arguments than one of its signatures`,
                );
                if (Number.isFinite(arity.maximum)) {
                    assert.ok(
                        arity.maximum >= named.length,
                        `${entry.name} accepts fewer arguments than one of its signatures names`,
                    );
                }
            }
        }
    });

    // A routine that repeats its last argument has no upper bound. Reporting one would reject a
    // call the engine accepts.
    test("treats a repeated argument as unbounded", () => {
        for (const name of ["COALESCE", "CONCAT", "CONCAT_WS"]) {
            const entry = lookupBuiltIn(name, "routine");
            if (!entry?.signatures?.[0]) continue;
            if (!entry.signatures[0].parameters.some((parameter) => parameter.variadic)) continue;
            assert.equal(builtInArity(name).maximum, Number.POSITIVE_INFINITY, name);
        }
    });

    // `COALESCE(x)` and `CONCAT(x)` are errors in SQL Server: both need two values before the
    // repeat. The registry has to say so, because both the diagnostic and the help read it.
    test("requires two values before a repeat where the engine does", () => {
        assert.equal(builtInArity("COALESCE").minimum, 2);
        assert.equal(builtInArity("CONCAT").minimum, 2);
        assert.match(
            formatSignature("COALESCE", lookupBuiltIn("COALESCE", "routine").signatures[0]),
            /expression, expression, \.\.\.expression/u,
        );
    });

    // The registry drives what the editor says as well as what the validator enforces, so a name
    // it describes has to reach signature help through the same lookup.
    test("answers signature help from the same entry a diagnostic reads", async () => {
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            provider,
        );
        const sql = "SELECT COALESCE(1, 2);";
        await runtime.open(uri, 1, sql);
        const features = new TsqlLanguageFeatureService(runtime, provider);

        const help = features.signatureHelp(uri, 1, sql.indexOf("1, 2"));
        assert.ok(help);
        assert.equal(
            help.signatures[0].label,
            formatSignature("COALESCE", lookupBuiltIn("COALESCE", "routine").signatures[0]),
        );
        assert.equal(help.signatures[0].parameters.length, 3);
    });

    // A one-argument COALESCE is reported, and a two-argument one is not: the count the registry
    // derives is the count the validator enforces.
    test("enforces the derived count", async () => {
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
        });
        const analyze = async (sql) => {
            const runtime = new InProcessLanguageServiceRuntime(
                new LezerSyntaxService(),
                new CatalogSemanticBinder(),
                provider,
            );
            const snapshot = await runtime.open(uri, 1, sql);
            return snapshot.semantics.diagnostics.map(({ message }) => message);
        };

        assert.deepEqual(await analyze("SELECT COALESCE(1, 2);"), []);
        assert.deepEqual(await analyze("SELECT COALESCE(1);"), [
            "Function 'COALESCE' requires at least 2 arguments.",
        ]);
    });
});
