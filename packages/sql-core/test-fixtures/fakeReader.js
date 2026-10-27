/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * A fake SqlReader and result set builders for the tests.
 */

const { classifyPlatform } = require("../dist/index.js");
const { queryStoreMetrics } = require("../dist/queryStore/index.js");

/**
 * Returns a reader that answers each batch with the next response. A response that is an Error
 * is thrown. `calls` has the SQL of each batch, and `options` its read options.
 */
function scriptedReader(responses) {
    const calls = [];
    // The read options of each batch, such as an abort signal and a timeout.
    const options = [];
    return {
        calls,
        options,
        read: async (sql, readOptions) => {
            calls.push(sql);
            options.push(readOptions);
            const response = responses.shift();
            if (response instanceof Error) {
                throw response;
            }
            return response ?? [];
        },
    };
}

const resultSet = (columns, rows = []) => ({ columns, rows });

/** The Query Store state result set that starts every Query Store read. */
const stateSet = (state = 2, readOnlyReason = 0) =>
    resultSet(["actual_state", "readonly_reason"], [[state, readOnlyReason]]);

const platforms = {
    sql2014: classifyPlatform({ engineEdition: 3, productVersion: "12.0.6024.0" }),
    sql2016: classifyPlatform({ engineEdition: 3, productVersion: "13.0.6300.2" }),
    sql2022: classifyPlatform({ engineEdition: 3, productVersion: "16.0.4135.4" }),
    azureSql: classifyPlatform({ engineEdition: 5 }),
    managedInstance: classifyPlatform({ engineEdition: 8 }),
    fabricSqlDatabase: classifyPlatform({ engineEdition: 12 }),
    fabricWarehouse: classifyPlatform({ engineEdition: 11, dataLakeLogPublishing: "AUTO" }),
};

/** The capabilities of SQL Server 2022 without replica groups, with overrides. */
function capabilities(overrides = {}) {
    return {
        platform: platforms.sql2022,
        supported: true,
        metrics: queryStoreMetrics,
        hasPlanForcingType: true,
        hasPlanType: true,
        hasReplicaGroups: false,
        hasCapturePolicy: true,
        hasWaitStatsCapture: true,
        hasWaitStatsReplicaGroups: false,
        ...overrides,
    };
}

module.exports = { capabilities, platforms, resultSet, scriptedReader, stateSet };
