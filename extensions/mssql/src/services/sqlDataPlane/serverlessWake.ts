/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Serverless auto-pause wake handling for data-plane session opens — the port
 * of the classic connect path's behavior (connectionManager.ts
 * serverlessWake*, objectExplorerService.ts expand/create-session retries):
 * an ARM status check runs IN PARALLEL with the open attempt, and when the
 * open fails with a wake-retryable timeout while ARM reports the database as
 * Paused/Pausing/Resuming, the open is retried silently (bounded attempts,
 * brief pause) instead of surfacing a timeout the user must retry by hand.
 *
 * The ARM result is only ever PEEKED (Promise.race against a settled
 * undefined) — a slow or failing ARM call never delays the failure path, it
 * only forfeits the retry. Everything Azure-side is lazily imported so the
 * data plane pays nothing for it until a pause-eligible profile actually
 * fails an open.
 */

import { DataPlaneErrorCodes, SqlConnectionProfileRef, SqlDataPlaneError } from "./api";

/** Same cap as the classic path (connectionManager.serverlessWakeMaxRetryAttempts). */
export const SERVERLESS_WAKE_MAX_RETRY_ATTEMPTS = 2;

/** Brief pause before a wake retry — lets the resume progress past pre-login. */
const SERVERLESS_WAKE_RETRY_DELAY_MS = 2_000;

/** Azure SQL DNS marker (classic getAzureSqlServerName / azureSqlServerSuffix). */
const AZURE_SQL_DNS_MARKER = ".database.";

/** System databases never auto-pause and have no per-database ARM resource. */
const SYSTEM_DATABASES = new Set(["master", "tempdb", "model", "msdb"]);

/** 40613: "Database ... is not currently available" — the resume-in-progress error. */
const AZURE_DB_UNAVAILABLE_ERROR = 40613;

/** ARM statuses that justify a wake retry (classic azureStatusesToRetry). */
const WAKE_RETRY_STATUSES = new Set(["Paused", "Pausing", "Resuming"]);

/**
 * Mirror of the classic canCheckDatabasePauseStatus gate: only a saved Entra
 * profile (ARM access rides the account) targeting a specific non-system
 * database on an Azure SQL host can be status-checked.
 */
export function canCheckPauseStatus(profile: SqlConnectionProfileRef): boolean {
    return (
        profile.authKind === "aad" &&
        profile.accountId !== undefined &&
        profile.server.toLowerCase().includes(AZURE_SQL_DNS_MARKER) &&
        profile.database !== undefined &&
        profile.database.length > 0 &&
        !SYSTEM_DATABASES.has(profile.database.toLowerCase())
    );
}

/**
 * A failure that plausibly IS the paused database: the synthesized client
 * open deadline, a retryable unavailability, or the explicit Azure 40613.
 */
export function isServerlessWakeRetryable(error: unknown): boolean {
    if (!(error instanceof SqlDataPlaneError)) {
        return false;
    }
    if (error.server?.number === AZURE_DB_UNAVAILABLE_ERROR) {
        return true;
    }
    if (error.code === DataPlaneErrorCodes.clientTimeout) {
        return true;
    }
    return error.retryable && error.code === DataPlaneErrorCodes.unavailable;
}

export interface ServerlessWakeDeps {
    /** ARM status source (tests inject; default lazy-imports VsCodeAzureHelper). */
    getStatus?: (profile: SqlConnectionProfileRef) => Promise<string>;
    /** Retry delay override (tests). */
    delayMs?: number;
    /** Retry-attempt cap override (tests). */
    maxRetryAttempts?: number;
}

async function armDatabaseStatus(profile: SqlConnectionProfileRef): Promise<string> {
    // Lazy: keeps the Azure SDK surface out of data-plane activation cost.
    const { VsCodeAzureHelper } = await import("../../connectionconfig/azureHelpers");
    return VsCodeAzureHelper.getAzureSqlDatabaseStatus(
        {
            server: profile.server,
            database: profile.database,
            accountId: profile.accountId,
            tenantId: profile.tenantId,
            authenticationType: "AzureMFA",
        } as Parameters<typeof VsCodeAzureHelper.getAzureSqlDatabaseStatus>[0],
        undefined,
        "data plane open",
    );
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run a session open with serverless wake retries. Ineligible profiles pay
 * exactly one `open()` call and zero ARM traffic.
 */
export async function openWithServerlessWake<T>(
    profile: SqlConnectionProfileRef,
    open: () => Promise<T>,
    deps: ServerlessWakeDeps = {},
): Promise<T> {
    if (!canCheckPauseStatus(profile)) {
        return open();
    }
    const getStatus = deps.getStatus ?? armDatabaseStatus;
    const maxRetries = deps.maxRetryAttempts ?? SERVERLESS_WAKE_MAX_RETRY_ATTEMPTS;
    // Kick the ARM check alongside the first attempt; a failed check reads as
    // "UnableToCheck", never as a rejection the open path could trip over.
    let statusPromise = getStatus(profile).catch(() => "UnableToCheck");
    let retries = 0;
    for (;;) {
        try {
            return await open();
        } catch (error) {
            if (retries >= maxRetries || !isServerlessWakeRetryable(error)) {
                throw error;
            }
            // Peek only — an unsettled ARM check forfeits the retry rather
            // than extending the failure path.
            const status = await Promise.race([
                statusPromise,
                Promise.resolve<string | undefined>(undefined),
            ]);
            if (status === undefined || !WAKE_RETRY_STATUSES.has(status)) {
                throw error;
            }
            retries++;
            // Fresh status for the next peek — the database may come Online
            // (in which case the retry simply succeeds) or keep resuming.
            statusPromise = getStatus(profile).catch(() => "UnableToCheck");
            await delay(deps.delayMs ?? SERVERLESS_WAKE_RETRY_DELAY_MS);
        }
    }
}
