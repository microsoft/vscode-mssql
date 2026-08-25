/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Environment preflight (design §13.3, incremental). Every check reports
 * passed/warning/failed/skipped without advertising implemented capabilities
 * as future work.
 */

import { execFileSync } from "node:child_process";
import * as os from "node:os";
import { statfsSync } from "node:fs";
import type { HarnessLogger } from "../telemetry/logger";

export type CheckStatus = "passed" | "warning" | "failed" | "skipped";

export interface DoctorCheck {
    name: string;
    status: CheckStatus;
    message: string;
    details?: Record<string, unknown>;
}

export interface DoctorReport {
    status: "passed" | "warning" | "failed";
    machine: {
        hostname: string;
        platform: string;
        osVersion: string;
        cpuModel: string;
        logicalCores: number;
        memoryTotalMb: number;
    };
    checks: DoctorCheck[];
}

function tryExec(command: string, args: string[]): string | undefined {
    try {
        return execFileSync(command, args, {
            encoding: "utf8",
            timeout: 15000,
            windowsHide: true,
            shell: false,
        }).trim();
    } catch {
        return undefined;
    }
}

export function runDoctor(logger: HarnessLogger): DoctorReport {
    const span = logger.span("doctor");
    const checks: DoctorCheck[] = [];

    // Node version
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    checks.push({
        name: "node",
        status: nodeMajor >= 22 ? "passed" : "failed",
        message: `Node ${process.versions.node}${nodeMajor >= 22 ? "" : " (need >= 22)"}`,
        details: { version: process.versions.node },
    });

    const composeVersion = tryExec("docker", ["compose", "version"]);
    checks.push({
        name: "dockerCompose",
        status: composeVersion ? "passed" : "warning",
        message: composeVersion ?? "docker compose is unavailable",
    });

    const sqlcmdVersion = tryExec("sqlcmd", ["-?"]);
    checks.push({
        name: "sqlcmd",
        status: sqlcmdVersion !== undefined ? "passed" : "warning",
        message:
            sqlcmdVersion !== undefined
                ? "sqlcmd is available for the external SQL provider"
                : "sqlcmd not found - external SQL provisioning is unavailable",
    });

    // Docker (needed for the dockerCompose SQL provider; external provider works without it)
    const dockerVersion = tryExec("docker", ["--version"]);
    checks.push({
        name: "docker",
        status: dockerVersion ? "passed" : "warning",
        message: dockerVersion ?? "docker not found - SQL scenarios need provider: external",
    });

    // .NET SDK (needed to build STS locally; not needed to run the harness core)
    const dotnetVersion = tryExec("dotnet", ["--version"]);
    checks.push({
        name: "dotnet",
        status: dotnetVersion ? "passed" : "warning",
        message: dotnetVersion
            ? `dotnet SDK ${dotnetVersion}`
            : "dotnet SDK not found - STS local builds unavailable",
    });

    // Disk space on the current drive
    try {
        const stat = statfsSync(process.cwd());
        const freeGb = (stat.bavail * stat.bsize) / 1024 ** 3;
        checks.push({
            name: "diskSpace",
            status: freeGb >= 10 ? "passed" : freeGb >= 3 ? "warning" : "failed",
            message: `${freeGb.toFixed(1)} GB free`,
            details: { freeGb: Number(freeGb.toFixed(1)) },
        });
    } catch (error) {
        checks.push({
            name: "diskSpace",
            status: "warning",
            message: `could not read free space: ${String(error)}`,
        });
    }

    // Free memory
    const freeMemGb = os.freemem() / 1024 ** 3;
    checks.push({
        name: "freeMemory",
        status: freeMemGb >= 4 ? "passed" : "warning",
        message: `${freeMemGb.toFixed(1)} GB free of ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`,
    });

    const elevation =
        process.platform === "win32"
            ? tryExec("net", ["session"]) !== undefined
            : tryExec("id", ["-u"]) === "0";
    checks.push({
        name: "diagnosticElevation",
        status: elevation ? "passed" : "warning",
        message: elevation
            ? "process is elevated for WPR/ETW diagnostics"
            : "process is not elevated; WPR/ETW diagnostics may be unavailable",
    });

    // These policies are not automatically enforced yet; say so without stale milestones.
    for (const name of ["machineIdle", "acPower", "cpuFrequencyPolicy"] as const) {
        checks.push({
            name,
            status: "skipped",
            message: "automatic policy verification is not configured",
        });
    }

    const cpu = os.cpus()[0];
    const report: DoctorReport = {
        status: checks.some((c) => c.status === "failed")
            ? "failed"
            : checks.some((c) => c.status === "warning")
              ? "warning"
              : "passed",
        machine: {
            hostname: os.hostname(),
            platform: `${os.platform()} ${os.arch()}`,
            osVersion: os.version(),
            cpuModel: cpu?.model ?? "unknown",
            logicalCores: os.cpus().length,
            memoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
        },
        checks,
    };
    span.end({ status: report.status });
    return report;
}

export function formatDoctorReport(report: DoctorReport): string {
    const lines: string[] = [];
    const m = report.machine;
    lines.push(`Machine: ${m.hostname} (${m.platform})`);
    lines.push(`OS:      ${m.osVersion}`);
    lines.push(`CPU:     ${m.cpuModel} (${m.logicalCores} logical cores)`);
    lines.push(`Memory:  ${(m.memoryTotalMb / 1024).toFixed(1)} GB`);
    lines.push("");
    const width = Math.max(...report.checks.map((c) => c.name.length)) + 2;
    for (const check of report.checks) {
        const icon =
            check.status === "passed"
                ? "PASS"
                : check.status === "warning"
                  ? "WARN"
                  : check.status === "failed"
                    ? "FAIL"
                    : "SKIP";
        lines.push(`  [${icon}] ${check.name.padEnd(width)} ${check.message}`);
    }
    lines.push("");
    lines.push(`Overall: ${report.status.toUpperCase()}`);
    return lines.join("\n");
}
