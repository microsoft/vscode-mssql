/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `perftest central report` — a static, self-contained HTML report over the
 * central store (central design §9, CENT-4 local-visualization directive).
 * Reads ONLY the canned central.* views (never base tables), reuses the house
 * report primitives, and renders: store health, fleet trends per scenario/
 * metric, the 30-day regression board, session evidence by build, and the
 * upload ledger. Everything a Grafana panel shows should be one query away
 * here too — local first.
 */

import { writeFileSync } from "node:fs";
import { trendChart } from "../report/charts";
import {
    dataTable,
    esc,
    kpiRow,
    pageShell,
    pill,
    section,
    type PillKind,
} from "../report/htmlShell";
import type { CentralClient } from "./centralClient";

interface TrendKey {
    scenario_id: string;
    name: string;
    environment_hash: string;
}

export async function renderCentralReport(client: CentralClient, outPath: string): Promise<void> {
    const health =
        (await client.query<Record<string, unknown>>("SELECT * FROM central.central_health"))[0] ??
        {};

    const regressions = await client.query<Record<string, unknown>>(
        `SELECT scenario_id, metric_name, environment_hash, unit, latest_run_id,
            latest_run_utc, latest_median, prior_mean, prior_runs, delta_pct, verdict
     FROM central.regressions_last_30d
     ORDER BY CASE verdict WHEN N'regressed' THEN 0 WHEN N'improved' THEN 1
              WHEN N'unchanged' THEN 2 ELSE 3 END, scenario_id, metric_name`,
    );

    const trendKeys = await client.query<TrendKey>(
        `SELECT DISTINCT TOP (12) s.scenario_id, s.name, s.environment_hash
     FROM central.official_metric_samples s
     WHERE s.name = N'scenario.wallclock'
     ORDER BY s.scenario_id`,
    );

    const sessionsByBuild = await client.query<Record<string, unknown>>(
        `SELECT TOP (20) product_sha, sessions, events, gaps, first_session_utc, last_session_utc
     FROM central.sessions_by_build ORDER BY last_session_utc DESC`,
    );

    const uploads = await client.query<Record<string, unknown>>(
        `SELECT TOP (40) upload_batch_id, source_kind, natural_key, status, tool,
            upload_policy_id, started_at_utc, committed_at_utc, outcome_reason
     FROM central.upload_history ORDER BY upload_batch_id DESC`,
    );

    const failures = await client.query<Record<string, unknown>>(
        `SELECT TOP (20) upload_batch_id, source_kind, natural_key, status, outcome_reason,
            item_kind, error_code
     FROM central.ingestion_failures ORDER BY upload_batch_id DESC`,
    );

    const sections: string[] = [];

    sections.push(
        section(
            "Store health",
            "central.central_health — one row of operational truth",
            kpiRow([
                { label: "perf runs", value: String(health["perf_run_entities"] ?? 0) },
                { label: "diag sessions", value: String(health["diag_session_entities"] ?? 0) },
                { label: "diag event rows", value: String(health["diag_event_rows"] ?? 0) },
                { label: "started batches", value: String(health["started_batches"] ?? 0) },
                { label: "failed/refused 7d", value: String(health["failed_or_refused_7d"] ?? 0) },
                {
                    label: "last commit (UTC)",
                    value: String(health["latest_commit_utc"] ?? "never").slice(0, 19),
                },
            ]),
        ),
    );

    const regressionRows = regressions.map((r) => [
        esc(String(r["scenario_id"])),
        esc(String(r["metric_name"])),
        verdictPill(String(r["verdict"])),
        r["delta_pct"] === null ? "—" : `${Number(r["delta_pct"]).toFixed(1)}%`,
        `${fmt(r["latest_median"])} ${String(r["unit"])}`,
        `${fmt(r["prior_mean"])} (${String(r["prior_runs"] ?? 0)} runs)`,
        esc(String(r["latest_run_id"])),
    ]);
    sections.push(
        section(
            "Regressions — last 30 days",
            "central.regressions_last_30d — canned convenience; the CI gate verdict remains the local exit code",
            regressions.length === 0
                ? `<p class="muted">No official samples in the window.</p>`
                : dataTable(
                      [
                          { label: "scenario" },
                          { label: "metric" },
                          { label: "verdict" },
                          { label: "Δ%", numeric: true },
                          { label: "latest median", numeric: true },
                          { label: "prior mean", numeric: true },
                          { label: "latest run" },
                      ],
                      regressionRows,
                  ),
        ),
    );

    const charts: string[] = [];
    for (const key of trendKeys) {
        const series = await client.query<Record<string, unknown>>(
            `SELECT run_id, run_created_at_utc, median_value, samples
       FROM central.trend(@scenario_id, @metric_name, @environment_hash)
       ORDER BY run_created_at_utc`,
            {
                scenario_id: key.scenario_id,
                metric_name: key.name,
                environment_hash: key.environment_hash,
            },
        );
        if (series.length < 2) {
            continue;
        }
        charts.push(
            trendChart(
                series.map((point, index) => ({
                    x: index,
                    y: Number(point["median_value"]),
                    label: String(point["run_id"]),
                })),
                {
                    title: `${key.scenario_id} · ${key.name} · env ${key.environment_hash.slice(0, 15)}…`,
                    xLabel: "run (chronological)",
                    yLabel: "median ms",
                },
            ),
        );
    }
    sections.push(
        section(
            "Fleet trends",
            "central.trend iTVF — per-run medians of official samples (scenario.wallclock)",
            charts.length === 0
                ? `<p class="muted">Not enough runs for trends yet.</p>`
                : charts.join("\n"),
        ),
    );

    sections.push(
        section(
            "Dogfood sessions by build",
            "central.sessions_by_build — uploaded diagnostic session evidence",
            sessionsByBuild.length === 0
                ? `<p class="muted">No uploaded sessions yet — Debug Console → Exports → Upload to shared server.</p>`
                : dataTable(
                      [
                          { label: "product sha" },
                          { label: "sessions", numeric: true },
                          { label: "events", numeric: true },
                          { label: "gaps", numeric: true },
                          { label: "last session (UTC)" },
                      ],
                      sessionsByBuild.map((s) => [
                          esc(String(s["product_sha"]).slice(0, 12)),
                          esc(String(s["sessions"])),
                          esc(String(s["events"])),
                          esc(String(s["gaps"])),
                          esc(String(s["last_session_utc"]).slice(0, 19)),
                      ]),
                  ),
        ),
    );

    sections.push(
        section(
            "Upload ledger (latest 40)",
            "central.upload_history — every attempt is evidence: committed, alreadyPresent, reprojected, refused, failed, abandoned, purged",
            dataTable(
                [
                    { label: "batch", numeric: true },
                    { label: "kind" },
                    { label: "natural key" },
                    { label: "status" },
                    { label: "tool" },
                    { label: "policy" },
                    { label: "committed (UTC)" },
                    { label: "reason" },
                ],
                uploads.map((u) => [
                    esc(String(u["upload_batch_id"])),
                    esc(String(u["source_kind"])),
                    esc(String(u["natural_key"])),
                    statusPill(String(u["status"])),
                    esc(String(u["tool"])),
                    esc(String(u["upload_policy_id"])),
                    u["committed_at_utc"] ? esc(String(u["committed_at_utc"]).slice(0, 19)) : "—",
                    u["outcome_reason"] ? esc(String(u["outcome_reason"])) : "—",
                ]),
            ),
        ),
    );

    if (failures.length > 0) {
        sections.push(
            section(
                "Ingestion failures",
                "central.ingestion_failures — failed/refused/abandoned batches with item-level error codes",
                dataTable(
                    [
                        { label: "batch", numeric: true },
                        { label: "kind" },
                        { label: "natural key" },
                        { label: "status" },
                        { label: "reason" },
                        { label: "item" },
                        { label: "error" },
                    ],
                    failures.map((f) => [
                        esc(String(f["upload_batch_id"])),
                        esc(String(f["source_kind"])),
                        esc(String(f["natural_key"])),
                        statusPill(String(f["status"])),
                        f["outcome_reason"] ? esc(String(f["outcome_reason"])) : "—",
                        f["item_kind"] ? esc(String(f["item_kind"])) : "—",
                        f["error_code"] ? esc(String(f["error_code"])) : "—",
                    ]),
                ),
            ),
        );
    }

    const failed7d = Number(health["failed_or_refused_7d"] ?? 0);
    const html = pageShell({
        title: "Central Observability",
        subtitle: `store ${client.target.database} · schema ${String(health["schema_version"] ?? "?")} · contract ${String(health["contract_version"] ?? "?")}`,
        statusPill:
            failed7d > 0
                ? { label: `${failed7d} failed/refused (7d)`, kind: "warn" as PillKind }
                : { label: "healthy", kind: "ok" as PillKind },
        body: sections.join("\n"),
    });
    writeFileSync(outPath, html, "utf8");
}

function fmt(value: unknown): string {
    const n = Number(value);
    return Number.isFinite(n) ? (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2)) : "—";
}

function verdictPill(verdict: string): string {
    const kind: PillKind =
        verdict === "regressed" ? "fail" : verdict === "improved" ? "ok" : "info";
    return pill(verdict, kind);
}

function statusPill(status: string): string {
    const kind: PillKind =
        status === "committed" || status === "reprojected" || status === "extended"
            ? "ok"
            : status === "alreadyPresent"
              ? "info"
              : status === "refused" || status === "failed"
                ? "fail"
                : "warn";
    return pill(status, kind);
}
