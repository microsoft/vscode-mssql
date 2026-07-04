/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Observability Contract conformance: the marker/event names this extension
 * actually emits must exist in the shared registry (vendored snapshot from
 * perftest/packages/observability-contracts). If this fails you either
 * added an unregistered event (register it + regenerate + re-vendor) or the
 * snapshot is stale.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
    OBS_CONTRACT,
    deriveEligibility,
    explainEventName,
    lintCorrelation,
} from "../../src/sharedInterfaces/observabilityContract.generated";

const SRC_ROOT = path.join(__dirname, "..", "..", "..", "src");

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

suite("Observability Contract conformance", () => {
    test("every Perf marker literal emitted by src/ is registered", function () {
        if (!fs.existsSync(SRC_ROOT)) {
            this.skip(); // packaged test run without sources
        }
        const emitted = new Set<string>();
        for (const file of walk(SRC_ROOT)) {
            const source = fs.readFileSync(file, "utf8");
            for (const m of source.matchAll(/Perf\.(?:marker|begin|end|instant)\(\s*"([^"]+)"/g)) {
                emitted.add(m[1]);
            }
            for (const m of source.matchAll(/perfMarkAfterNextPaint\(\s*"([^"]+)"/g)) {
                emitted.add(m[1]);
            }
        }
        expect(emitted.size, "no markers found — extraction regex broke?").to.be.greaterThan(15);
        const unknown = [...emitted].filter((name) => !explainEventName(name).known);
        expect(
            unknown,
            `unregistered marker names (add to the registry + regenerate):\n${unknown.join("\n")}`,
        ).to.deep.equal([]);
    });

    test("registry attr classifications resolve and sts families stay diagnostic", () => {
        for (const entry of OBS_CONTRACT.events) {
            for (const cls of Object.values(entry.attrs)) {
                expect(
                    OBS_CONTRACT.classifications[cls],
                    `${entry.name ?? entry.prefix}: classification '${cls}'`,
                ).to.not.equal(undefined);
            }
            if (entry.prefix?.startsWith("sts.")) {
                expect(entry.timingClass).to.equal("epochAligned");
                expect(entry.measurementEligible).to.equal(false);
            }
        }
    });

    test("timing honesty: the vendored eligibility function enforces the rules", () => {
        const base = {
            source: "marker",
            passType: "measurement" as const,
            environment: "interactiveHost" as const,
            timePlane: "monotonic" as const,
            repStatus: "passed" as const,
            richCollection: false,
        };
        // Self-test on an interactive host: exploratory, never CI-gating.
        const selfTest = deriveEligibility(base);
        expect(selfTest.measurementEligible).to.equal(true);
        expect(selfTest.exploratory).to.equal(true);
        expect(selfTest.ciGatingEligible).to.equal(false);
        // Epoch-aligned STS spans and rich-collection reps: diagnostic-only.
        expect(deriveEligibility({ ...base, timePlane: "epoch" }).diagnosticOnly).to.equal(true);
        expect(deriveEligibility({ ...base, richCollection: true }).diagnosticOnly).to.equal(true);
    });

    test("vendored correlation linter: registry pairing + honest scoring", () => {
        const ev = (type: string, traceId?: string, seq = 1) => ({
            seq,
            type,
            kind: "event",
            epochMs: 1000 + seq,
            process: "extensionHost",
            ...(traceId ? { traceId } : {}),
        });
        const clean = lintCorrelation([
            ev("mssql.connection.begin", "t1", 1),
            ev("mssql.connection.ready", "t1", 2),
        ]);
        expect(clean.score).to.equal("good");
        const foggy = lintCorrelation([
            ev("mssql.query.submit", undefined, 1), // orphan + unpaired
        ]);
        expect(foggy.orphanCount).to.equal(1);
        expect(foggy.unmatchedPairs.length).to.be.greaterThan(0);
        expect(foggy.score).to.not.equal("good");
    });
});
