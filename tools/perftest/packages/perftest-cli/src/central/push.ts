/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `perftest push` — publish perf runs from run directories to the central
 * store (central design §8.1, C1). Reads ground truth (result.json et al.),
 * never perf.db, so a fresh clone can backfill history. Push is idempotent:
 * re-pushing an unchanged run is `alreadyPresent`; central outage exits with
 * code 7 (pushFailed) and NEVER perturbs gate exit codes.
 *
 * Output discipline: the preview/receipt lines carry counts, digests and
 * policy ids only — no connection string, no machine labels, no payload
 * content (canary-tested).
 */

import { existsSync, readdirSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join, resolve } from "node:path";
import {
    assertUploadable,
    CentralProjectionError,
    getUploadPolicy,
    projectPerfRun,
    type CentralProjection,
    type UploadPolicyId,
} from "@mssqlperf/contracts";
import type { HarnessLogger } from "../telemetry/logger";
import { CentralClient, type CentralIdentity, uploadProjection } from "./centralClient";
import { loadRunDirectory, RunLoadError } from "./runLoader";

export interface PushOptions {
    runsDir: string;
    runId?: string;
    allNew: boolean;
    dryRun: boolean;
    policy: string;
    ci: boolean;
}

export interface PushOutcome {
    pushed: number;
    alreadyPresent: number;
    refused: number;
    failed: number;
    skipped: number;
}

export function pushIdentity(ci: boolean): CentralIdentity {
    if (ci || process.env["GITHUB_ACTIONS"] === "true") {
        return {
            tool: "perftest-push",
            toolVersion: "0.1.0",
            principal: {
                kind: "ci",
                pipelineIdentity:
                    process.env["GITHUB_WORKFLOW"] ?? process.env["BUILD_DEFINITIONNAME"] ?? "ci",
                poolName: process.env["RUNNER_NAME"] ?? process.env["AGENT_NAME"] ?? "unknown",
            },
            isCi: true,
        };
    }
    return {
        tool: "perftest-push",
        toolVersion: "0.1.0",
        principal: { kind: "alias", value: `${userInfo().username}@${hostname()}` },
    };
}

export function renderPreview(projection: CentralProjection): string {
    const p = projection.preview;
    const lines: string[] = [];
    lines.push(`${p.sourceKind} ${p.naturalKey}`);
    lines.push(
        `  policy ${p.uploadPolicyId} · contract ${p.contractVersion} · projector ${p.projectorVersion}`,
    );
    lines.push(`  source ${p.sourceDigest} · projection ${p.projectionDigest}`);
    for (const table of p.tables) {
        lines.push(
            `  ${table.name.padEnd(18)} ${String(table.rows).padStart(6)} rows  ~${table.bytesEstimate} bytes`,
        );
    }
    if (p.digested.length > 0) {
        lines.push(`  digested: ${p.digested.map((d) => `${d.field}(${d.count})`).join(", ")}`);
    }
    if (p.dropped.length > 0) {
        lines.push(`  dropped:  ${p.dropped.map((d) => `${d.field}(${d.count})`).join(", ")}`);
    }
    for (const r of p.refused) {
        lines.push(`  REFUSED:  ${r.field} [${r.cls}] ${r.reason}`);
    }
    for (const w of p.warnings) {
        lines.push(`  warning:  ${w}`);
    }
    return lines.join("\n");
}

function discoverRunDirs(runsDir: string, runId?: string): string[] {
    if (runId) {
        const dir = join(runsDir, runId);
        if (!existsSync(dir)) {
            throw new RunLoadError(`run directory not found: ${dir}`);
        }
        return [dir];
    }
    if (!existsSync(runsDir)) {
        throw new RunLoadError(`runs directory not found: ${runsDir}`);
    }
    return readdirSync(runsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(runsDir, e.name, "summary.json")))
        .map((e) => join(runsDir, e.name))
        .sort();
}

export async function runPush(
    options: PushOptions,
    client: CentralClient | undefined,
    logger: HarnessLogger,
    write: (line: string) => void,
): Promise<PushOutcome> {
    const policyId = options.policy as UploadPolicyId;
    getUploadPolicy(policyId); // throws early on unknown policy ids
    const identity = pushIdentity(options.ci);
    const outcome: PushOutcome = {
        pushed: 0,
        alreadyPresent: 0,
        refused: 0,
        failed: 0,
        skipped: 0,
    };

    const dirs = discoverRunDirs(resolve(options.runsDir), options.runId);
    if (dirs.length === 0) {
        write("No run directories found.");
        return outcome;
    }

    for (const dir of dirs) {
        const span = logger.span("centralPush.run", { dir: dir.split(/[\\/]/).pop() });
        try {
            const source = loadRunDirectory(dir);
            const projection = projectPerfRun(source, { uploadPolicyId: policyId });
            write(renderPreview(projection));
            if (options.dryRun) {
                write(`  dry-run: nothing uploaded`);
                span.end({ dryRun: true });
                continue;
            }
            assertUploadable(projection);
            if (!client) {
                throw new Error("push: no central client (internal)");
            }
            const result = await uploadProjection(client, projection, identity);
            if (result.receipt) {
                outcome.pushed++;
                write(
                    `  -> ${result.receipt.outcome} (batch ${result.receipt.uploadBatchId}, ` +
                        `${Object.values(result.receipt.rowsByItemKind).reduce((a, b) => a + b, 0)} rows)`,
                );
            } else if (result.disposition.disposition === "alreadyPresent") {
                outcome.alreadyPresent++;
                write(`  -> alreadyPresent (no rows uploaded)`);
            } else {
                outcome.refused++;
                write(`  -> REFUSED: ${result.disposition.reasonCode}`);
            }
            span.end({ outcome: result.receipt?.outcome ?? result.disposition.disposition });
        } catch (error) {
            if (error instanceof CentralProjectionError) {
                outcome.refused++;
                write(`  -> REFUSED by policy: ${error.message}`);
                span.end({ outcome: "refusedByPolicy" });
            } else if (error instanceof RunLoadError && options.allNew && !options.runId) {
                // Scans tolerate incomplete run dirs (e.g. in-product self-test runs
                // without environment.json); a targeted push still fails loudly.
                outcome.skipped++;
                write(`  -> skipped (incomplete run directory): ${error.message}`);
                span.end({ outcome: "skipped" });
            } else {
                outcome.failed++;
                write(`  -> FAILED: ${(error as Error).message}`);
                span.fail(error as Error);
            }
        }
    }

    write(
        `push summary: ${outcome.pushed} pushed, ${outcome.alreadyPresent} already present, ` +
            `${outcome.refused} refused, ${outcome.skipped} skipped, ${outcome.failed} failed`,
    );
    return outcome;
}
