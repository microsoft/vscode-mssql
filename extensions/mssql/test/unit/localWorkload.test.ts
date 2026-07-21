/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    LocalWorkloadPolicyError,
    MAX_LOCAL_WORKLOAD_BYTES,
    parseLocalWorkload,
} from "../../src/runbookStudio/runtime/localWorkload";

suite("Runbook Studio local workload policy", () => {
    test("parses SQLCMD variables and bounded GO repetitions", () => {
        const plan = parseLocalWorkload(
            ':setvar TableName "dbo.RunLog"\nINSERT INTO $(TableName) (Id) VALUES (1);\nGO 2\nSELECT COUNT(*) FROM $(TableName);',
        );
        expect(plan.batchCount).to.equal(3);
        expect(plan.mutating).to.equal(true);
        expect(plan.batches[0]).to.contain("dbo.RunLog");
        expect(plan.batches[1]).to.equal(plan.batches[0]);
        expect(plan.workloadSha256).to.match(/^[a-f0-9]{64}$/);
    });

    test("permits blocked words only inside strings and comments", () => {
        const plan = parseLocalWorkload(
            "SELECT 'DROP DATABASE nope' AS Message; -- xp_cmdshell\nGO\nSELECT 1;",
        );
        expect(plan.batchCount).to.equal(2);
        expect(plan.mutating).to.equal(false);
    });

    test("refuses server, external, include, shell, and cross-database effects", () => {
        for (const sql of [
            "USE master; SELECT 1;",
            "DROP DATABASE Important;",
            "EXEC xp_cmdshell 'whoami';",
            "BULK INSERT dbo.T FROM 'file';",
            "INSERT OtherDb.dbo.T VALUES (1);",
            "CREATE DATABASE EscapedTarget;",
            ":r other.sql",
            "!! dir",
        ]) {
            expect(() => parseLocalWorkload(sql), sql).to.throw(LocalWorkloadPolicyError);
        }
    });

    test("refuses unresolved variables and excessive content", () => {
        expect(() => parseLocalWorkload("SELECT '$(Missing)';")).to.throw(LocalWorkloadPolicyError);
        expect(() => parseLocalWorkload(Buffer.alloc(MAX_LOCAL_WORKLOAD_BYTES + 1, 65))).to.throw(
            LocalWorkloadPolicyError,
        );
    });
});
