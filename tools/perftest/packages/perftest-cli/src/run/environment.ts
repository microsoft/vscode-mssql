/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Environment capture + hash (design §23.1). The environment hash decides
 * comparability: official metrics are never compared across different hashes
 * unless explicitly configured. The hash covers hardware, OS, VS Code build,
 * extension versions, STS version, SQL image/seed, config hash, and pass type.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as os from "node:os";
import { basename } from "node:path";
import type { EnvironmentInfo, GitRepoInfo, PassType } from "@mssqlperf/contracts";
import type { ResolvedVscode } from "../launch/resolveVscode";
import type { HarnessLogger } from "../telemetry/logger";

export interface EnvironmentCaptureInputs {
    vscode: ResolvedVscode;
    extensionVersions: Record<string, string>;
    stsVersion?: string;
    sql: { imageDigest?: string; snapshot: string; cacheMode: string; provider: string };
    /**
     * The environment-relevant config subset (see environmentRelevantConfig).
     * Deliberately NOT the whole config hash: rep counts, thresholds, scenario
     * lists, and output settings must not break run comparability — while
     * anything that changes what is measured must.
     */
    configFingerprint: Record<string, unknown>;
    passType: PassType;
}

/** Extract the config knobs that define the measured environment (§23.1). */
export function environmentRelevantConfig(config: {
    vscode: {
        version: string;
        quality?: string;
        extraArgs?: string[];
        extensions: Array<{ id: string; source: string }>;
    };
    sql: { provider: string; imageDigest?: string; snapshot: string; cacheMode: string };
    environment: Record<string, unknown>;
}): Record<string, unknown> {
    return {
        vscode: {
            version: config.vscode.version,
            quality: config.vscode.quality ?? "stable",
            extraArgs: config.vscode.extraArgs ?? [],
            extensions: config.vscode.extensions.map((e) => ({ id: e.id, source: e.source })),
        },
        sql: {
            provider: config.sql.provider,
            imageDigest: config.sql.imageDigest ?? null,
            snapshot: config.sql.snapshot,
            cacheMode: config.sql.cacheMode,
        },
        environment: config.environment,
    };
}

/**
 * Deterministic JSON. The implementation moved to the shared central contract
 * (perf-contracts src/central/digest.ts) so every central-store digest and the
 * environment hash use ONE canonicalization (review addendum §6); re-exported
 * here to keep existing imports working. The recipe is unchanged.
 */
import { canonicalJson } from "@mssqlperf/contracts";
export { canonicalJson };

export function captureEnvironment(inputs: EnvironmentCaptureInputs): EnvironmentInfo {
    const cpus = os.cpus();
    const fingerprint = {
        os: { platform: os.platform(), release: os.release(), version: os.version() },
        cpu: { model: cpus[0]?.model ?? "unknown", logicalCores: cpus.length },
        memory: { totalMb: Math.round(os.totalmem() / 1024 / 1024) },
        vscode: {
            version: inputs.vscode.version,
            quality: inputs.vscode.quality,
            commit: inputs.vscode.commit ?? null,
        },
        extensions: inputs.extensionVersions,
        sts: { version: inputs.stsVersion ?? null },
        sql: inputs.sql,
        config: inputs.configFingerprint,
        passType: inputs.passType,
    };
    const environmentHash =
        "sha256:" + createHash("sha256").update(canonicalJson(fingerprint), "utf8").digest("hex");

    return {
        environmentHash,
        machineId: os.hostname(),
        os: fingerprint.os,
        cpu: fingerprint.cpu,
        memory: fingerprint.memory,
        vscode: fingerprint.vscode,
        extensions: fingerprint.extensions,
        sts: fingerprint.sts,
        sql: fingerprint.sql,
        passType: inputs.passType,
    };
}

/** Best-effort git facts for a repo; undefined when not a git repo. */
export function getGitInfo(
    repoPath: string,
    logger: HarnessLogger,
    repoName?: string,
): GitRepoInfo | undefined {
    const git = (...args: string[]): string =>
        execFileSync("git", ["-C", repoPath, ...args], {
            encoding: "utf8",
            timeout: 10000,
            windowsHide: true,
        }).trim();
    try {
        const sha = git("rev-parse", "HEAD");
        const dirty = git("status", "--porcelain").length > 0;
        const branch = git("branch", "--show-current");
        const info: GitRepoInfo = {
            repo: repoName ?? basename(repoPath),
            sha,
            dirty,
        };
        if (branch) info.branch = branch;
        return info;
    } catch (error) {
        logger.debug("environment.gitInfoUnavailable", String(error), { repoPath });
        return undefined;
    }
}
