/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TSQ2-14: packaging guards and lifecycle soak.
 *
 * Guard 1 (forbidden shortcut #1): NOTHING reachable from normal extension
 * activation may include tedious — asserted against the esbuild metafile
 * (dev builds) and the bundled extension.js text.
 * Guard 2: the dedicated provider chunk exists and DOES carry tedious.
 * Soak: repeated open/execute/{complete|cancel|dispose|loss}/close cycles on
 * the fake driver reach a bounded plateau — no leaked virtual timers, no
 * leaked sessions, active-query slots released (N-I10).
 */

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { IQueryEventSink, SqlConnectionProfileRef } from "../../../src/services/sqlDataPlane/api";
import { FakeTdsDriver, VirtualClock } from "../../../src/services/tsNative/driver/fakeTdsDriver";
import { TsNativeBackend } from "../../../src/services/tsNative/tsNativeBackend";

const EXTENSION_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const PROFILE: SqlConnectionProfileRef = {
    profileFingerprint: "fp_soak",
    server: "fakehost",
    authKind: "sql",
    user: "sa",
};

suite("ts-native packaging guards (TSQ2-14)", () => {
    test("activation bundle never includes tedious; provider chunk does", function () {
        const distDir = path.join(EXTENSION_ROOT, "dist");
        const extensionBundle = path.join(distDir, "extension.js");
        const providerBundle = path.join(distDir, "tsNativeProvider.js");
        if (!fs.existsSync(extensionBundle) || !fs.existsSync(providerBundle)) {
            this.skip(); // bundles not built in this checkout state
        }
        // Primary check: dev bundles carry module-path banners. The provider
        // chunk must contain tedious modules; the activation bundle NONE.
        // (The shared extension-metafile.json is overwritten by whichever
        // bundle step ran last, so bundle text is the reliable evidence.)
        const providerText = fs.readFileSync(providerBundle, "utf8");
        const extensionText = fs.readFileSync(extensionBundle, "utf8");
        const marker = "node_modules/tedious";
        if (providerText.includes(marker)) {
            expect(
                extensionText.includes(marker),
                "tedious leaked into the ACTIVATION bundle",
            ).to.equal(false);
        } else {
            // Prod-minified bundles strip banners: fall back to a runtime
            // literal tedious always embeds (its own package name in errors).
            expect(providerText.length).to.be.greaterThan(500_000, "provider carries tedious");
            expect(extensionText.includes("tedious")).to.equal(
                false,
                "tedious token in activation bundle",
            );
        }
    });
});

suite("ts-native lifecycle soak (TSQ2-14, N-I10)", () => {
    test("300 mixed cycles reach a bounded plateau (timers, sessions, slots)", async function () {
        this.timeout(60_000);
        const clock = new VirtualClock();
        const driver = new FakeTdsDriver(clock, {
            queries: [
                {
                    match: "WORK",
                    steps: [
                        { step: "metadata", columns: [{ name: "n", typeName: "int" }] },
                        { step: "rows", count: 25, make: (i) => [{ value: i }] },
                        { step: "done", token: "done", rowCount: 25, more: false },
                    ],
                },
                { match: "HANG", steps: [{ step: "hangUntilCancel" }] },
            ],
        });
        let n = 0;
        const backend = new TsNativeBackend({
            driver,
            clock,
            ids: { next: (p) => `${p}-${++n}` },
        });
        const sink = (): IQueryEventSink => ({
            onResultSetStarted: () => undefined,
            onRowsPage: () => undefined,
            onMessage: () => undefined,
            onComplete: () => undefined,
        });

        for (let cycle = 0; cycle < 300; cycle++) {
            const mode = cycle % 4;
            const opening = backend.openSession({
                profile: PROFILE,
                applicationName: "soak",
                auth: { passwordProvider: async () => "" },
            });
            await clock.flush();
            const session = await opening;
            if (mode === 0) {
                // normal completion
                const handle = session.execute("WORK", { pageRows: 10 }, sink());
                await clock.advance(100);
                expect((await handle.completion).status).to.equal("succeeded");
            } else if (mode === 1) {
                // user cancel mid-stream
                const handle = session.execute("WORK", { pageRows: 5 }, sink());
                await clock.advance(3);
                const cancelP = handle.cancel();
                await clock.advance(100);
                await cancelP;
                await handle.completion;
            } else if (mode === 2) {
                // dispose while hung
                const handle = session.execute("HANG", {}, sink());
                await clock.advance(2);
                const disposeP = handle.dispose();
                await clock.advance(100);
                await disposeP;
                expect((await handle.completion).status).to.equal("disposed");
            } else {
                // socket loss mid-stream
                const handle = session.execute("WORK", { pageRows: 5 }, sink());
                await clock.advance(2);
                driver.connections[driver.connections.length - 1].sever("network");
                await clock.advance(50);
                expect((await handle.completion).status).to.equal("connectionLost");
            }
            await session.close();
            await clock.advance(10);
        }

        // Plateau assertions: nothing accumulates across 300 cycles.
        const snapshot = backend.snapshot() as { sessions: unknown[] };
        expect(snapshot.sessions.length).to.equal(0, "all sessions finalized");
        // Virtual timers: cancel-hard/dispose/deadline timers must be
        // disposed or fired; a bounded handful of just-scheduled ticks from
        // the last cycle is tolerated, growth is not.
        expect(clock.pendingTimerCount()).to.be.lessThan(
            10,
            "virtual timers reclaimed (no per-cycle growth)",
        );
        // Fake connections: every one closed or lost — none left open.
        expect(driver.connections.filter((c) => c.state === "open").length).to.equal(
            0,
            "no leaked open connections",
        );
    });
});
