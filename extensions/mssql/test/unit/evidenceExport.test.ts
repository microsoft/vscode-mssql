/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as crypto from "crypto";
import {
    buildEvidenceExport,
    EvidenceExportError,
    evidenceExportFileName,
} from "../../src/runbookStudio/evidenceExport";
import { buildLocalEvidenceBundle } from "../../src/runbookStudio/runtime/localEvidenceBundle";
import type { LocalToolchainProvenance } from "../../src/runbookStudio/runtime/localToolchainProvenance";

const toolchain: LocalToolchainProvenance = {
    complete: true,
    components: [
        { id: "vscode", version: "1.106.0", status: "resolved", versionSource: "host" },
        {
            id: "mssqlExtension",
            version: "1.45.0",
            status: "resolved",
            versionSource: "extensionManifest",
        },
        {
            id: "sqlDatabaseProjectsExtension",
            version: "1.5.0",
            status: "resolved",
            versionSource: "extensionManifest",
        },
        {
            id: "sqlToolsService",
            version: "6.0.0.0",
            status: "resolved",
            versionSource: "runtimeRequest",
        },
        {
            id: "dacFx",
            version: "170.5.38-preview",
            status: "resolved",
            versionSource: "serviceDependencyManifest",
            hostComponent: "sqlToolsService",
        },
    ],
};

function manifest(): string {
    return buildLocalEvidenceBundle({
        runId: "run-1",
        runbookId: "book-1",
        planRevision: "3",
        planHash: `sha256:${"a".repeat(64)}`,
        runtimeKind: "local",
        toolchain,
        nodes: [
            {
                nodeId: "build",
                activityKind: "dacpac.build",
                state: "succeeded",
                attempt: 1,
                outcome: "success",
                outputs: [
                    {
                        handleId: "run-1/build/1",
                        contract: "dacpacArtifact/1",
                        bytes: 200,
                    },
                ],
                scalars: { diagnosticCount: 0, artifactSha256: "b".repeat(64) },
            },
            {
                nodeId: "tests",
                activityKind: "sqltest.run",
                state: "failed",
                attempt: 1,
                outcome: "failure",
                outputs: [{ handleId: "run-1/tests/2", contract: "testResults/1", rows: 2 }],
                scalars: { total: 2, passed: 1, failed: 1 },
            },
        ],
        generatedAtUtc: "2026-07-19T21:00:00.000Z",
    }).manifestJson;
}

function rehash(source: Record<string, unknown>): void {
    const content = Object.fromEntries(
        Object.entries(source).filter(
            ([key]) => key !== "bundleSha256" && key !== "generatedAtUtc",
        ),
    );
    source.bundleSha256 = crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

suite("Runbook Studio evidence export", () => {
    test("machine JSON is deterministic and excludes host locators and injected fields", () => {
        const source = JSON.parse(manifest());
        source.secret = "root-secret-canary";
        source.nodes[0].message = "provider-secret-canary";
        source.nodes[0].outputs[0].path = "C:\\private\\Database.dacpac";
        source.nodes[0].evidenceScalars.passwordCount = 7;
        rehash(source);
        const serialized = JSON.stringify(source);

        const first = buildEvidenceExport(serialized, "json");
        const second = buildEvidenceExport(serialized, "json");
        const exported = JSON.parse(first.content);

        expect(first.content).to.equal(second.content);
        expect(first.extension).to.equal("json");
        expect(first.sourceIdentity).to.deep.equal({
            runId: "run-1",
            runbookId: "book-1",
            planRevision: "3",
            planHash: `sha256:${"a".repeat(64)}`,
            runtimeKind: "local",
            verdict: "fail",
        });
        expect(exported.contract).to.equal("runbookEvidenceExport/1");
        expect(exported.sourceBundle.contract).to.equal("evidenceBundle/1");
        expect(exported.nodes[0].outputs[0]).to.deep.equal({
            contract: "dacpacArtifact/1",
            bytes: 200,
        });
        expect(first.content).not.to.contain("run-1/build/1");
        expect(first.content).not.to.contain("root-secret-canary");
        expect(first.content).not.to.contain("provider-secret-canary");
        expect(first.content).not.to.contain("C:\\private");
        expect(first.content).not.to.contain("passwordCount");
    });

    test("JUnit reports node failures without row or provider detail", () => {
        const artifact = buildEvidenceExport(manifest(), "junit");
        expect(artifact.extension).to.equal("xml");
        expect(artifact.content).to.contain('tests="2" failures="1" skipped="0"');
        expect(artifact.content).to.contain('classname="sqltest.run" name="tests"');
        expect(artifact.content).to.contain("Runbook node did not pass.");
        expect(artifact.content).not.to.contain("run-1/tests/2");
    });

    test("SARIF contains stable results and no artifact locations", () => {
        const artifact = buildEvidenceExport(manifest(), "sarif");
        const sarif = JSON.parse(artifact.content);
        expect(sarif.version).to.equal("2.1.0");
        expect(sarif.runs[0].results).to.have.length(1);
        expect(sarif.runs[0].results[0].ruleId).to.equal("RBS_NODE_FAILURE");
        expect(artifact.content).not.to.contain("locations");
        expect(artifact.content).not.to.contain("run-1/tests/2");
    });

    test("Markdown summarizes toolchain and nodes without output content", () => {
        const artifact = buildEvidenceExport(manifest(), "markdown");
        expect(artifact.content).to.contain("# Runbook evidence");
        expect(artifact.content).to.contain("| dacFx | 170.5.38-preview | resolved | No |");
        expect(artifact.content).to.contain("| tests | sqltest.run | failed | failure | 1 | 1 |");
        expect(artifact.content).not.to.contain("run-1/tests/2");
    });

    test("refuses tampered, legacy, and oversized manifests", () => {
        const tampered = JSON.parse(manifest());
        tampered.summary.verdict = "pass";
        expect(() => buildEvidenceExport(JSON.stringify(tampered), "json")).to.throw(
            EvidenceExportError,
        );
        expect(() =>
            buildEvidenceExport('{"contract":"evidenceBundle/1","preview":true}', "json"),
        ).to.throw(EvidenceExportError);
        expect(() => buildEvidenceExport("x".repeat(2 * 1024 * 1024 + 1), "json")).to.throw(
            EvidenceExportError,
        );

        const inconsistent = JSON.parse(manifest());
        inconsistent.summary.failedNodeCount = 0;
        rehash(inconsistent);
        expect(() => buildEvidenceExport(JSON.stringify(inconsistent), "json")).to.throw(
            EvidenceExportError,
        );
    });

    test("creates portable bounded default file names", () => {
        const name = evidenceExportFileName("Deploy: customer/db", "run/../../secret", "sarif");
        expect(name).to.equal("Deploy-customer-db-run-..-..-secret-evidence.sarif");
        expect(name).not.to.contain("/");
        expect(evidenceExportFileName("<>|", "***", "xml")).to.equal("runbook-run-evidence.xml");
    });
});
