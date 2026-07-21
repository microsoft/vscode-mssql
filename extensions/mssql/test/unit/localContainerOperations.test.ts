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
    validateLocalSqlContainerIdentity,
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
});
