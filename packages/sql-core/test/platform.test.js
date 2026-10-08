/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    classifyPlatform,
    detectPlatform,
    hasQueryStore,
    hasQueryStoreWaitsAndLogMetrics,
} = require("../dist/index.js");

suite("platform", () => {
    test("classifies engine editions", () => {
        assert.equal(
            classifyPlatform({ engineEdition: 3, productVersion: "16.0.4135.4" }).platform,
            "sqlServer",
        );
        assert.equal(classifyPlatform({ engineEdition: 5 }).platform, "azureSqlDatabase");
        assert.equal(classifyPlatform({ engineEdition: 6 }).platform, "synapseDedicated");
        assert.equal(classifyPlatform({ engineEdition: 8 }).platform, "azureSqlManagedInstance");
        assert.equal(classifyPlatform({ engineEdition: 12 }).platform, "fabricSqlDatabase");
        assert.equal(classifyPlatform({ engineEdition: 9 }).platform, "unknown");
    });

    test("separates Fabric Warehouse, the SQL analytics endpoint, and Synapse serverless", () => {
        assert.equal(
            classifyPlatform({ engineEdition: 11, dataLakeLogPublishing: "AUTO" }).platform,
            "fabricWarehouse",
        );
        assert.equal(
            classifyPlatform({ engineEdition: 11, dataLakeLogPublishing: "UNSUPPORTED" }).platform,
            "fabricSqlAnalyticsEndpoint",
        );
        assert.equal(classifyPlatform({ engineEdition: 11 }).platform, "synapseServerless");
    });

    test("reports Query Store features by version", () => {
        const sql2016 = classifyPlatform({ engineEdition: 2, productVersion: "13.0.6300.2" });
        const sql2014 = classifyPlatform({ engineEdition: 2, productVersion: "12.0.6024.0" });
        assert.equal(sql2016.majorVersion, 13);
        assert.equal(hasQueryStore(sql2016), true);
        assert.equal(hasQueryStoreWaitsAndLogMetrics(sql2016), false);
        assert.equal(hasQueryStore(sql2014), false);
        assert.equal(hasQueryStoreWaitsAndLogMetrics(classifyPlatform({ engineEdition: 5 })), true);
        assert.equal(hasQueryStore(classifyPlatform({ engineEdition: 6 })), false);
    });

    test("detects the platform through a reader", async () => {
        const reader = {
            read: async () => [
                {
                    columns: ["engine_edition", "product_version", "data_lake_log_publishing"],
                    rows: [[11, "12.0.2000.8", "AUTO"]],
                },
            ],
        };
        assert.deepEqual(await detectPlatform(reader), {
            platform: "fabricWarehouse",
            engineEdition: 11,
        });
    });
});
