/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Serverless auto-pause wake handling on data-plane opens (classic-path
 * parity port): ARM status runs in parallel and is only peeked; wake-retryable
 * failures retry silently while the database is Paused/Pausing/Resuming;
 * everything else fails exactly as before, and ineligible profiles pay zero
 * ARM traffic.
 */

import { expect } from "chai";
import {
    DataPlaneErrorCodes,
    SqlConnectionProfileRef,
    SqlDataPlaneError,
} from "../../src/services/sqlDataPlane/api";
import {
    canCheckPauseStatus,
    isServerlessWakeRetryable,
    openWithServerlessWake,
} from "../../src/services/sqlDataPlane/serverlessWake";

function azureProfile(overrides?: Partial<SqlConnectionProfileRef>): SqlConnectionProfileRef {
    return {
        profileFingerprint: "sfp_test",
        server: "myserver.database.windows.net",
        database: "AppDb",
        authKind: "aad",
        accountId: "account-1",
        tenantId: "tenant-1",
        ...overrides,
    };
}

const timeoutError = () =>
    new SqlDataPlaneError(DataPlaneErrorCodes.clientTimeout, "deadline expired", true, {
        synthesized: true,
    });

suite("Data plane serverless wake", () => {
    test("eligibility mirrors the classic gate", () => {
        expect(canCheckPauseStatus(azureProfile())).to.equal(true);
        // Not Entra
        expect(canCheckPauseStatus(azureProfile({ authKind: "sql" }))).to.equal(false);
        // No account identity
        expect(canCheckPauseStatus(azureProfile({ accountId: undefined }))).to.equal(false);
        // Not an Azure SQL host
        expect(canCheckPauseStatus(azureProfile({ server: "localhost" }))).to.equal(false);
        // Default / system databases have no per-database ARM resource
        expect(canCheckPauseStatus(azureProfile({ database: undefined }))).to.equal(false);
        expect(canCheckPauseStatus(azureProfile({ database: "master" }))).to.equal(false);
    });

    test("retryability: synthesized deadline, retryable unavailability, 40613", () => {
        expect(isServerlessWakeRetryable(timeoutError())).to.equal(true);
        expect(
            isServerlessWakeRetryable(
                new SqlDataPlaneError(DataPlaneErrorCodes.unavailable, "down", true),
            ),
        ).to.equal(true);
        expect(
            isServerlessWakeRetryable(
                new SqlDataPlaneError(DataPlaneErrorCodes.queryFailed, "not available", false, {
                    server: { number: 40613 },
                }),
            ),
        ).to.equal(true);
        expect(
            isServerlessWakeRetryable(
                new SqlDataPlaneError(DataPlaneErrorCodes.auth, "login failed", false),
            ),
        ).to.equal(false);
        expect(isServerlessWakeRetryable(new Error("plain"))).to.equal(false);
    });

    test("ineligible profile: exactly one open, zero ARM calls", async () => {
        let statusCalls = 0;
        let opens = 0;
        const result = await openWithServerlessWake(
            azureProfile({ authKind: "sql" }),
            async () => {
                opens++;
                return "session";
            },
            { getStatus: async () => (statusCalls++, "Paused"), delayMs: 1 },
        );
        expect(result).to.equal("session");
        expect(opens).to.equal(1);
        expect(statusCalls).to.equal(0);
    });

    test("paused database: timeout retries silently and succeeds once resumed", async () => {
        let opens = 0;
        const result = await openWithServerlessWake(
            azureProfile(),
            async () => {
                opens++;
                if (opens === 1) {
                    throw timeoutError();
                }
                return "session";
            },
            { getStatus: async () => "Paused", delayMs: 1 },
        );
        expect(result).to.equal("session");
        expect(opens).to.equal(2);
    });

    test("online database: the timeout surfaces unchanged (no wake retry)", async () => {
        let opens = 0;
        const failure = timeoutError();
        let caught: unknown;
        try {
            await openWithServerlessWake(
                azureProfile(),
                async () => {
                    opens++;
                    throw failure;
                },
                { getStatus: async () => "Online", delayMs: 1 },
            );
        } catch (e) {
            caught = e;
        }
        expect(caught).to.equal(failure);
        expect(opens).to.equal(1);
    });

    test("unsettled ARM check forfeits the retry rather than waiting", async () => {
        let opens = 0;
        let caught: unknown;
        try {
            await openWithServerlessWake(
                azureProfile(),
                async () => {
                    opens++;
                    throw timeoutError();
                },
                // Never settles — the peek must not block on it.
                { getStatus: () => new Promise<string>(() => undefined), delayMs: 1 },
            );
        } catch (e) {
            caught = e;
        }
        expect(caught).to.be.instanceOf(SqlDataPlaneError);
        expect(opens).to.equal(1);
    });

    test("non-retryable failures surface immediately even while paused", async () => {
        let opens = 0;
        let caught: unknown;
        try {
            await openWithServerlessWake(
                azureProfile(),
                async () => {
                    opens++;
                    throw new SqlDataPlaneError(DataPlaneErrorCodes.auth, "login failed", false);
                },
                { getStatus: async () => "Paused", delayMs: 1 },
            );
        } catch (e) {
            caught = e;
        }
        expect((caught as SqlDataPlaneError).code).to.equal(DataPlaneErrorCodes.auth);
        expect(opens).to.equal(1);
    });

    test("retries are capped at the classic attempt limit", async () => {
        let opens = 0;
        let caught: unknown;
        try {
            await openWithServerlessWake(
                azureProfile(),
                async () => {
                    opens++;
                    throw timeoutError();
                },
                { getStatus: async () => "Resuming", delayMs: 1 },
            );
        } catch (e) {
            caught = e;
        }
        // 1 initial + SERVERLESS_WAKE_MAX_RETRY_ATTEMPTS retries
        expect(opens).to.equal(3);
        expect(caught).to.be.instanceOf(SqlDataPlaneError);
    });
});
