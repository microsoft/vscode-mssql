/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Central-store admin operations: init, migrate, check (central design §5.1,
 * C0.7). The DDL lives in perf-contracts (contract-owned, idempotent);
 * this module splits it into GO batches, applies it, and seeds/validates
 * central.schema_info so `central check` can flag contract/vocabulary skew
 * between writers and the store (H-2).
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
    CENTRAL_CONTRACT_VERSION,
    centralSchemaPaths,
    RANK_TABLE_VERSION,
    UNION_VERSIONS,
} from "@mssqlperf/contracts";
import type { HarnessLogger } from "../telemetry/logger";
import type { CentralClient } from "./centralClient";

export const CENTRAL_SCHEMA_VERSION = "central-store/1";
export const CENTRAL_MIN_COMPAT_LEVEL = 150;

/** Split an idempotent DDL script into GO batches (sqlcmd semantics). */
export function splitGoBatches(script: string): string[] {
    return script
        .split(/^\s*GO\s*$/im)
        .map((batch) => batch.trim())
        .filter((batch) => batch.length > 0);
}

export async function centralInit(client: CentralClient, logger: HarnessLogger): Promise<void> {
    for (const path of centralSchemaPaths()) {
        const script = readFileSync(path, "utf8");
        const batches = splitGoBatches(script);
        const span = logger.span("centralInit.apply", {
            file: basename(path),
            batches: batches.length,
        });
        for (const batch of batches) {
            await client.batch(batch);
        }
        span.end();
    }
    await seedSchemaInfo(client);
    logger.info("centralInit.done", undefined, { schemaVersion: CENTRAL_SCHEMA_VERSION });
}

async function seedSchemaInfo(client: CentralClient): Promise<void> {
    const unionVersions = JSON.stringify(UNION_VERSIONS).replace(/'/g, "''");
    await client.batch(`
IF EXISTS (SELECT 1 FROM central.schema_info WHERE schema_name = N'central')
    UPDATE central.schema_info
    SET schema_version = N'${CENTRAL_SCHEMA_VERSION}',
        contract_version = N'${CENTRAL_CONTRACT_VERSION}',
        rank_table_version = N'${RANK_TABLE_VERSION}',
        union_versions_json = N'${unionVersions}',
        min_compat_level = ${CENTRAL_MIN_COMPAT_LEVEL},
        updated_at_utc = sysutcdatetime()
    WHERE schema_name = N'central';
ELSE
    INSERT INTO central.schema_info
        (schema_name, schema_version, contract_version, rank_table_version, union_versions_json, min_compat_level)
    VALUES
        (N'central', N'${CENTRAL_SCHEMA_VERSION}', N'${CENTRAL_CONTRACT_VERSION}',
         N'${RANK_TABLE_VERSION}', N'${unionVersions}', ${CENTRAL_MIN_COMPAT_LEVEL});
`);
}

export interface CentralCheckResult {
    ok: boolean;
    issues: string[];
    facts: Record<string, unknown>;
}

const REQUIRED_PROCS = [
    "usp_ensure_uploader",
    "usp_begin_upload",
    "usp_stage_upload_item",
    "usp_commit_upload",
    "usp_abort_upload",
    "usp_purge_entity",
    "usp_set_baseline",
    "usp_retention_cleanup",
    "usp_store_health",
];

const REQUIRED_VIEWS = [
    "visible_batches",
    "official_metric_samples",
    "official_metric_samples_ex",
    "latest_run_per_scenario_env",
    "regressions_last_30d",
    "sessions_by_feature_error_rate",
    "sessions_by_build",
    "fleet_by_build",
    "upload_history",
    "policy_drop_summary",
    "ingestion_failures",
    "central_health",
];

export async function centralCheck(client: CentralClient): Promise<CentralCheckResult> {
    const issues: string[] = [];

    const compat = await client.query<{ compatibility_level: number }>(
        "SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()",
    );
    const level = compat[0]?.compatibility_level ?? 0;
    if (level < CENTRAL_MIN_COMPAT_LEVEL) {
        issues.push(`database compatibility level ${level} < required ${CENTRAL_MIN_COMPAT_LEVEL}`);
    }

    const info = await client.query<{
        schema_version: string;
        contract_version: string;
        rank_table_version: string;
        union_versions_json: string;
    }>(
        "SELECT schema_version, contract_version, rank_table_version, union_versions_json FROM central.schema_info WHERE schema_name = N'central'",
    );
    if (info.length === 0) {
        issues.push("central.schema_info has no 'central' row — run central init");
    } else {
        const row = info[0]!;
        if (row.schema_version !== CENTRAL_SCHEMA_VERSION) {
            issues.push(
                `schema_version '${row.schema_version}' != writer '${CENTRAL_SCHEMA_VERSION}'`,
            );
        }
        if (row.contract_version !== CENTRAL_CONTRACT_VERSION) {
            issues.push(
                `contract_version '${row.contract_version}' != writer '${CENTRAL_CONTRACT_VERSION}'`,
            );
        }
        if (row.rank_table_version !== RANK_TABLE_VERSION) {
            issues.push(
                `rank_table_version '${row.rank_table_version}' != writer '${RANK_TABLE_VERSION}' — reprojection needed`,
            );
        }
        try {
            const stored = JSON.parse(row.union_versions_json) as { version?: string };
            if (stored.version !== UNION_VERSIONS.version) {
                issues.push(
                    `union versions '${stored.version}' != writer '${UNION_VERSIONS.version}'`,
                );
            }
        } catch {
            issues.push("union_versions_json is not parseable");
        }
    }

    const procs = await client.query<{ name: string }>(
        "SELECT name FROM sys.procedures WHERE SCHEMA_NAME(schema_id) = N'central'",
    );
    const procNames = new Set(procs.map((p) => p.name));
    for (const proc of REQUIRED_PROCS) {
        if (!procNames.has(proc)) {
            issues.push(`missing procedure central.${proc}`);
        }
    }

    const views = await client.query<{ name: string }>(
        "SELECT name FROM sys.views WHERE SCHEMA_NAME(schema_id) = N'central'",
    );
    const viewNames = new Set(views.map((v) => v.name));
    for (const view of REQUIRED_VIEWS) {
        if (!viewNames.has(view)) {
            issues.push(`missing view central.${view}`);
        }
    }

    const trendFn = await client.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sys.objects WHERE SCHEMA_NAME(schema_id) = N'central' AND name = N'trend' AND type IN ('IF','TF')",
    );
    if ((trendFn[0]?.n ?? 0) === 0) {
        issues.push("missing function central.trend");
    }

    let health: Record<string, unknown> = {};
    try {
        health = await client.storeHealth();
    } catch (error) {
        issues.push(`usp_store_health failed: ${(error as Error).message}`);
    }

    return { ok: issues.length === 0, issues, facts: health };
}
