/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import {
    getContainerLifecycleCommand,
    inspectContainer,
    startContainer,
} from "../../src/docker/containerEngine";
import { ContainerEngine } from "../../src/sharedInterfaces/azureSqlDatabase";
import { AzureSqlContainer } from "../../src/constants/locConstants";

chai.use(sinonChai);

suite("Container engine lifecycle", () => {
    let sandbox: sinon.SinonSandbox;
    const name = "azure-sql-test";

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    const engines = [
        { engine: ContainerEngine.Docker, executable: "docker", prefix: [], remove: "rm" },
        { engine: ContainerEngine.Podman, executable: "podman", prefix: [], remove: "rm" },
        { engine: ContainerEngine.Containerd, executable: "nerdctl", prefix: [], remove: "rm" },
        {
            engine: ContainerEngine.AppleContainer,
            executable: "container",
            prefix: [],
            remove: "delete",
        },
        {
            engine: ContainerEngine.WslContainer,
            executable: "wslc",
            prefix: ["container"],
            remove: "rm",
        },
    ];

    for (const { engine, executable, prefix, remove } of engines) {
        test(`starts a stopped ${engine} container and waits for SQL readiness`, async () => {
            const execute = sandbox.stub().resolves({ stdout: "1", stderr: "" });
            execute
                .withArgs(
                    sinon.match({ args: [...prefix, "inspect", name] }),
                    sinon.match.number,
                    undefined,
                )
                .resolves({
                    stdout: JSON.stringify([
                        engine === ContainerEngine.AppleContainer
                            ? { status: "stopped" }
                            : { State: { Running: false } },
                    ]),
                    stderr: "",
                });

            await startContainer(engine, name, undefined, execute);

            expect(execute).to.have.been.calledWith(
                { executable, args: [...prefix, "start", name] },
                120_000,
                undefined,
            );
            expect(execute).to.have.been.calledWith(
                sinon.match({
                    executable,
                    args: sinon.match(
                        (args: string[]) =>
                            args[0] === "exec" &&
                            args[1] === name &&
                            args.at(-1)?.includes('SQLCMDPASSWORD="$MSSQL_SA_PASSWORD"') &&
                            args.at(-1)?.includes("SELECT 1"),
                    ),
                }),
                sinon.match.number,
                undefined,
            );
        });

        test(`routes ${engine} stop and delete commands to the owning engine`, () => {
            expect(getContainerLifecycleCommand(engine, "stop", name)).to.deep.equal({
                executable,
                args: [...prefix, "stop", name],
            });
            expect(getContainerLifecycleCommand(engine, "delete", name)).to.deep.equal({
                executable,
                args: [...prefix, remove, "--force", name],
            });
        });
    }

    test("does not restart or probe SQL in an already running container", async () => {
        const execute = sandbox.stub().resolves({
            stdout: JSON.stringify([{ State: { Running: true } }]),
            stderr: "",
        });

        await startContainer(ContainerEngine.Podman, name, undefined, execute);

        expect(execute).not.to.have.been.calledWith(sinon.match({ args: ["start", name] }));
        expect(execute).not.to.have.been.calledWith(
            sinon.match({ args: sinon.match((args: string[]) => args[0] === "exec") }),
        );
    });

    test("rejects unexpected inspect output rather than treating it as stopped", async () => {
        const execute = sandbox.stub().resolves({ stdout: '[{"Config": {}}]', stderr: "" });
        let error: unknown;
        try {
            await inspectContainer(ContainerEngine.Podman, name, undefined, execute);
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal(
            AzureSqlContainer.invalidContainerState("podman"),
        );
    });

    test("does not try another engine when the owning engine fails", async () => {
        const failure = new Error("Podman is not available");
        const execute = sandbox.stub().rejects(failure);
        let error: unknown;
        try {
            await startContainer(ContainerEngine.Podman, name, undefined, execute);
        } catch (caught) {
            error = caught;
        }
        expect(error).to.equal(failure);
        expect(execute).not.to.have.been.calledWith(sinon.match({ executable: "docker" }));
    });

    test("honors cancellation during SQL readiness checks", async () => {
        const abortController = new AbortController();
        const execute = sandbox.stub();
        execute.withArgs(sinon.match({ args: ["inspect", name] })).resolves({
            stdout: JSON.stringify([{ State: { Running: false } }]),
            stderr: "",
        });
        execute.withArgs(sinon.match({ args: ["start", name] })).resolves({
            stdout: "",
            stderr: "",
        });
        execute
            .withArgs(sinon.match({ args: sinon.match((args: string[]) => args[0] === "exec") }))
            .callsFake(async () => {
                abortController.abort();
                throw new Error("SQL is still starting");
            });

        let error: unknown;
        try {
            await startContainer(ContainerEngine.Podman, name, abortController.signal, execute);
        } catch (caught) {
            error = caught;
        }
        expect(error).to.equal(abortController.signal.reason);
    });

    test("waits for SQL readiness after a transient failure", async () => {
        const clock = sandbox.useFakeTimers();
        const execute = sandbox.stub().resolves({ stdout: "", stderr: "" });
        execute.withArgs(sinon.match({ args: ["inspect", name] })).resolves({
            stdout: JSON.stringify([{ State: { Running: false } }]),
            stderr: "",
        });
        const query = execute.withArgs(
            sinon.match({ args: sinon.match((args: string[]) => args[0] === "exec") }),
        );
        query.onFirstCall().rejects(new Error("SQL is still starting"));
        query.onSecondCall().resolves({ stdout: "1", stderr: "" });
        let ready = false;
        const pending = startContainer(ContainerEngine.Podman, name, undefined, execute).then(
            () => {
                ready = true;
            },
        );

        await clock.tickAsync(0);
        expect(ready).to.be.false;
        await clock.tickAsync(2_000);
        await pending;

        expect(ready).to.be.true;
        expect(clock.countTimers()).to.equal(0);
    });

    test("reports readiness timeout rather than a successful container start", async () => {
        const clock = sandbox.useFakeTimers();
        const execute = sandbox.stub().resolves({ stdout: "", stderr: "" });
        execute.withArgs(sinon.match({ args: ["inspect", name] })).resolves({
            stdout: JSON.stringify([{ State: { Running: false } }]),
            stderr: "",
        });
        const failure = new Error("SQL is still starting");
        execute
            .withArgs(sinon.match({ args: sinon.match((args: string[]) => args[0] === "exec") }))
            .rejects(failure);
        const pending = startContainer(ContainerEngine.Podman, name, undefined, execute).then(
            () => undefined,
            (error: unknown) => error,
        );

        await clock.tickAsync(300_000);
        const error = await pending;

        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal(AzureSqlContainer.containerNotReady);
        expect((error as Error).cause).to.equal(failure);
        expect(clock.countTimers()).to.equal(0);
    });
});
