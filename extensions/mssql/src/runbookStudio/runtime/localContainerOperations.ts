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

export interface LocalSqlContainerIdentity {
    containerName: string;
    databaseName: string;
    version: string;
    port: number;
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

function assertEffectId(effectId: string): void {
    if (!/^effect-[a-f0-9]{64}$/i.test(effectId)) {
        throw new Error("invalid effect id for SQL container lease");
    }
}
