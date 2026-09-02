/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
    builtInArity,
    builtInsOfKind,
    formatSignature,
    lookupBuiltIn,
    type BuiltInArity,
    type BuiltInSignature,
} from "../../../src/index.ts";

const uri = "file:///registry.sql";

function requiredArity(name: string): BuiltInArity {
    const arity = builtInArity(name);
    assert.ok(arity, `${name} must publish an arity`);
    return arity;
}

function requiredSignature(name: string): BuiltInSignature {
    const signature = lookupBuiltIn(name, "routine")?.signatures?.[0];
    assert.ok(signature, `${name} must publish a signature`);
    return signature;
}

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
            const arity = requiredArity(entry.name);
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

    test("treats a repeated argument as unbounded", () => {
        for (const name of ["COALESCE", "CONCAT", "CONCAT_WS"]) {
            const signature = lookupBuiltIn(name, "routine")?.signatures?.[0];
            if (!signature?.parameters.some((parameter) => parameter.variadic)) continue;
            assert.equal(requiredArity(name).maximum, Number.POSITIVE_INFINITY, name);
        }
    });

    test("requires the documented values before a repeat", () => {
        assert.equal(requiredArity("COALESCE").minimum, 2);
        assert.equal(requiredArity("CONCAT").minimum, 2);
        assert.equal(requiredArity("CONCAT_WS").minimum, 3);
        assert.equal(requiredArity("AI_CLASSIFY").minimum, 3);
        assert.equal(requiredArity("AI_EXTRACT").minimum, 3);
        assert.match(
            formatSignature("COALESCE", requiredSignature("COALESCE")),
            /expression, expression, \.\.\.expression/u,
        );
    });

    test("publishes the documented REPLICATE contract", () => {
        assert.deepEqual(requiredArity("REPLICATE"), { minimum: 2, maximum: 2 });
        assert.equal(
            formatSignature("REPLICATE", requiredSignature("REPLICATE")),
            "REPLICATE(string_expression, integer_expression)",
        );
    });

    test("publishes optional AI arguments from the current syntax", () => {
        assert.deepEqual(requiredArity("AI_GENERATE_EMBEDDINGS"), {
            minimum: 2,
            maximum: 3,
        });
        assert.deepEqual(requiredArity("AI_GENERATE_RESPONSE"), {
            minimum: 1,
            maximum: 2,
        });
    });

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
        const signature = help.signatures[0];
        assert.ok(signature);
        assert.equal(signature.label, formatSignature("COALESCE", requiredSignature("COALESCE")));
        assert.equal(signature.parameters.length, 3);
    });

    test("enforces the derived count", async () => {
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
        });
        const analyze = async (sql: string): Promise<string[]> => {
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
        assert.deepEqual(await analyze("SELECT REPLICATE('x');"), [
            " The REPLICATE function requires 2 arguments.",
        ]);
    });

    test("serves REPLICATE signature help from the shared registry", async () => {
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            provider,
        );
        const sql = "SELECT REPLICATE('x', ";
        await runtime.open(uri, 1, sql);
        const features = new TsqlLanguageFeatureService(runtime, provider);

        const help = features.signatureHelp(uri, 1, sql.length);
        assert.ok(help);
        assert.equal(help.signatures[0]?.label, "REPLICATE(string_expression, integer_expression)");
        assert.equal(help.activeParameter, 1);
    });
});
