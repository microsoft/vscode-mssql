import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { projectPerfRun, type PerfRunSource } from "@mssqlperf/contracts";
import { pushIdentity, renderPreview } from "../src/central/push";
import { CENTRAL_CONNSTRING_ENV, resolveCentralTarget } from "../src/central/centralClient";

const FIXTURES = join(__dirname, "..", "..", "perf-contracts", "fixtures", "central");

describe("push preview and identity (C1 output discipline)", () => {
    it("preview text carries digests and counts but never labels or values", () => {
        const source = JSON.parse(
            readFileSync(join(FIXTURES, "golden-run", "source.json"), "utf8"),
        ) as PerfRunSource;
        const projection = projectPerfRun(source, { uploadPolicyId: "ci-official.v1" });
        const text = renderPreview(projection);
        expect(text).toContain("ci-official.v1");
        expect(text).toContain("REFUSED:  artifacts.path");
        expect(text).not.toContain("GOLDEN-MACHINE-01");
        expect(text).not.toContain("golden run user note");
        expect(text).not.toContain("C:\absolute");
    });

    it("pushIdentity distinguishes CI from developer pushes", () => {
        const dev = pushIdentity(false);
        expect(dev.principal.kind === "ci").toBe(process.env["GITHUB_ACTIONS"] === "true");
        const ci = pushIdentity(true);
        expect(ci.principal.kind).toBe("ci");
        expect(ci.isCi).toBe(true);
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
});
