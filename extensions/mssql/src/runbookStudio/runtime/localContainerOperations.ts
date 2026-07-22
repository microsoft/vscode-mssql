/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Pure identity and policy rules for Runbook Studio-owned local SQL
 * containers. Credentials never enter these values: the durable lease can
 * prove ownership and drive cleanup after restart without being sufficient
 * to reconnect to SQL Server. */

export const RUNBOOK_CONTAINER_EFFECT_LABEL = "com.microsoft.mssql.runbook-studio.effect-id";
export const RUNBOOK_CONTAINER_RUN_LABEL = "com.microsoft.mssql.runbook-studio.run-id";
export const RUNBOOK_CONTAINER_KIND_LABEL = "com.microsoft.mssql.runbook-studio.kind";
export const RUNBOOK_CONTAINER_KIND = "sql-development-environment";

const CONTAINER_LEASE_PREFIX = "runbook-sql-container-lease:";
const ALLOWED_SQL_CONTAINER_VERSIONS = new Set(["2019", "2022", "2025"]);
export const LOCAL_SQL_CONTAINER_AUTH_TIMEOUT_MS = 60_000;
const LOCAL_SQL_CONNECTION_DETAIL_LIMIT = 512;

export interface LocalSqlContainerIdentity {
    containerName: string;
    databaseName: string;
    version: string;
    port: number;
}

export type LocalSqlContainerDependentOutcomeKind =
    | "dacpacDeploymentOutcomeUnknown"
    | "workloadExecutionOutcomeUnknown"
    | "xeventSessionOutcomeUnknown"
    | "migrationExecutionOutcomeUnknown";

/**
 * Closed mapping for effects whose only durable target is the current run's
 * owned disposable container. Once exact-label deletion and absence have
 * both been proved, these unknown outcomes are compensated without replaying
 * the mutation or claiming that it originally succeeded.
 */
export function classifyLocalSqlContainerDependentEffect(
    activityKind: string,
    recoveryResourceKind: string | undefined,
): LocalSqlContainerDependentOutcomeKind | undefined {
    switch (`${activityKind}\u0000${recoveryResourceKind ?? ""}`) {
        case "dacpac.deploy.container\u0000dacpacDeployment":
            return "dacpacDeploymentOutcomeUnknown";
        case "sql.workload.run\u0000workloadExecution":
            return "workloadExecutionOutcomeUnknown";
        case "xevent.session.start\u0000xeventSession":
            return "xeventSessionOutcomeUnknown";
        case "migration.apply\u0000migrationExecution":
            return "migrationExecutionOutcomeUnknown";
        default:
            return undefined;
    }
}

export function validateLocalSqlContainerIdentity(input: {
    containerName: string;
    databaseName: string;
    version: string;
    port: number;
}): LocalSqlContainerIdentity | undefined {
    const containerName = input.containerName.trim();
    const databaseName = input.databaseName.trim();
    const version = input.version.trim();
    if (
        containerName.length < 4 ||
        containerName.length > 63 ||
        !/^rbs-[a-z0-9][a-z0-9_.-]*$/i.test(containerName) ||
        databaseName.length === 0 ||
        databaseName.length > 128 ||
        !/^[A-Za-z_][A-Za-z0-9_$#@-]*$/.test(databaseName) ||
        ["master", "model", "msdb", "tempdb"].includes(databaseName.toLowerCase()) ||
        !ALLOWED_SQL_CONTAINER_VERSIONS.has(version) ||
        !Number.isSafeInteger(input.port) ||
        input.port < 1024 ||
        input.port > 65535
    ) {
        return undefined;
    }
    return { containerName, databaseName, version, port: input.port };
}

export function localSqlContainerLeaseRef(effectId: string): string {
    assertEffectId(effectId);
    return `${CONTAINER_LEASE_PREFIX}${effectId}`;
}

export function effectIdFromLocalSqlContainerLeaseRef(value: string): string | undefined {
    const match = /^runbook-sql-container-lease:(effect-[a-f0-9]{64})$/i.exec(value.trim());
    return match?.[1];
}

export function localSqlContainerLabels(effectId: string, runId: string): Record<string, string> {
    assertEffectId(effectId);
    if (runId.trim().length === 0 || runId.length > 256) {
        throw new Error("invalid run id for SQL container lease");
    }
    return {
        [RUNBOOK_CONTAINER_EFFECT_LABEL]: effectId,
        [RUNBOOK_CONTAINER_RUN_LABEL]: runId,
        [RUNBOOK_CONTAINER_KIND_LABEL]: RUNBOOK_CONTAINER_KIND,
    };
}

export function isOwnedLocalSqlContainer(
    labels: Record<string, string> | undefined,
    effectId: string,
    runId: string,
): boolean {
    return (
        labels?.[RUNBOOK_CONTAINER_EFFECT_LABEL] === effectId &&
        labels?.[RUNBOOK_CONTAINER_RUN_LABEL] === runId &&
        labels?.[RUNBOOK_CONTAINER_KIND_LABEL] === RUNBOOK_CONTAINER_KIND
    );
}

/** The SQL image can emit its ready log before first-run password setup and
 * restart have settled. Runbook provisioning therefore requires a bounded
 * authenticated probe instead of trusting the log line alone. */
export async function waitForLocalSqlContainerAuthentication(
    connect: () => Promise<boolean>,
    resetFailedAttempt: () => Promise<void>,
    isCancellationRequested: () => boolean,
    options: {
        timeoutMs?: number;
        retryDelayMs?: number;
        now?: () => number;
        wait?: (milliseconds: number) => Promise<void>;
    } = {},
): Promise<boolean> {
    const timeoutMs = Math.max(1, options.timeoutMs ?? LOCAL_SQL_CONTAINER_AUTH_TIMEOUT_MS);
    const retryDelayMs = Math.max(1, options.retryDelayMs ?? 1000);
    const now = options.now ?? Date.now;
    const wait =
        options.wait ??
        ((milliseconds: number) =>
            new Promise<void>((resolve) => {
                setTimeout(resolve, milliseconds);
            }));
    const deadline = now() + timeoutMs;
    let firstAttempt = true;
    while (!isCancellationRequested() && (firstAttempt || now() < deadline)) {
        firstAttempt = false;
        try {
            if (await connect()) {
                return true;
            }
        } catch {
            // Authentication/provider startup failures are retried within the bound.
        }
        try {
            await resetFailedAttempt();
        } catch {
            // A failed connect may not have created a session to reset.
        }
        if (isCancellationRequested() || now() >= deadline) {
            return false;
        }
        await wait(Math.min(retryDelayMs, Math.max(1, deadline - now())));
    }
    return false;
}

/** Keeps provider failures useful in the run log without copying an
 * unbounded stack trace or connection-string credential into user-facing
 * evidence. */
export function summarizeLocalSqlConnectionFailure(
    errorMessage: string | undefined,
    providerMessages: string | undefined,
): string | undefined {
    const lines = [errorMessage, providerMessages]
        .flatMap((value) => (value ?? "").split(/\r?\n/u))
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !/^at\s/u.test(line))
        .slice(0, 2);
    if (lines.length === 0) {
        return undefined;
    }
    const safe = lines
        .join(" ")
        .replace(/\b(?:password|pwd)\s*=\s*[^;\s]*/giu, "credential=<redacted>")
        .replace(/\s+/gu, " ")
        .trim();
    return safe.length > LOCAL_SQL_CONNECTION_DETAIL_LIMIT
        ? `${safe.slice(0, LOCAL_SQL_CONNECTION_DETAIL_LIMIT - 1)}…`
        : safe;
}

function assertEffectId(effectId: string): void {
    if (!/^effect-[a-f0-9]{64}$/i.test(effectId)) {
        throw new Error("invalid effect id for SQL container lease");
    }
}
