/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { describeError } from "../../src/core/catalog";
import { capabilitiesFrom } from "../../src/core/platform";
import { activeRequests, topWorkload } from "../../src/diagnostics/dmv/catalog";

void test("execution DMV errors name database state on Azure SQL Database", () => {
    const capabilities = capabilitiesFrom({ engineEditionId: 5, majorVersion: 16 });
    const message = describeError(
        new Error("The SELECT permission was denied."),
        activeRequests,
        capabilities,
    );
    assert.match(message, /VIEW DATABASE STATE/);
    assert.doesNotMatch(message, /VIEW SERVER STATE/);
});

void test("execution DMV permission wording remains server-scoped on SQL Server", () => {
    const capabilities = capabilitiesFrom({ engineEditionId: 3, majorVersion: 16 });
    const message = describeError(
        new Error("The SELECT permission was denied."),
        topWorkload,
        capabilities,
    );
    assert.match(message, /VIEW SERVER STATE/);
});
