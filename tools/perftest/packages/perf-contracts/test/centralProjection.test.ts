import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
    assertUploadable,
    type CentralDiagEventRow,
    type CentralProjection,
    type DiagSessionSource,
    isDigestForm,
    type PerfRunSource,
    projectDiagSession,
    projectPerfRun,
    type UploadPolicyId,
} from "../src";

const FIXTURES = join(__dirname, "..", "fixtures", "central");
const NUL = String.fromCharCode(0);

function loadRun(): PerfRunSource {
    return JSON.parse(readFileSync(join(FIXTURES, "golden-run", "source.json"), "utf8"));
}
function loadSession(): DiagSessionSource {
    return JSON.parse(readFileSync(join(FIXTURES, "golden-session", "source.json"), "utf8"));
}
function loadCanaries(): DiagSessionSource {
    return JSON.parse(readFileSync(join(FIXTURES, "privacy-canaries", "source.json"), "utf8"));
}

function rowsOf<T>(projection: CentralProjection, kind: string): T[] {
    return projection.items
        .filter((i) => i.item_kind === kind)
        .flatMap((i) => JSON.parse(i.payload_json) as T[]);
}

/** Cross-repo parity anchor (T-B5): digests locked in expected.json. */
function checkExpected(name: string, projection: CentralProjection): void {
    const path = join(FIXTURES, name, "expected.json");
    if (!existsSync(path)) {
        throw new Error(`${path} missing — regenerate with scripts/central-lock-goldens`);
    }
    const expected = JSON.parse(readFileSync(path, "utf8"));
    expect({
        sourceDigest: projection.sourceDigest,
        contentDigest: projection.contentDigest,
        projectionDigest: projection.projectionDigest,
        previewDigest: projection.previewDigest,
        tables: projection.preview.tables,
    }).toEqual(expected);
}

describe("golden perf-run projection (T-B5 perftest half)", () => {
    const policy: UploadPolicyId = "team-default.v1";

    it("is deterministic: projecting twice yields byte-identical item streams", () => {
        const a = projectPerfRun(loadRun(), { uploadPolicyId: policy });
        const b = projectPerfRun(loadRun(), { uploadPolicyId: policy });
        expect(a.projectionDigest).toBe(b.projectionDigest);
        expect(a.previewDigest).toBe(b.previewDigest);
        expect(a.items.map((i) => i.payload_json)).toEqual(b.items.map((i) => i.payload_json));
    });

    it("matches the locked golden digests", () => {
        checkExpected("golden-run", projectPerfRun(loadRun(), { uploadPolicyId: policy }));
    });

    it("applies the C-8 subtraction map under team-default", () => {
        const p = projectPerfRun(loadRun(), { uploadPolicyId: policy });
        const runs = rowsOf<Record<string, unknown>>(p, "runs");
        expect(runs).toHaveLength(1);
        // machine label digested, notes dropped
        expect(runs[0]!.machine_id).toMatch(/^fld_/);
        expect(runs[0]!.notes).toBeNull();
        expect(JSON.stringify(runs)).not.toContain("GOLDEN-MACHINE-01");
        expect(JSON.stringify(p.items)).not.toContain("golden run user note");
        // absolute artifact path refused, relative ones rebased to run root
        expect(p.preview.refused.some((r) => r.reason === "absolutePath")).toBe(true);
        const artifacts = rowsOf<Record<string, unknown>>(p, "artifact_refs");
        expect(artifacts.map((a) => a.relative_path)).toEqual([
            "scenarios/golden-query/reps/rep-00/markers.jsonl",
            "scenarios/golden-query/reps/rep-00/artifacts/final.png",
        ]);
        expect(JSON.stringify(p.items)).not.toContain("C:\\\\absolute");
    });

    it("keeps notes and machine label under team-names", () => {
        const p = projectPerfRun(loadRun(), { uploadPolicyId: "team-names.v1" });
        const runs = rowsOf<Record<string, unknown>>(p, "runs");
        expect(runs[0]!.machine_id).toBe("GOLDEN-MACHINE-01");
        expect(runs[0]!.notes).toBe("golden run user note");
    });

    it("carries attempt_id through repetitions and metrics (C-9)", () => {
        const p = projectPerfRun(loadRun(), { uploadPolicyId: policy });
        const reps = rowsOf<Record<string, unknown>>(p, "repetitions");
        expect(reps.map((r) => [r.scenario_id, r.rep_id, r.attempt_id])).toEqual([
            ["golden-connect", 0, 0],
            ["golden-query", 0, 0],
            ["golden-query", 1, 1],
        ]);
        const metrics = rowsOf<Record<string, unknown>>(p, "metrics");
        expect(metrics.filter((m) => m.attempt_id === 1)).toHaveLength(1);
        expect(metrics.every((m) => typeof m.official === "number")).toBe(true);
    });

    it("summarizes tables and source in the preview from the real item stream", () => {
        const p = projectPerfRun(loadRun(), { uploadPolicyId: policy });
        const byName = Object.fromEntries(p.preview.tables.map((t) => [t.name, t.rows]));
        expect(byName).toEqual({
            runs: 1,
            run_repositories: 2,
            environments: 1,
            scenarios: 2,
            repetitions: 3,
            metrics: 4,
            validations: 2,
            artifact_refs: 2,
        });
        expect(p.preview.sourceSummary.files).toBe(6);
        expect(p.kind).toBe("perfRun");
        expect(p.naturalKey).toBe("2026-07-01T10-00-00Z_deadbeef");
        expect(() => assertUploadable(p)).toThrow(/absolutePath|refused/);
    });
});

describe("golden diag-session projection (C-4/C-5/C-7)", () => {
    const policy: UploadPolicyId = "team-default.v1";

    it("is deterministic and matches locked digests", () => {
        const a = projectDiagSession(loadSession(), { uploadPolicyId: policy });
        const b = projectDiagSession(loadSession(), { uploadPolicyId: policy });
        expect(a.projectionDigest).toBe(b.projectionDigest);
        checkExpected("golden-session", a);
    });

    it("filters payloads per class: keeps shapes, digests names/paths, drops sql text", () => {
        const p = projectDiagSession(loadSession(), { uploadPolicyId: policy });
        const events = rowsOf<CentralDiagEventRow>(p, "diag_events");
        expect(events).toHaveLength(6);
        const all = JSON.stringify(events);
        expect(all).not.toContain("prod-sql-01.contoso.com");
        expect(all).not.toContain("SELECT secret_col");
        expect(all).not.toContain("query-results.csv");
        expect(all).toContain("sqd_9999999999999999999999"); // sql.digest kept
        const sqlEvent = events.find((e) => e.event_id === "evt-0002")!;
        const payload = JSON.parse(sqlEvent.payload_json);
        expect(payload.sqlText).toBeUndefined();
        expect(payload.rowCount.v).toBe(100);
        // cls_max reflects the STORED row (sql.digest outranks result.shape),
        // not the pre-upload event whose max was sql.text
        expect(sqlEvent.cls_max).toBe("sql.digest");
    });

    it("passes digest-form entity ids, digests raw ones (C-4)", () => {
        expect(isDigestForm("sfp_AbCdEfGhIjKlMnOpQrSt12")).toBe(true);
        expect(isDigestForm("c:/Users/karl/project/query1.sql")).toBe(false);
        const p = projectDiagSession(loadSession(), { uploadPolicyId: policy });
        const events = rowsOf<CentralDiagEventRow>(p, "diag_events");
        expect(events.find((e) => e.event_id === "evt-0001")!.entity_ref).toBe(
            "sfp_AbCdEfGhIjKlMnOpQrSt12",
        );
        const doc = events.find((e) => e.event_id === "evt-0003")!;
        expect(doc.entity_kind).toBe("document");
        expect(doc.entity_ref).toMatch(/^fld_/);
    });

    it("projects gaps as rows, unions droppedRanges, dedups identical spans (C-5)", () => {
        const p = projectDiagSession(loadSession(), { uploadPolicyId: policy });
        const gaps = rowsOf<Record<string, unknown>>(p, "diag_gaps");
        expect(gaps.map((g) => [g.gap_id, g.from_seq, g.through_seq])).toEqual([
            ["gap-0001", 4, 5],
            ["range:9", 9, 12],
        ]);
    });

    it("filters provenance: machineLabel digested, join keys kept (C-7)", () => {
        const p = projectDiagSession(loadSession(), { uploadPolicyId: policy });
        const sessions = rowsOf<Record<string, unknown>>(p, "diag_sessions");
        expect(sessions).toHaveLength(1);
        const prov = JSON.parse(sessions[0]!.provenance_json as string);
        expect(prov.machineLabel).toMatch(/^fld_/);
        expect(prov.commit).toBe("091b6712b0000000000000000000000000000000");
        expect(JSON.stringify(p.items)).not.toContain("KARL-DEV-BOX");
        expect(sessions[0]!.product_sha).toBe("091b6712b0000000000000000000000000000000");
        expect(sessions[0]!.environment_hash).toMatch(/^sha256:1111/);
    });

    it("a redacted secret marker drops quietly; the session stays uploadable", () => {
        const p = projectDiagSession(loadSession(), { uploadPolicyId: policy });
        expect(p.preview.refused).toEqual([]);
        expect(() => assertUploadable(p)).not.toThrow();
        expect(p.preview.dropped.some((d) => d.cls === "secret")).toBe(true);
    });
});

describe("privacy canaries (T-B8; addendum §5)", () => {
    const policies: UploadPolicyId[] = ["team-default.v1", "team-names.v1", "elevated-support.v1"];

    it("plain secrets refuse the upload under every policy", () => {
        for (const uploadPolicyId of policies) {
            const p = projectDiagSession(loadCanaries(), { uploadPolicyId });
            expect(
                p.preview.refused.some((r) => r.cls === "secret"),
                `${uploadPolicyId} must refuse plain secret`,
            ).toBe(true);
            expect(() => assertUploadable(p)).toThrow(/refused/);
        }
    });

    it("no canary value survives into rows or preview under any policy", () => {
        const forbidden = [
            "CANARY-PASSWORD-hunter2-XYZZY",
            "CANARY-CONN-PWD-123",
            "CANARY-TOKEN-eyJhbGciOi",
            "SELECT ssn, salary",
            "123-45-6789",
            "CANARY-PROMPT",
            "CANARY-RESPONSE",
        ];
        for (const uploadPolicyId of policies) {
            const p = projectDiagSession(loadCanaries(), { uploadPolicyId });
            const surface = JSON.stringify(p.items) + JSON.stringify(p.preview);
            for (const canary of forbidden) {
                expect(surface, `${uploadPolicyId} leaked ${canary}`).not.toContain(canary);
            }
        }
    });

    it("team-default also hides names, paths and machine label; team-names keeps names only", () => {
        const td = projectDiagSession(loadCanaries(), { uploadPolicyId: "team-default.v1" });
        const tdSurface = JSON.stringify(td.items);
        for (const canary of [
            "CANARY-SERVER.contoso.com",
            "CanaryProdDB",
            "CanarySecretTable",
            "CANARY-USER-NOTE",
            "CANARY-MACHINE-LABEL-7",
            "CANARY-UNKNOWN-CLASS-VALUE",
        ]) {
            expect(tdSurface, `team-default leaked ${canary}`).not.toContain(canary);
        }
        const tn = projectDiagSession(loadCanaries(), { uploadPolicyId: "team-names.v1" });
        const tnSurface = JSON.stringify(tn.items);
        expect(tnSurface).toContain("CanaryProdDB");
        expect(tnSurface).not.toContain("CANARY-MACHINE-LABEL-7");
        expect(tnSurface).not.toContain("D:\\\\CANARY");
    });

    it("escaper bombs are sanitized at projection so the encoder accepts every payload", async () => {
        const p = projectDiagSession(loadCanaries(), { uploadPolicyId: "team-names.v1" });
        const events = rowsOf<CentralDiagEventRow>(p, "diag_events");
        const bombs = JSON.parse(events.find((e) => e.event_id === "cnr-0003")!.payload_json);
        expect(bombs.quoteBomb.v).toContain("' OR 1=1");
        expect(bombs.nulBomb.v).toBe("beforeafter");
        expect(bombs.nulBomb.handling).toBe("truncated");
        expect(bombs.surrogateBomb.handling).toBe("truncated");
        expect(bombs.surrogateBomb.v).toContain("�");
        const { sqlNString } = await import("../src");
        for (const item of p.items) {
            expect(() => sqlNString(item.payload_json, 16 * 1024 * 1024)).not.toThrow();
        }
    });

    it("ci-official refuses the diagSession kind outright", () => {
        const p = projectDiagSession(loadCanaries(), { uploadPolicyId: "ci-official.v1" });
        expect(p.preview.refused.some((r) => r.reason === "kindProhibitedByPolicy")).toBe(true);
    });
});
