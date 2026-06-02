/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the Cloud Deploy `ProcessProvider` surface:
 *   * `FakeProcessProvider` records invocations + replays canned responses
 *     keyed on (command, args[0]); unmatched calls fall through to exit 0;
 *     `respond("hang")` waits for the abort signal; pre-aborted signal
 *     short-circuits to a cancelled result.
 *   * `LiveProcessProvider` spawns a real subprocess, captures stdout +
 *     stderr, returns a numeric exit code, and forwards `AbortSignal` aborts
 *     into a SIGTERM-then-SIGKILL kill chain. (One smoke test using `node`,
 *     guarded by environment availability.)
 */

import { expect } from "chai";

import {
    FakeProcessProvider,
    LiveProcessProvider,
    type ProcessProvider,
} from "../../src/cloudDeploy/validation";

suite("CloudDeploy ProcessProvider", () => {
    // -------------------------------------------------------------------------
    // FakeProcessProvider
    // -------------------------------------------------------------------------
    suite("FakeProcessProvider", () => {
        test("spawn() records invocations and defaults to exit 0", async () => {
            const provider = new FakeProcessProvider();
            const ctrl = new AbortController();

            const result = await provider.spawn(
                "sqlpackage",
                ["/Action:DeployReport", "/SourceFile:foo.sqlproj"],
                { signal: ctrl.signal, cwd: "/tmp" },
            );

            expect(result.exitCode).to.equal(0);
            expect(result.stdout).to.equal("");
            expect(result.stderr).to.equal("");
            expect(result.aborted).to.equal(false);
            expect(provider.invocations).to.have.length(1);
            expect(provider.invocations[0]).to.deep.equal({
                command: "sqlpackage",
                args: ["/Action:DeployReport", "/SourceFile:foo.sqlproj"],
                cwd: "/tmp",
                env: undefined,
                stdin: undefined,
            });
        });

        test("respond() replays canned exit response keyed on (command, firstArg)", async () => {
            const provider = new FakeProcessProvider();
            provider.respond("sqlpackage", "/Action:DeployReport", {
                mode: "exit",
                exitCode: 1,
                stdout: "deploy report begin",
                stderr: "Warning SQL71558: oops",
            });

            const result = await provider.spawn("sqlpackage", ["/Action:DeployReport"], {
                signal: new AbortController().signal,
            });

            expect(result.exitCode).to.equal(1);
            expect(result.stdout).to.equal("deploy report begin");
            expect(result.stderr).to.equal("Warning SQL71558: oops");
        });

        test("respond() with mode 'throw' rejects the spawn promise", async () => {
            const provider = new FakeProcessProvider();
            provider.respond("sqlpackage", "/Action:DeployReport", {
                mode: "throw",
                error: new Error("ENOENT"),
            });

            try {
                await provider.spawn("sqlpackage", ["/Action:DeployReport"], {
                    signal: new AbortController().signal,
                });
                expect.fail("expected ENOENT");
            } catch (err) {
                expect((err as Error).message).to.equal("ENOENT");
            }
        });

        test("pre-aborted signal short-circuits to cancelled result", async () => {
            const provider = new FakeProcessProvider();
            const ctrl = new AbortController();
            ctrl.abort();

            const result = await provider.spawn("sqlpackage", ["/Action:DeployReport"], {
                signal: ctrl.signal,
            });

            expect(result.aborted).to.equal(true);
            expect(result.exitCode).to.equal(null);
            expect(result.signal).to.equal("SIGTERM");
        });

        test("respond('hang') resolves with cancelled result when signal aborts", async () => {
            const provider = new FakeProcessProvider();
            provider.respond("sqlpackage", "/Action:DeployReport", { mode: "hang" });
            const ctrl = new AbortController();

            const promise = provider.spawn("sqlpackage", ["/Action:DeployReport"], {
                signal: ctrl.signal,
            });
            setTimeout(() => ctrl.abort(), 5);

            const result = await promise;
            expect(result.aborted).to.equal(true);
            expect(result.exitCode).to.equal(null);
        });

        test("multiple respond() entries are dispatched independently", async () => {
            const provider = new FakeProcessProvider();
            provider.respond("sqlpackage", "/Action:DeployReport", {
                mode: "exit",
                exitCode: 0,
                stdout: "report",
            });
            provider.respond("sqlpackage", "/Action:Publish", {
                mode: "exit",
                exitCode: 2,
                stderr: "publish failed",
            });

            const reportResult = await provider.spawn("sqlpackage", ["/Action:DeployReport"], {
                signal: new AbortController().signal,
            });
            const publishResult = await provider.spawn("sqlpackage", ["/Action:Publish"], {
                signal: new AbortController().signal,
            });

            expect(reportResult.stdout).to.equal("report");
            expect(reportResult.exitCode).to.equal(0);
            expect(publishResult.stderr).to.equal("publish failed");
            expect(publishResult.exitCode).to.equal(2);
        });

        test("FakeProcessProvider implements the ProcessProvider interface structurally", () => {
            const provider: ProcessProvider = new FakeProcessProvider();
            expect(typeof provider.spawn).to.equal("function");
        });
    });

    // -------------------------------------------------------------------------
    // LiveProcessProvider (smoke test)
    // -------------------------------------------------------------------------
    suite("LiveProcessProvider", () => {
        test("spawn() captures stdout and exits with code 0 for a node one-liner", async () => {
            const provider = new LiveProcessProvider();
            const result = await provider.spawn(
                process.execPath,
                ["-e", "process.stdout.write('hello')"],
                { signal: new AbortController().signal },
            );

            expect(result.exitCode).to.equal(0);
            expect(result.stdout).to.equal("hello");
            expect(result.aborted).to.equal(false);
        });

        test("spawn() captures stderr and surfaces non-zero exit codes", async () => {
            const provider = new LiveProcessProvider();
            const result = await provider.spawn(
                process.execPath,
                ["-e", "process.stderr.write('boom'); process.exit(7)"],
                { signal: new AbortController().signal },
            );

            expect(result.exitCode).to.equal(7);
            expect(result.stderr).to.equal("boom");
        });

        test("spawn() forwards abort signal as kill and reports aborted=true", async () => {
            const provider = new LiveProcessProvider();
            const ctrl = new AbortController();
            const promise = provider.spawn(
                process.execPath,
                ["-e", "setInterval(() => {}, 1000)"],
                { signal: ctrl.signal },
            );
            setTimeout(() => ctrl.abort(), 30);

            const result = await promise;
            expect(result.aborted).to.equal(true);
            // Killed by signal: exitCode is null and signal is populated.
            // (Windows reports SIGTERM as well via ChildProcess.signalCode.)
            expect(result.exitCode === null || result.exitCode !== 0).to.equal(true);
        });

        test("spawn() rejects when the binary does not exist", async () => {
            const provider = new LiveProcessProvider();
            try {
                await provider.spawn("this-binary-definitely-does-not-exist-cd-d2-c3", [], {
                    signal: new AbortController().signal,
                });
                expect.fail("expected spawn to fail");
            } catch (err) {
                expect(err).to.be.instanceOf(Error);
                // Node sets `code` on the error; commonly "ENOENT". We assert
                // loosely so platform variance doesn't flake the suite.
                expect(String((err as NodeJS.ErrnoException).code ?? "")).to.match(
                    /ENOENT|EACCES|UNKNOWN/,
                );
            }
        });
    });
});
