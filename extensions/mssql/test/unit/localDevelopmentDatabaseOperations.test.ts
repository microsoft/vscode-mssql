/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    buildCreateLocalDevelopmentDatabaseSql,
    buildDropLocalDevelopmentDatabaseSql,
    buildProbeLocalDevelopmentDatabaseSql,
    effectIdFromLocalDevelopmentDatabaseLeaseRef,
    isValidLocalDevelopmentDatabaseName,
    localDevelopmentDatabaseOwnershipPropertyName,
    localDevelopmentDatabaseLeaseRef,
} from "../../src/runbookStudio/runtime/localDevelopmentDatabaseOperations";

suite("localDevelopmentDatabaseOperations", () => {
    const effectId = `effect-${"a".repeat(64)}`;

    test("accepts bounded developer names and rejects system or generated databases", () => {
        expect(isValidLocalDevelopmentDatabaseName("WWI_2")).to.equal(true);
        expect(isValidLocalDevelopmentDatabaseName("dev-database$1")).to.equal(true);
        expect(isValidLocalDevelopmentDatabaseName("master")).to.equal(false);
        expect(isValidLocalDevelopmentDatabaseName("RunbookStudio_0123456789abcdef0123")).to.equal(
            false,
        );
        expect(isValidLocalDevelopmentDatabaseName("unsafe]name")).to.equal(false);
        expect(isValidLocalDevelopmentDatabaseName("2bad")).to.equal(false);
    });

    test("round trips only opaque development lease references", () => {
        const lease = localDevelopmentDatabaseLeaseRef(effectId);
        expect(effectIdFromLocalDevelopmentDatabaseLeaseRef(lease)).to.equal(effectId);
        expect(
            effectIdFromLocalDevelopmentDatabaseLeaseRef(`runbook-sql-lease:${effectId}`),
        ).to.equal(undefined);
        expect(() => localDevelopmentDatabaseLeaseRef("effect-invalid")).to.throw(
            "invalid effect id",
        );
    });

    test("creates and probes an exact ownership-marked named database", () => {
        const create = buildCreateLocalDevelopmentDatabaseSql("WWI_2", effectId);
        const probe = buildProbeLocalDevelopmentDatabaseSql("WWI_2");

        expect(create).to.include("CREATE DATABASE [WWI_2]");
        expect(create).to.include("SUSER_SNAME(0x01)");
        expect(create).to.include("ALTER AUTHORIZATION ON DATABASE::[WWI_2]");
        expect(create.indexOf("ALTER AUTHORIZATION")).to.be.lessThan(
            create.indexOf("sp_addextendedproperty"),
        );
        expect(create).to.include(localDevelopmentDatabaseOwnershipPropertyName("WWI_2"));
        expect(create).not.to.include("[WWI_2].sys.sp_addextendedproperty");
        expect(create).to.include(effectId);
        expect(probe).to.include("DB_ID(N'WWI_2')");
        expect(probe).to.include("master.sys.extended_properties");
        // Old in-target leases remain readable for guarded recovery.
        expect(probe).to.include("[WWI_2].sys.extended_properties");
    });

    test("drops only after checking the exact named-database marker", () => {
        const sql = buildDropLocalDevelopmentDatabaseSql("WWI_2", effectId);
        const markerCheck = sql.indexOf("RunbookStudioDevelopmentLeaseId");
        const drop = sql.indexOf("DROP DATABASE [WWI_2]");

        expect(markerCheck).to.be.greaterThan(-1);
        expect(drop).to.be.greaterThan(markerCheck);
        expect(sql).to.include(effectId);
        expect(sql).to.include("AND NOT EXISTS (SELECT 1 FROM master.sys.extended_properties");
        expect(sql).to.include("ELSE IF EXISTS");
        expect(sql.match(/sp_dropextendedproperty/g)).to.have.length(2);
        expect(() => buildDropLocalDevelopmentDatabaseSql("master", effectId)).to.throw(
            "invalid local development database name",
        );
    });

    test("derives a bounded target-specific marker outside the deployed database", () => {
        const property = localDevelopmentDatabaseOwnershipPropertyName("WWI_2");

        expect(property).to.match(/^RunbookStudioDevelopmentLease_[a-f0-9]{64}$/);
        expect(property).to.have.length.lessThan(129);
        expect(localDevelopmentDatabaseOwnershipPropertyName("wwi_2")).to.equal(property);
    });
});
