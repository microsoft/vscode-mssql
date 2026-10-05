/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { ChildProcess, spawn } from "child_process";
import {
    getPortListenerPids,
    isDabHealthBody,
    isProcessAlive,
    parseNetstatListeners,
    parsePidList,
    parseSsListeners,
    stopDabCliEngine,
} from "../../../src/dab/dabCliProcess";

suite("DAB CLI process", () => {
    suite("port listener parsing", () => {
        test("reads the pids lsof prints one per line", () => {
            expect(parsePidList("4242\n4243\n\n")).to.deep.equal([4242, 4243]);
        });

        test("ignores lsof output that names no pid", () => {
            expect(parsePidList("")).to.deep.equal([]);
            expect(parsePidList("no output\n")).to.deep.equal([]);
        });

        test("reads the listening pid for the port out of netstat", () => {
            const output = [
                "Active Connections",
                "  Proto  Local Address          Foreign Address        State           PID",
                "  TCP    0.0.0.0:5001           0.0.0.0:0              LISTENING       4242",
                "  TCP    0.0.0.0:5002           0.0.0.0:0              LISTENING       777",
            ].join("\r\n");

            expect(parseNetstatListeners(output, 5001)).to.deep.equal([4242]);
        });

        test("does not mistake an established connection for a listener", () => {
            const output =
                "  TCP    127.0.0.1:5001         127.0.0.1:53211        ESTABLISHED     999";

            expect(
                parseNetstatListeners(output, 5001),
                "Only a listening socket says who owns the port",
            ).to.deep.equal([]);
        });

        test("takes the port from the end of an IPv6 local address", () => {
            const output = "  TCP    [::]:5001              [::]:0                 LISTENING  4242";

            expect(parseNetstatListeners(output, 5001)).to.deep.equal([4242]);
        });

        test("reads the pid out of an ss process column", () => {
            const output = [
                "State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process",
                'LISTEN 0      511          0.0.0.0:5001      0.0.0.0:*    users:(("dotnet",pid=4242,fd=200))',
                'LISTEN 0      511          0.0.0.0:5002      0.0.0.0:*    users:(("other",pid=777,fd=12))',
            ].join("\n");

            expect(parseSsListeners(output, 5001)).to.deep.equal([4242]);
        });

        test("ignores ss rows for other ports", () => {
            const output = 'LISTEN 0 511 0.0.0.0:5002 0.0.0.0:* users:(("dotnet",pid=4242,fd=200))';

            expect(parseSsListeners(output, 5001)).to.deep.equal([]);
        });
    });

    suite("DAB health responses", () => {
        test("recognises the plain health response the root path returns", () => {
            expect(isDabHealthBody("Healthy")).to.be.true;
            expect(isDabHealthBody("  healthy\n")).to.be.true;
            expect(isDabHealthBody('"Healthy"')).to.be.true;
        });

        test("recognises the JSON health report", () => {
            expect(
                isDabHealthBody(
                    '{"status":"Healthy","version":"2.1.3","app-name":"dab_oss_2.1.3"}',
                ),
            ).to.be.true;
        });

        test("does not take an unrelated service for DAB", () => {
            expect(isDabHealthBody("<html><body>It works!</body></html>")).to.be.false;
            expect(isDabHealthBody('{"message":"Not Found"}')).to.be.false;
            expect(isDabHealthBody(""), "An empty body identifies nothing").to.be.false;
        });
    });

    suite("liveness", () => {
        test("reports the running test process as alive", () => {
            expect(isProcessAlive(process.pid)).to.be.true;
        });

        test("reports a pid that names nothing as not alive", () => {
            // Above any pid the kernel hands out, so nothing can be there.
            expect(isProcessAlive(0x7ffffff0)).to.be.false;
        });
    });

    suite("stopDabCliEngine", () => {
        let child: ChildProcess | undefined;

        teardown(() => {
            if (child?.pid && !child.killed) {
                child.kill("SIGKILL");
            }
            child = undefined;
        });

        test("leaves a process alone when it does not hold the deployment's port", async () => {
            // The scenario a recorded pid invites: the engine exited long ago
            // and its number now belongs to something that is none of our
            // business. Killing it is the bug this guard exists to prevent.
            child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
                windowsHide: true,
            });
            await new Promise((resolve) => child!.once("spawn", resolve));

            const unusedPort = 59_123;
            if ((await getPortListenerPids(unusedPort)) === undefined) {
                // No way to establish ownership on this machine, so the guard
                // cannot be exercised here.
                return;
            }

            const result = await stopDabCliEngine(child.pid!, unusedPort);

            expect(result.success, "Nothing of ours was running, which is the desired state").to.be
                .true;
            expect(
                isProcessAlive(child.pid!),
                "A pid that does not hold the port belongs to something else",
            ).to.be.true;
        });

        test("succeeds without signalling when the recorded process is gone", async () => {
            child = spawn(process.execPath, ["-e", ""], { windowsHide: true });
            const exitedPid = await new Promise<number>((resolve) => {
                const pid = child!.pid!;
                child!.once("close", () => resolve(pid));
            });

            const result = await stopDabCliEngine(exitedPid, 59_124);

            expect(result.success).to.be.true;
        });
    });
});
