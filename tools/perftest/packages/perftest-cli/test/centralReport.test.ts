/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCentralReport } from "../src/central/centralReport";
import type { CentralClient } from "../src/central/centralClient";

describe("central HTML report", () => {
    it("escapes database-provided text", async () => {
        const canary = `<img src=x onerror="alert('xss')">`;
        const fakeClient = {
            target: { database: "PerfCentral" },
            query: async (sql: string) => {
                if (sql.includes("central_health")) {
                    return [{ schema_version: "central-store/1", contract_version: "central/1" }];
                }
                if (sql.includes("upload_history")) {
                    return [
                        {
                            upload_batch_id: 1,
                            source_kind: "perfRun",
                            natural_key: canary,
                            status: "refused",
                            tool: canary,
                            upload_policy_id: "team-default.v1",
                            outcome_reason: canary,
                        },
                    ];
                }
                if (sql.includes("regressions_last_30d")) {
                    return [
                        {
                            scenario_id: canary,
                            metric_name: "scenario.wallclock",
                            verdict: "regressed",
                            delta_pct: 12.5,
                            latest_median: 112.5,
                            unit: canary,
                            prior_mean: 100,
                            prior_runs: 3,
                            latest_run_id: "run-1",
                        },
                    ];
                }
                return [];
            },
        } as unknown as CentralClient;
        const dir = mkdtempSync(join(tmpdir(), "central-report-"));
        const path = join(dir, "report.html");
        try {
            await renderCentralReport(fakeClient, path);
            const html = readFileSync(path, "utf8");
            expect(html).not.toContain(canary);
            expect(html).toContain("&lt;img src=x onerror=&quot;alert('xss')&quot;&gt;");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
