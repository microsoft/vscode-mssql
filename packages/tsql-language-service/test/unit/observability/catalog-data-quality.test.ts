/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogObserver,
    SimpleQueryMetadataAdapter,
    type SimpleQueryMetadataLoader,
} from "../../../src/index.ts";
import { defined } from "../support/assertions.ts";

suite("catalog data-quality observations", () => {
    test("reports unknown boundary values and truncation without retaining backend values", async () => {
        const observer = new CatalogObserver();
        const loader: SimpleQueryMetadataLoader = {
            async refresh(_executor, publisher) {
                publisher.reportDataQuality({
                    kind: "unknownValue",
                    field: "principal_kind",
                });
                publisher.reportDataQuality({
                    kind: "truncated",
                    section: "objects",
                    limit: 50_000,
                });
                publisher.replace({ completeness: { objects: "partial" } });
            },
            async hydrate() {},
        };
        const adapter = new SimpleQueryMetadataAdapter(
            { execute: async () => ({ columns: [], rows: [] }) },
            loader,
            observer,
        );

        await adapter.refresh();

        assert.deepEqual(defined(adapter.catalogStats()).dataQuality, [
            { kind: "unknownValue", field: "principal_kind", count: 1 },
            { kind: "truncated", section: "objects", limit: 50_000, count: 1 },
        ]);
        assert.equal(
            JSON.stringify(adapter.catalogStats()).includes("future-backend-value"),
            false,
        );
    });
});
