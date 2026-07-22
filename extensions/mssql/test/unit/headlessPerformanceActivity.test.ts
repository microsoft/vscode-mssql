/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { HeadlessEffectAuthority } from "../../src/runbookStudio/headless/headlessEffectAuthority";
import { HeadlessPerformanceActivityDelegate } from "../../src/runbookStudio/headless/headlessPerformanceActivity";
import type { HeadlessSqlActivityDelegate } from "../../src/runbookStudio/headless/headlessSqlActivity";
import { createNewRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import type { ActivityInvocationIdentity } from "../../src/runbookStudio/runtime/fakeRuntimeAdapter";
import type { RunbookPlanNode } from "../../src/sharedInterfaces/runbookStudio";

suite("Runbook Studio headless performance activity", () => {
    let root: string;
    let delegate: HeadlessPerformanceActivityDelegate;
    const invocation: ActivityInvocationIdentity = {
        runId: "headless-performance-unit",
        planRevision: "revision-1",
        planHash: "sha256:" + "a".repeat(64),
        attempt: 1,
    };

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-headless-performance-"));
        const artifact = createNewRunbookArtifact("Performance", "headless-performance-book");
        delegate = new HeadlessPerformanceActivityDelegate(
            root,
            path.join(root, "artifacts"),
            new HeadlessEffectAuthority(invocation.runId, artifact, {}),
            {} as HeadlessSqlActivityDelegate,
        );
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("inspects a contained workload and emits a digest-bound opaque reference", async () => {
        const scriptDirectory = path.join(root, "scripts");
        fs.mkdirSync(scriptDirectory);
        fs.writeFileSync(
            path.join(scriptDirectory, "workload.sql"),
            "SELECT TOP (1) [name] FROM sys.tables ORDER BY [name];\n",
            "utf8",
        );
        const result = await execute({
            id: "inspect-workload",
            label: "Inspect workload",
            kind: "activity",
            activityKind: "sql.workload.inspect",
            activityVersion: 1,
            inputs: { file: "scripts/workload.sql" },
        });
        expect(result?.success).to.equal(true);
        expect(result?.output?.contract).to.equal("workloadPreview/1");
        expect(result?.values?.workloadRef).to.match(/^runbook-workload:[a-f0-9]{64}:/u);
        expect(result?.values?.workloadSha256).to.match(/^[a-f0-9]{64}$/u);
        expect(result?.values?.batchCount).to.equal(1);
    });

    test("builds a factual benchmark without inventing a regression verdict", async () => {
        const digest = "b".repeat(64);
        const result = await execute({
            id: "summarize-benchmark",
            label: "Summarize benchmark",
            kind: "activity",
            activityKind: "workload.benchmark",
            activityVersion: 1,
            inputs: {
                workloadFingerprint: digest,
                environmentFingerprint: digest,
                workloadDurationMs: 42,
                executedBatchCount: 2,
                failedBatchCount: 0,
                repetitions: 2,
                measurementSampleCount: 2,
                meanDurationMs: 21,
                p50DurationMs: 20,
                p95DurationMs: 22,
                minDurationMs: 20,
                maxDurationMs: 22,
                standardDeviationMs: 1,
                xeventCpuMs: 5,
                logicalReads: 10,
            },
        });
        expect(result?.success).to.equal(true);
        expect(result?.output?.contract).to.equal("performanceMetrics/1");
        expect(result?.output?.rows).to.deep.include(["XEvent CPU", 5, "ms"]);
        expect(result?.output?.scalars).not.to.have.property("regression");
    });

    async function execute(node: RunbookPlanNode) {
        return delegate.executeActivity(node, {
            parameterValues: {},
            resolveBind: (value) => value,
            isCancellationRequested: () => false,
            invocation,
        });
    }
});
