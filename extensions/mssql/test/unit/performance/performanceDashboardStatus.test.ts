/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { PerfStatus } from "../../../src/sharedInterfaces/performance";
import { readStatusMessage } from "../../../src/webviews/pages/PerformanceDashboard/performanceDashboardStatus";

const result = (status: PerfStatus, errorMessage?: string) => ({
    loading: false,
    result: {
        status,
        platform: "azureSqlDatabase" as const,
        observedAtUtc: "2026-10-08T00:00:00.000Z",
        missing: [],
        ...(errorMessage ? { error: { message: errorMessage } } : {}),
    },
});

suite("Performance dashboard status", () => {
    test("shows nothing while loading, or when there is data or no rows", () => {
        expect(readStatusMessage({ loading: true })).to.be.undefined;
        expect(readStatusMessage(result("ready"))).to.be.undefined;
        expect(readStatusMessage(result("noData"))).to.be.undefined;
    });

    test("explains why Query Store data is missing", () => {
        expect(readStatusMessage(result("notConfigured"))?.intent).to.equal("info");
        expect(readStatusMessage(result("notConfigured"))?.text).to.match(/Query Store is off/);
        expect(readStatusMessage(result("unsupported"))?.intent).to.equal("info");
        expect(readStatusMessage(result("permissionMissing"))?.text).to.match(
            /VIEW DATABASE STATE/,
        );
        expect(readStatusMessage(result("temporarilyUnavailable", "Timeout"))?.intent).to.equal(
            "warning",
        );
        expect(readStatusMessage(result("failed", "Invalid column"))).to.deep.equal({
            intent: "error",
            text: "Could not read the data: Invalid column",
        });
    });

    test("explains why the database cannot be read", () => {
        expect(
            readStatusMessage({
                loading: false,
                result: {
                    status: "unavailable",
                    reason: "connectionFailed",
                    detail: "Login failed",
                },
            }),
        ).to.deep.equal({
            intent: "error",
            text: "Could not read from the database: Login failed",
        });
        expect(
            readStatusMessage({
                loading: false,
                result: { status: "unavailable", reason: "dataPlaneDisabled" },
            })?.text,
        ).to.match(/mssql\.sqlDataPlane\.enabled/);
        expect(readStatusMessage({ loading: false, errorMessage: "Request failed" })).to.deep.equal(
            { intent: "error", text: "Could not read the data: Request failed" },
        );
    });
});
