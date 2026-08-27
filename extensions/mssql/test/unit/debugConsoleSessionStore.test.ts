/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Session store: retention must bound interrupted ("active" but not current)
 * sessions, journal validation rejects malformed monotonic clocks, and the
 * History sidecar makes per-session aggregates a one-time cost.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionStore } from "../../src/diagnostics/sessionStore";
import {
    DIAG_SCHEMA_VERSION,
    DiagEvent,
    SessionManifest,
} from "../../src/sharedInterfaces/debugConsole";

function event(seq: number, overrides?: Partial<DiagEvent>): DiagEvent {
    return {
        schemaVersion: DIAG_SCHEMA_VERSION,
        eventId: `evt_${seq}`,
        sessionId: "s",
        seq,
        epochMs: 1_700_000_000_000 + seq,
        process: "extensionHost",
        feature: "query",
        kind: "event",
        type: "mssql.query.submit",
        status: "ok",
        cls: { max: "public", redactedFields: 0, policyId: "p" },
        ...overrides,
    };
}

function writeSession(
    root: string,
    sessionId: string,
    createdUtc: string,
    status: SessionManifest["status"],
    events: DiagEvent[] = [event(1), event(2)],
): void {
    const dir = path.join(root, "sessions", sessionId, "events");
    fs.mkdirSync(dir, { recursive: true });
    const lines = events.map((e) => JSON.stringify({ ...e, sessionId })).join("\n");
    fs.writeFileSync(path.join(dir, "segment-000001.jsonl"), lines.length > 0 ? `${lines}\n` : "");
    const manifest: SessionManifest = {
        schemaVersion: "mssql.diag.sessionManifest/1",
        sessionId,
        createdUtc,
        updatedUtc: createdUtc,
        source: "live",
        captureMode: "redacted",
        policyId: "p",
        eventCount: events.length,
        gapCount: 0,
        segments: [
            {
                file: "segment-000001.jsonl",
                firstSeq: events[0]?.seq ?? 0,
                lastSeq: events[events.length - 1]?.seq ?? 0,
                events: events.length,
            },
        ],
        sizeBytes: Buffer.byteLength(lines, "utf8"),
        provenance: {},
        status,
    };
    fs.writeFileSync(
        path.join(root, "sessions", sessionId, "manifest.json"),
        JSON.stringify(manifest),
    );
}

suite("Debug Console session store", () => {
    let root: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "dc-store-"));
    });

    teardown(() => {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // best effort on Windows
        }
    });

    test("retention protects only the current session — an interrupted 'active' session is evictable", () => {
        writeSession(root, "old-crashed", "2026-01-01T00:00:00.000Z", "active");
        writeSession(root, "old-closed", "2026-01-02T00:00:00.000Z", "closed");
        writeSession(root, "current", "2026-01-03T00:00:00.000Z", "active");
        const store = new SessionStore(root);
        store.enforceRetention(1, 365, undefined, "current");
        const remaining = store.listLocalSessions().map((s) => s.manifest.sessionId);
        expect(remaining).to.deep.equal(["current"]);
    });

    test("size budget evicts interrupted sessions too, oldest first, never the current one", () => {
        writeSession(root, "a-crashed", "2026-01-01T00:00:00.000Z", "active");
        writeSession(root, "b-closed", "2026-01-02T00:00:00.000Z", "closed");
        writeSession(root, "current", "2026-01-03T00:00:00.000Z", "active");
        const store = new SessionStore(root);
        // Budget fits exactly the two newest sessions (sizes differ per session id).
        const sizes = new Map(
            store.listLocalSessions().map((s) => [s.manifest.sessionId, s.manifest.sizeBytes!]),
        );
        store.enforceRetention(
            10,
            365,
            sizes.get("current")! + sizes.get("b-closed")! + 1,
            "current",
        );
        const remaining = store.listLocalSessions().map((s) => s.manifest.sessionId);
        expect(remaining).to.deep.equal(["current", "b-closed"]);
    });

    test("listSources labels an interrupted session honestly", () => {
        writeSession(root, "crashed", "2026-01-01T00:00:00.000Z", "active");
        writeSession(root, "closed", "2026-01-02T00:00:00.000Z", "closed");
        const store = new SessionStore(root);
        const labels = store
            .listSources({ sessionId: "live", eventCount: 0, captureMode: "off", provenance: {} })
            .filter((s) => s.kind === "localSession")
            .map((s) => s.label);
        expect(labels.some((l) => l.endsWith("(interrupted)"))).to.equal(true);
        expect(labels.filter((l) => l.endsWith("(interrupted)"))).to.have.length(1);
    });

    test("journal lines with a malformed monotonic clock are refused at load", () => {
        writeSession(root, "s1", "2026-01-01T00:00:00.000Z", "closed", [
            event(1, { monotonicNs: "123456" }),
            event(2, { monotonicNs: "not-a-number" }),
            event(3),
        ]);
        const store = new SessionStore(root);
        const loaded = store.eventsForSource("store:s1");
        expect(loaded.map((e) => e.seq)).to.deep.equal([1, 3]);
    });

    test("validateStore stays bounded and still flags a torn trailing segment", () => {
        writeSession(root, "s1", "2026-01-01T00:00:00.000Z", "closed", [event(1), event(2)]);
        const store = new SessionStore(root);
        expect(store.validateStore().issues).to.deep.equal([]);
        const segment = path.join(root, "sessions", "s1", "events", "segment-000001.jsonl");
        const content = fs.readFileSync(segment, "utf8");
        fs.writeFileSync(segment, content.slice(0, content.length - 5), "utf8");
        const issues = store.validateStore().issues;
        expect(issues.some((i) => i.includes("partial trailing line"))).to.equal(true);
    });

    test("historySummaryFor computes once and serves the sidecar afterwards", () => {
        writeSession(root, "s1", "2026-01-01T00:00:00.000Z", "closed", [
            event(1),
            event(2, { status: "error" }),
        ]);
        const store = new SessionStore(root);
        let computeCalls = 0;
        const compute = (events: DiagEvent[]) => {
            computeCalls++;
            return {
                schemaVersion: "mssql.diag.historySummary/1" as const,
                events: events.length,
                errors: events.filter((e) => e.status === "error").length,
                actions: [],
            };
        };
        const first = store.historySummaryFor("s1", compute);
        expect(first.events).to.equal(2);
        expect(first.errors).to.equal(1);
        expect(fs.existsSync(path.join(root, "sessions", "s1", "history-summary.json"))).to.equal(
            true,
        );
        const second = store.historySummaryFor("s1", compute);
        expect(second).to.deep.equal(first);
        expect(computeCalls).to.equal(1);
        // Non-cacheable (the current session) always recomputes and writes nothing.
        store.historySummaryFor("s1", compute, { cacheable: false });
        expect(computeCalls).to.equal(2);
        expect(store.historySummaryFor("../escape", compute).events).to.equal(0);
    });
});
