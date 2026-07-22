/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    effectIdFromLocalSqlContainerLeaseRef,
    isOwnedLocalSqlContainer,
    localSqlContainerLabels,
    localSqlContainerLeaseRef,
    summarizeLocalSqlConnectionFailure,
    validateLocalSqlContainerIdentity,
    waitForLocalSqlContainerAuthentication,
} from "../../src/runbookStudio/runtime/localContainerOperations";

suite("Runbook Studio local SQL container policy", () => {
    const effectId = `effect-${"a".repeat(64)}`;

    test("admits a bounded owned SQL container identity", () => {
        expect(
            validateLocalSqlContainerIdentity({
                containerName: "rbs-wwi-workload",
                databaseName: "WWI_2",
                version: "2022",
                port: 14333,
            }),
        ).to.deep.equal({
            containerName: "rbs-wwi-workload",
            databaseName: "WWI_2",
            version: "2022",
            port: 14333,
        });
    });

    test("refuses unsafe names, system databases, versions, and ports", () => {
        const base = {
            containerName: "rbs-wwi",
            databaseName: "WWI_2",
            version: "2022",
            port: 14333,
        };
        expect(validateLocalSqlContainerIdentity({ ...base, containerName: "wwi" })).to.equal(
            undefined,
        );
        expect(validateLocalSqlContainerIdentity({ ...base, databaseName: "master" })).to.equal(
            undefined,
        );
        expect(validateLocalSqlContainerIdentity({ ...base, version: "latest" })).to.equal(
            undefined,
        );
        expect(validateLocalSqlContainerIdentity({ ...base, port: 80 })).to.equal(undefined);
    });

    test("round-trips only an opaque container lease", () => {
        const lease = localSqlContainerLeaseRef(effectId);
        expect(effectIdFromLocalSqlContainerLeaseRef(lease)).to.equal(effectId);
        expect(effectIdFromLocalSqlContainerLeaseRef("runbook-sql-container-lease:bad")).to.equal(
            undefined,
        );
    });

    test("requires every exact owner label before cleanup", () => {
        const labels = localSqlContainerLabels(effectId, "run_1");
        expect(isOwnedLocalSqlContainer(labels, effectId, "run_1")).to.equal(true);
        expect(isOwnedLocalSqlContainer(labels, effectId, "run_2")).to.equal(false);
        expect(
            isOwnedLocalSqlContainer({ ...labels, Object: "changed" }, effectId, "run_1"),
        ).to.equal(true);
        const changed = { ...labels };
        changed["com.microsoft.mssql.runbook-studio.kind"] = "other";
        expect(isOwnedLocalSqlContainer(changed, effectId, "run_1")).to.equal(false);
    });

    test("waits for authenticated readiness after transient startup failures", async () => {
        let now = 0;
        let attempts = 0;
        let resets = 0;
        const ready = await waitForLocalSqlContainerAuthentication(
            async () => ++attempts === 3,
            async () => {
                resets++;
            },
            () => false,
            {
                timeoutMs: 3000,
                retryDelayMs: 1000,
                now: () => now,
                wait: async (milliseconds) => {
                    now += milliseconds;
                },
            },
        );

        expect(ready).to.equal(true);
        expect(attempts).to.equal(3);
        expect(resets).to.equal(2);
    });

    test("bounds authenticated readiness and honors cancellation", async () => {
        let now = 0;
        let attempts = 0;
        const ready = await waitForLocalSqlContainerAuthentication(
            async () => {
                attempts++;
                return false;
            },
            async () => undefined,
            () => false,
            {
                timeoutMs: 2000,
                retryDelayMs: 1000,
                now: () => now,
                wait: async (milliseconds) => {
                    now += milliseconds;
                },
            },
        );
        expect(ready).to.equal(false);
        expect(attempts).to.equal(2);

        attempts = 0;
        expect(
            await waitForLocalSqlContainerAuthentication(
                async () => {
                    attempts++;
                    return true;
                },
                async () => undefined,
                () => true,
            ),
        ).to.equal(false);
        expect(attempts).to.equal(0);
    });

    test("bounds provider connection failures and redacts credentials", () => {
        const detail = summarizeLocalSqlConnectionFailure(
            "System.IO.FileNotFoundException:\r\nFile name: 'Missing.dll'\r\n   at Hidden.Stack()",
            `Server=localhost;Password=do-not-emit; ${"x".repeat(700)}`,
        );

        expect(detail).to.equal("System.IO.FileNotFoundException: File name: 'Missing.dll'");
        expect(detail).not.to.contain("do-not-emit");
        expect(detail!.length).to.be.at.most(512);
    });
});
