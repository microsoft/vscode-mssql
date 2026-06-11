/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `EphemeralDatabaseProvider` (Scope 2, decision D-C):
 *   * `FakeEphemeralDatabaseProvider` records provisions, returns a handle, and
 *     disposes; `failWith` makes `provision()` reject.
 *   * `DockerEphemeralDatabaseProvider` happy path drives docker run → dotnet
 *     build → sqlpackage publish → connect, returns the right database name, and
 *     `dispose()` force-removes the container.
 *   * a `Dacpac` source skips the `dotnet build` step.
 *   * a non-`docker` runtime host is rejected.
 *   * a readiness timeout throws and the partially-started container is removed.
 */

import { expect } from "chai";

import { SourceOfTruthKind } from "../../src/cloudDeploy/environments/types";
import {
    DockerEphemeralDatabaseProvider,
    EphemeralConnectionParams,
    EphemeralConnector,
    EphemeralProvisionError,
    FakeEphemeralDatabaseProvider,
} from "../../src/cloudDeploy/validation/providers/ephemeralDatabaseProvider";
import { ConnectionHandle } from "../../src/cloudDeploy/validation/providers/connectionProvider";
import { FakeProcessProvider } from "../../src/cloudDeploy/validation/providers/processProvider";

class RecordingConnectionHandle implements ConnectionHandle {
    public disposed = false;
    public async execute(): Promise<unknown[][]> {
        return [[1]];
    }
    public async dispose(): Promise<void> {
        this.disposed = true;
    }
}

class FakeConnector implements EphemeralConnector {
    public lastParams?: EphemeralConnectionParams;
    public constructor(private readonly _handle: ConnectionHandle) {}
    public async connect(
        params: EphemeralConnectionParams,
        _signal: AbortSignal,
    ): Promise<ConnectionHandle> {
        this.lastParams = params;
        return this._handle;
    }
}

const SQLPROJ = {
    kind: SourceOfTruthKind.SqlProj as const,
    path: "db/MyProject/MyProject.sqlproj",
};

function newSignal(): AbortSignal {
    return new AbortController().signal;
}

suite("CloudDeploy EphemeralDatabaseProvider", () => {
    suite("FakeEphemeralDatabaseProvider", () => {
        test("records the provision call and returns the configured connection", async () => {
            const handle = new RecordingConnectionHandle();
            const provider = new FakeEphemeralDatabaseProvider(handle);

            const db = await provider.provision(SQLPROJ, { kind: "docker" }, newSignal());

            expect(provider.invocations).to.have.lengthOf(1);
            expect(provider.invocations[0].sourceOfTruthKind).to.equal(SourceOfTruthKind.SqlProj);
            expect(provider.invocations[0].hostKind).to.equal("docker");
            expect(db.connection).to.equal(handle);
        });

        test("dispose() disposes the underlying connection", async () => {
            const handle = new RecordingConnectionHandle();
            const provider = new FakeEphemeralDatabaseProvider(handle);

            const db = await provider.provision(SQLPROJ, { kind: "docker" }, newSignal());
            await db.dispose();

            expect(handle.disposed).to.equal(true);
        });

        test("failWith makes provision() reject", async () => {
            const provider = new FakeEphemeralDatabaseProvider();
            provider.failWith = new Error("boom");

            let caught: unknown;
            try {
                await provider.provision(SQLPROJ, { kind: "docker" }, newSignal());
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(Error);
        });
    });

    suite("DockerEphemeralDatabaseProvider", () => {
        test("happy path: runs docker, builds, publishes, connects, returns db name", async () => {
            const processes = new FakeProcessProvider();
            const handle = new RecordingConnectionHandle();
            const connector = new FakeConnector(handle);
            const provider = new DockerEphemeralDatabaseProvider(processes, connector);

            const db = await provider.provision(SQLPROJ, { kind: "docker" }, newSignal());

            const commands = processes.invocations.map((i) => `${i.command} ${i.args[0] ?? ""}`);
            expect(commands).to.include("docker run");
            expect(commands).to.include("dotnet build");
            expect(commands).to.include("sqlpackage /Action:Publish");
            expect(db.databaseName).to.equal("CloudDeployValidation");
            expect(db.connection).to.equal(handle);
            expect(connector.lastParams?.user).to.equal("sa");
            expect(connector.lastParams?.database).to.equal("CloudDeployValidation");
        });

        test("dispose() force-removes the container", async () => {
            const processes = new FakeProcessProvider();
            const provider = new DockerEphemeralDatabaseProvider(
                processes,
                new FakeConnector(new RecordingConnectionHandle()),
            );

            const db = await provider.provision(SQLPROJ, { kind: "docker" }, newSignal());
            await db.dispose();

            const removed = processes.invocations.some(
                (i) => i.command === "docker" && i.args[0] === "rm" && i.args.includes("-f"),
            );
            expect(removed).to.equal(true);
        });

        test("a Dacpac source skips the dotnet build step", async () => {
            const processes = new FakeProcessProvider();
            const provider = new DockerEphemeralDatabaseProvider(
                processes,
                new FakeConnector(new RecordingConnectionHandle()),
            );

            await provider.provision(
                { kind: SourceOfTruthKind.Dacpac, path: "db/out/MyProject.dacpac" },
                { kind: "docker" },
                newSignal(),
            );

            const builtWithDotnet = processes.invocations.some((i) => i.command === "dotnet");
            expect(builtWithDotnet).to.equal(false);
        });

        test("rejects a non-docker runtime host", async () => {
            const provider = new DockerEphemeralDatabaseProvider(
                new FakeProcessProvider(),
                new FakeConnector(new RecordingConnectionHandle()),
            );

            let caught: unknown;
            try {
                await provider.provision(
                    SQLPROJ,
                    { kind: "connection", connectionProfileId: "local" },
                    newSignal(),
                );
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(EphemeralProvisionError);
        });

        test("a readiness timeout throws and removes the started container", async () => {
            const processes = new FakeProcessProvider();
            // Container starts, but every in-container probe fails -> readiness times out.
            processes.respond("docker", "exec", { mode: "exit", exitCode: 1, stderr: "not ready" });
            const provider = new DockerEphemeralDatabaseProvider(
                processes,
                new FakeConnector(new RecordingConnectionHandle()),
                { readinessTimeoutMs: 0, readinessIntervalMs: 0 },
            );

            let caught: unknown;
            try {
                await provider.provision(SQLPROJ, { kind: "docker" }, newSignal());
            } catch (err) {
                caught = err;
            }

            expect(caught).to.be.instanceOf(EphemeralProvisionError);
            const removed = processes.invocations.some(
                (i) => i.command === "docker" && i.args[0] === "rm",
            );
            expect(removed).to.equal(true);
        });
    });
});
