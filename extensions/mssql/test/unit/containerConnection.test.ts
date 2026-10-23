/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createConnection, Socket } from "node:net";
import { ContainerConnections, containerConnections } from "../../src/docker/containerConnection";
import { ContainerEngineCommand } from "../../src/docker/containerEngine";
import { ContainerEngine } from "../../src/sharedInterfaces/azureSqlDatabase";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { buildAuthBundle, prepareConnection } from "../../src/services/metadata/profileAuthAdapter";

suite("Container connection transport", function () {
    this.timeout(10_000);
    let sandbox: sinon.SinonSandbox;
    let connections: ContainerConnections;
    let execute: sinon.SinonStub;
    let relay: sinon.SinonStub;
    let sockets: Socket[];
    let children: ChildProcessWithoutNullStreams[];
    const name = "azure-sql-test";

    setup(() => {
        sandbox = sinon.createSandbox();
        sockets = [];
        children = [];
        execute = sandbox.stub().resolves({ stdout: "", stderr: "" });
        relay = sandbox.stub().callsFake((_command: ContainerEngineCommand) => {
            const child = spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
                env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
                stdio: "pipe",
            });
            children.push(child);
            return child;
        });
        connections = new ContainerConnections(execute, relay);
    });

    teardown(async () => {
        const closed = children
            .filter((child) => child.exitCode === null && child.signalCode === null)
            .map((child) => once(child, "close"));
        for (const socket of sockets) {
            socket.destroy();
        }
        connections.dispose();
        await Promise.all(closed);
        sandbox.restore();
    });

    async function exchange(endpoint: string, data: Buffer): Promise<Buffer> {
        const [host, port] = endpoint.split(",");
        const socket = createConnection({ host, port: Number(port) });
        sockets.push(socket);
        await once(socket, "connect");
        const received = new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            let length = 0;
            socket.on("error", reject);
            socket.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
                length += chunk.length;
                if (length === data.length) {
                    resolve(Buffer.concat(chunks));
                }
            });
            socket.on("close", () => {
                if (length < data.length) {
                    reject(new Error("Relay closed before delivering the payload"));
                }
            });
        });
        socket.write(data);
        return received;
    }

    for (const engine of [ContainerEngine.Podman, ContainerEngine.WslContainer]) {
        test(`routes binary traffic through ${engine}, not the published localhost port`, async () => {
            const target = { containerEngine: engine, containerName: name };
            const endpoint = await connections.prepare(target);
            const payload = randomBytes(128 * 1024);
            expect(await exchange(endpoint, payload)).to.deep.equal(payload);

            expect(
                relay.calledWithMatch({
                    executable: engine === ContainerEngine.Podman ? "podman" : "wslc",
                    args: ["exec", "-i", name, "/bin/bash", "-c", sinon.match.string],
                }),
            ).to.be.true;
            expect(connections.getServer(target)).to.equal(endpoint);
        });
    }

    test("keeps same-named Podman and WSL targets separate and supports concurrent SQL sockets", async () => {
        const podman = { containerEngine: ContainerEngine.Podman, containerName: name };
        const wsl = { ...podman, containerEngine: ContainerEngine.WslContainer };
        const [first, duplicate, other] = await Promise.all([
            connections.prepare(podman),
            connections.prepare(podman),
            connections.prepare(wsl),
        ]);
        expect(first).to.equal(duplicate);
        expect(first).not.to.equal(other);
        const payloads = [randomBytes(1024), randomBytes(2048), randomBytes(4096)];
        expect(
            await Promise.all([
                exchange(first, payloads[0]),
                exchange(first, payloads[1]),
                exchange(other, payloads[2]),
            ]),
        ).to.deep.equal(payloads);
    });

    test("opens a fresh engine stream when reconnecting without changing the saved endpoint", async () => {
        const target = { containerEngine: ContainerEngine.Podman, containerName: name };
        const endpoint = await connections.prepare(target);
        await exchange(endpoint, Buffer.from("first"));
        const closed = once(children[0], "close");
        sockets[0].destroy();
        await closed;

        expect(await connections.prepare(target)).to.equal(endpoint);
        expect(await exchange(endpoint, Buffer.from("second"))).to.deep.equal(
            Buffer.from("second"),
        );
        expect(children[0].exitCode !== null || children[0].signalCode !== null).to.be.true;
    });

    test("does not retarget an existing relay when its source profile is edited", async () => {
        const target = { containerEngine: ContainerEngine.Podman, containerName: name };
        const endpoint = await connections.prepare(target);
        target.containerName = "a-different-container";
        await exchange(endpoint, Buffer.from("query"));
        expect(
            relay.calledWithMatch({
                executable: "podman",
                args: ["exec", "-i", name, "/bin/bash", "-c", sinon.match.string],
            }),
        ).to.be.true;
    });

    test("preserves Docker and profiles without explicit VM-engine metadata", async () => {
        for (const target of [
            { containerEngine: ContainerEngine.Docker, containerName: name },
            { containerName: name },
            { containerEngine: ContainerEngine.Podman },
        ]) {
            expect(await connections.prepare(target)).to.be.undefined;
            expect(connections.getServer(target)).to.be.undefined;
        }
        expect(execute.called).to.be.false;
        expect(relay.called).to.be.false;
    });

    test("reports engine startup failures and permits retry instead of caching a failed endpoint", async () => {
        const target = { containerEngine: ContainerEngine.Podman, containerName: name };
        execute.onFirstCall().rejects(new Error("Podman connection refused"));
        const error = await connections.prepare(target).then(
            () => undefined,
            (caught: unknown) => caught,
        );
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include("Podman connection refused");
        expect(connections.getServer(target)).to.be.undefined;
        expect(await connections.prepare(target)).to.match(/^127\.0\.0\.1,\d+$/);
    });

    test("cancels pending engine preparation on disposal and does not retain an endpoint", async () => {
        execute.callsFake(
            (_command: ContainerEngineCommand, _timeout: number, signal: AbortSignal) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                }),
        );
        const target = { containerEngine: ContainerEngine.Podman, containerName: name };
        const pending = connections.prepare(target).then(
            () => undefined,
            (caught: unknown) => caught,
        );
        connections.dispose();
        expect(await pending).to.be.instanceOf(Error);
        expect(connections.getServer(target)).to.be.undefined;
        expect(relay.called).to.be.false;
    });

    test("rejects invalid container identifiers before executing engine commands", async () => {
        const error = await connections
            .prepare({ containerEngine: ContainerEngine.Podman, containerName: "--privileged" })
            .then(
                () => undefined,
                (caught: unknown) => caught,
            );
        expect(error).to.be.instanceOf(Error);
        expect(execute.called).to.be.false;
    });

    test("never falls through to an unrelated localhost listener if the container transport is not prepared", () => {
        const profile: ConnectionProfile = Object.assign(new ConnectionProfile(), {
            server: "localhost,1442",
            containerName: name,
            containerEngine: ContainerEngine.Podman,
        });
        sandbox.stub(containerConnections, "getServer").returns(undefined);
        expect(() => ConnectionCredentials.createConnectionDetails(profile, true)).to.throw();
        expect(ConnectionCredentials.createConnectionDetails(profile).options.server).to.equal(
            "localhost,1442",
        );
    });

    test("closes SQL sockets when the relay cannot start, without an unhandled stream error", async () => {
        relay.callsFake(() => {
            const child = spawn("mssql-nonexistent-container-engine", [], { stdio: "pipe" });
            children.push(child);
            return child;
        });
        const endpoint = await connections.prepare({
            containerEngine: ContainerEngine.Podman,
            containerName: name,
        });
        const error = await exchange(endpoint, Buffer.from("query")).then(
            () => undefined,
            (caught: unknown) => caught,
        );
        expect(error).to.be.instanceOf(Error);
    });

    test("disposes the listener and active engine processes and can prepare again after reload", async () => {
        const target = { containerEngine: ContainerEngine.Podman, containerName: name };
        const endpoint = await connections.prepare(target);
        await exchange(endpoint, Buffer.from("query"));
        const childClosed = once(children[0], "close");
        const socketClosed = once(sockets[0], "close");
        connections.dispose();
        await Promise.all([childClosed, socketClosed]);
        expect(connections.getServer(target)).to.be.undefined;
        expect(await connections.prepare(target)).to.match(/^127\.0\.0\.1,\d+$/);
    });

    test("keeps saved profile identity separate from runtime connection details and data-plane transport", async () => {
        const target: ConnectionProfile = Object.assign(new ConnectionProfile(), {
            id: "saved-id",
            server: "localhost,1442",
            port: 1442,
            containerEngine: ContainerEngine.Podman,
            containerName: name,
            authenticationType: "SqlLogin",
        });
        sandbox.stub(containerConnections, "getServer").returns("127.0.0.1,54321");
        sandbox.stub(containerConnections, "prepare").resolves("127.0.0.1,54321");
        const secrets = { lookupPassword: sandbox.stub().resolves("test-password") };
        const prepared = prepareConnection(target, secrets);

        expect(ConnectionCredentials.createConnectionDetails(target).options.server).to.equal(
            "localhost,1442",
        );
        expect(ConnectionCredentials.createConnectionDetails(target, true).options.server).to.equal(
            "127.0.0.1,54321",
        );
        expect(await prepared.auth.serverProvider()).to.equal("127.0.0.1,54321");
        expect(secrets.lookupPassword.called).to.be.false;
        expect(prepared.profileRef.server).to.equal("localhost,1442");
        expect(target.id).to.equal("saved-id");
        expect(target.server).to.equal("localhost,1442");
        expect(target.port).to.equal(1442);
        expect(buildAuthBundle({ server: "remote" }, secrets).serverProvider).to.be.undefined;
        const otherEngine = prepareConnection(
            { ...target, containerEngine: ContainerEngine.WslContainer },
            secrets,
        );
        expect(otherEngine.profileRef.profileFingerprint).not.to.equal(
            prepared.profileRef.profileFingerprint,
        );
        expect(otherEngine.serverFingerprint).not.to.equal(prepared.serverFingerprint);
    });
});
