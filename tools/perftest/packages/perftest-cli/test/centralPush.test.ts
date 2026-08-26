/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { projectPerfRun, type PerfRunSource, type UploadReceipt } from "@mssqlperf/contracts";
import {
    pushIdentity,
    recordCommitReceipt,
    renderPreview,
    type PushOutcome,
} from "../src/central/push";
import { CENTRAL_CONNSTRING_ENV, resolveCentralTarget } from "../src/central/centralClient";

const FIXTURES = join(__dirname, "..", "..", "perf-contracts", "fixtures", "central");

describe("push preview and identity (C1 output discipline)", () => {
    it("preview text carries digests and counts but never labels or values", () => {
        const source = JSON.parse(
            readFileSync(join(FIXTURES, "golden-run", "source.json"), "utf8"),
        ) as PerfRunSource;
        const refusedAbsolutePath = source.reps
            .flatMap((rep) => rep.result.artifacts ?? [])
            .map((artifact) => artifact.path)
            .find((path) => /^[A-Za-z]:[\\/]/.test(path));
        expect(refusedAbsolutePath).toBeDefined();
        const projection = projectPerfRun(source, { uploadPolicyId: "ci-official.v1" });
        const text = renderPreview(projection);
        expect(text).toContain("ci-official.v1");
        expect(text).toContain("REFUSED:  artifacts.path");
        expect(text).not.toContain("GOLDEN-MACHINE-01");
        expect(text).not.toContain("golden run user note");
        expect(text).not.toContain(refusedAbsolutePath!);
    });

    it("pushIdentity distinguishes CI from developer pushes", () => {
        const dev = pushIdentity(false);
        expect(dev.principal.kind === "ci").toBe(process.env["GITHUB_ACTIONS"] === "true");
        const ci = pushIdentity(true);
        expect(ci.principal.kind).toBe("ci");
        expect(ci.isCi).toBe(true);
    });

    it("counts a refused commit receipt as refused rather than pushed", () => {
        const outcome: PushOutcome = {
            pushed: 0,
            alreadyPresent: 0,
            refused: 0,
            failed: 0,
            skipped: 0,
        };
        const receipt = {
            uploadBatchId: 42,
            outcome: "refused",
            reasonCode: "projectionMismatch",
            rowsByItemKind: {},
        } as UploadReceipt;
        expect(recordCommitReceipt(outcome, receipt)).toContain(
            "REFUSED: projectionMismatch (batch 42)",
        );
        expect(outcome).toMatchObject({ pushed: 0, refused: 1 });
    });

    it("target resolution errors are actionable and never echo the value", () => {
        const saved = process.env[CENTRAL_CONNSTRING_ENV];
        delete process.env[CENTRAL_CONNSTRING_ENV];
        try {
            expect(() => resolveCentralTarget(undefined)).toThrow(
                /--target|MSSQL_PERFTEST_CENTRAL/,
            );
            expect(() =>
                resolveCentralTarget(
                    "Server=localhost;Integrated Security=True;Password=SHOULD-NOT-ECHO",
                ),
            ).toThrow(/SQL authentication/);
            try {
                resolveCentralTarget(
                    "Server=localhost;Integrated Security=True;Password=SHOULD-NOT-ECHO",
                );
            } catch (error) {
                expect((error as Error).message).not.toContain("SHOULD-NOT-ECHO");
            }
        } finally {
            if (saved !== undefined) {
                process.env[CENTRAL_CONNSTRING_ENV] = saved;
            }
        }
    });

    it("trusts certificates by default only for local SQL Server targets", () => {
        const local = resolveCentralTarget(
            "Server=localhost,1433;Database=PerfCentral;User Id=sa;Password=test",
        );
        const remote = resolveCentralTarget(
            "Server=sql.example.com;Database=PerfCentral;User Id=sa;Password=test",
        );
        const explicit = resolveCentralTarget(
            "Server=sql.example.com;Database=PerfCentral;User Id=sa;Password=test;TrustServerCertificate=True",
        );
        expect(local.trustServerCertificate).toBe(true);
        expect(remote.trustServerCertificate).toBe(false);
        expect(explicit.trustServerCertificate).toBe(true);
    });
});
