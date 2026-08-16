/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("broker-priority.sql");

suite("T-SQL Service Broker priority grammar", () => {
    // Covers the complete CREATE/ALTER/DROP lifecycle and every documented matching option.
    test("parses broker priority lifecycle statements", () => {
        const snapshot = parse(`
CREATE BROKER PRIORITY bp1 FOR CONVERSATION;
CREATE BROKER PRIORITY bp2 FOR CONVERSATION SET (
    PRIORITY_LEVEL = 5,
    CONTRACT_NAME = contract_name,
    REMOTE_SERVICE_NAME = 'remote',
    LOCAL_SERVICE_NAME = ANY
);
GO
ALTER BROKER PRIORITY bp2 FOR CONVERSATION SET (PRIORITY_LEVEL = DEFAULT);
DROP BROKER PRIORITY bp1;
`);

        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(
            (snapshot.tree.toString().match(/BrokerPriorityStatement\(/gu) ?? []).length,
            4,
        );
    });

    // Keeps a missing option value visible instead of swallowing it as an opaque statement tail.
    test("reports a missing broker priority option value", () => {
        const snapshot = parse(
            "CREATE BROKER PRIORITY bp FOR CONVERSATION SET (PRIORITY_LEVEL = );",
        );

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.ok(
            snapshot.diagnostics.some(({ message }) =>
                /Incorrect syntax near '\)'\./u.test(message),
            ),
        );
    });
});
