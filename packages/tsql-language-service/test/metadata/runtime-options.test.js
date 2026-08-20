/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    defaultMetadataRuntimeOptions,
    resolveMetadataRuntimeOptions,
} = require("../../dist/index.js");

suite("metadata runtime options", () => {
    test("publishes documented, finite defaults suitable for large catalogs", () => {
        assert.deepEqual(defaultMetadataRuntimeOptions, {
            objectPageSize: 20_000,
            objectResultLimit: 250_000,
            detailResultLimit: 50_000,
            catalogSessionCacheSize: 8,
            definitionCacheSize: 32,
            defaultSchema: "dbo",
            interactiveLatencyBudgetMs: 1_000,
            emptyCompletionLatencyBudgetMs: 5_000,
        });
        assert.equal(Object.isFrozen(defaultMetadataRuntimeOptions), true);
    });

    test("validates overrides instead of accepting unusable limits", () => {
        assert.deepEqual(
            resolveMetadataRuntimeOptions({ objectPageSize: 123, defaultSchema: "app" }),
            {
                ...defaultMetadataRuntimeOptions,
                objectPageSize: 123,
                defaultSchema: "app",
            },
        );
        for (const options of [
            { objectPageSize: 0 },
            { objectResultLimit: 1.5 },
            { detailResultLimit: Number.POSITIVE_INFINITY },
            { catalogSessionCacheSize: -1 },
            { definitionCacheSize: 0 },
            { defaultSchema: "  " },
            { interactiveLatencyBudgetMs: -1 },
        ]) {
            assert.throws(() => resolveMetadataRuntimeOptions(options), /metadata runtime option/i);
        }
    });
});
