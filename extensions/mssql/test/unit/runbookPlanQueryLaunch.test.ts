/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createFixtureRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import { resolvePlanQueryLaunch } from "../../src/runbookStudio/planQueryLaunch";

function queryArtifact(sql = "SELECT TOP (100) * FROM dbo.Orders;") {
    const artifact = createFixtureRunbookArtifact();
    artifact.lock!.nodes[0].inputs!.sql = sql;
    return artifact;
}

suite("Runbook Studio Plan query launch", () => {
    test("resolves SQL and an explicit connection parameter for Query Studio", () => {
        expect(resolvePlanQueryLaunch(queryArtifact(), "query", { target: "profile-1" })).to.eql({
            ok: true,
            sql: "SELECT TOP (100) * FROM dbo.Orders;",
            profileId: "profile-1",
            connectionParameterId: "target",
        });
    });

    test("uses a portable connection parameter default when present", () => {
        const artifact = queryArtifact();
        artifact.source.parameters[0].default = "profile-default";

        expect(resolvePlanQueryLaunch(artifact, "query", {})).to.include({
            ok: true,
            profileId: "profile-default",
        });
    });

    test("refuses missing explicit connection binding", () => {
        expect(resolvePlanQueryLaunch(queryArtifact(), "query", {})).to.eql({
            ok: false,
            reason: "connectionValueMissing",
            connectionParameterLabel: "Target connection",
        });
    });

    test("refuses literal or ambient connections", () => {
        const artifact = queryArtifact();
        artifact.lock!.nodes[0].inputs!.connection = "profile-1";

        expect(resolvePlanQueryLaunch(artifact, "query", { target: "profile-1" })).to.eql({
            ok: false,
            reason: "connectionBindingInvalid",
        });
    });

    test("refuses mutating SQL even when the node claims to be a read activity", () => {
        for (const sql of [
            "DELETE FROM dbo.Orders;",
            "WITH doomed AS (SELECT * FROM dbo.Orders) DELETE FROM doomed;",
            "SELECT * INTO dbo.OrdersCopy FROM dbo.Orders;",
        ]) {
            expect(
                resolvePlanQueryLaunch(queryArtifact(sql), "query", {
                    target: "profile-1",
                }),
            ).to.eql({ ok: false, reason: "sqlNotReadOnly" });
        }
    });

    test("refuses non-query nodes and unknown node ids", () => {
        const artifact = queryArtifact();
        expect(resolvePlanQueryLaunch(artifact, "threshold", { target: "profile-1" })).to.eql({
            ok: false,
            reason: "notReadQuery",
        });
        expect(resolvePlanQueryLaunch(artifact, "missing", { target: "profile-1" })).to.eql({
            ok: false,
            reason: "nodeNotFound",
        });
    });
});
