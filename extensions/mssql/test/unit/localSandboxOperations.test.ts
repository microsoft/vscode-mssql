/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    buildCreateLocalSandboxSql,
    buildDropLocalSandboxSql,
    buildProbeLocalSandboxSql,
    effectIdFromLocalSandboxLeaseRef,
    isRunbookSandboxDatabaseName,
    isStrictLoopbackSqlServer,
    localSandboxDatabaseName,
    localSandboxLeaseRef,
    localSandboxOwnershipPropertyName,
} from "../../src/runbookStudio/runtime/localSandboxOperations";

suite("Runbook Studio local sandbox rules", () => {
    const effectId = `effect-${"a".repeat(64)}`;

    test("accepts only explicit loopback SQL Server names", () => {
        for (const server of [
            "localhost",
            "localhost,1433",
            "localhost\\SQLEXPRESS",
            "tcp:127.0.0.1,1433",
            ".",
            ".\\SQLEXPRESS",
            "(local)",
            "[::1],1433",
        ]) {
            expect(isStrictLoopbackSqlServer(server), server).to.equal(true);
        }
        for (const server of [
            "example.test",
            "server,1433",
            "host.docker.internal,1433",
            "10.0.0.5",
            "localhost.example.test",
            "np:localhost",
            "",
        ]) {
            expect(isStrictLoopbackSqlServer(server), server).to.equal(false);
        }
    });

    test("database and lease names derive only from the effect identity", () => {
        const databaseName = localSandboxDatabaseName(effectId);
        const leaseRef = localSandboxLeaseRef(effectId);
        expect(databaseName).to.equal(`RunbookStudio_${"a".repeat(20)}`);
        expect(isRunbookSandboxDatabaseName(databaseName)).to.equal(true);
        expect(effectIdFromLocalSandboxLeaseRef(leaseRef)).to.equal(effectId);
        expect(effectIdFromLocalSandboxLeaseRef("profile-id")).to.equal(undefined);
        expect(() => localSandboxDatabaseName("../not-an-effect")).to.throw("invalid effect id");
    });

    test("create/probe/drop SQL is closed over generated identifiers and marker", () => {
        const databaseName = localSandboxDatabaseName(effectId);
        const create = buildCreateLocalSandboxSql(databaseName, effectId);
        const probe = buildProbeLocalSandboxSql(databaseName);
        const drop = buildDropLocalSandboxSql(databaseName, effectId);

        expect(create).to.include(`CREATE DATABASE [${databaseName}]`);
        expect(create).to.include("sp_addextendedproperty");
        expect(create).to.include(localSandboxOwnershipPropertyName(databaseName));
        expect(create).not.to.include(`${databaseName}].sys.sp_addextendedproperty`);
        expect(create).to.include(effectId);
        expect(probe).to.include("database_exists");
        expect(probe).to.include("RunbookStudioLeaseId");
        expect(drop).to.include("SET SINGLE_USER WITH ROLLBACK IMMEDIATE");
        expect(drop).to.include(`DROP DATABASE [${databaseName}]`);
        expect(drop).to.include(effectId);
        expect(drop).to.include("AND NOT EXISTS (SELECT 1 FROM master.sys.extended_properties");
        expect(drop).to.include("ELSE IF EXISTS");
        expect(drop.match(/sp_dropextendedproperty/g)).to.have.length(2);
        expect(() => buildDropLocalSandboxSql("master", effectId)).to.throw("does not match");
        expect(() =>
            buildCreateLocalSandboxSql(`RunbookStudio_${"b".repeat(20)}`, effectId),
        ).to.throw("does not match");
    });

    test("derives a bounded target-specific marker outside the deployed database", () => {
        const databaseName = localSandboxDatabaseName(effectId);
        const property = localSandboxOwnershipPropertyName(databaseName);

        expect(property).to.match(/^RunbookStudioLease_[a-f0-9]{64}$/);
        expect(property).to.have.length.lessThan(129);
        expect(() => localSandboxOwnershipPropertyName("master")).to.throw(
            "invalid sandbox database name",
        );
    });
});
