/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { Common, LocalContainers, ObjectExplorerV2 } from "../../src/constants/locConstants";
import * as docker from "../../src/docker/dockerUtils";
import { ContainerHostAdapter } from "../../src/docker/containerHostAdapter";
import {
    activateObjectExplorerV2,
    OeV2ActivationDeps,
} from "../../src/objectExplorer/v2/activation";
import { OeV2ClassicHandoffService } from "../../src/objectExplorer/v2/legacy/oeV2ClassicHandoffService";
import { OeV2MetadataCoordinator } from "../../src/objectExplorer/v2/metadata/oeV2MetadataCoordinator";
import { OeV2SessionRegistry } from "../../src/objectExplorer/v2/sessions/oeV2SessionRegistry";
import { OeV2TreeController } from "../../src/objectExplorer/v2/tree/oeV2TreeController";
import { ISqlSession, SessionStateChange } from "../../src/services/sqlDataPlane/api";
import { PreparedConnection } from "../../src/services/metadata/profileAuthAdapter";
import { ObjectExplorerV2Provider } from "../../src/objectExplorer/v2/objectExplorerV2Provider";

suite("Object Explorer v2 container startup", () => {
    let sandbox: sinon.SinonSandbox;
    const disposables: Array<{ dispose(): void }> = [];

    setup(() => {
        sandbox = sinon.createSandbox();
    });
    teardown(() => {
        for (const disposable of disposables.splice(0)) disposable.dispose();
        sandbox.restore();
    });

    function harness(containerName: string | undefined = "test-container") {
        const stateChanges = new vscode.EventEmitter<SessionStateChange>();
        const session = {
            info: { sessionId: "container-session", serverVersion: "17.0" },
            close: sandbox.stub().resolves(),
            onDidChangeState: stateChanges.event,
        } as unknown as ISqlSession;
        const open = sandbox.stub().resolves({ session });
        const registry = new OeV2SessionRegistry(open);
        const restart = sandbox
            .stub<[string, string, AbortSignal], Promise<boolean | undefined>>()
            .resolves(true);
        const coordinator = sandbox.createStubInstance(OeV2MetadataCoordinator);
        coordinator.onDidChange.returns({ dispose: () => undefined });
        coordinator.ensureServer.resolves();
        const profiles = {
            readAllConnections: sandbox.stub().resolves([
                {
                    id: "p1",
                    server: "localhost,14330",
                    authenticationType: "Integrated",
                    containerName,
                },
            ]),
            readAllConnectionGroups: async () => [],
        };
        const coordinatorFactory = sandbox.stub().returns(coordinator);
        const controller = new OeV2TreeController({
            profiles,
            dataPlane: { enabled: () => true, availabilityState: () => "available" },
            secrets: { lookupPassword: async () => undefined },
            sessions: registry,
            coordinatorFactory,
            containers: { restart },
            waits: {
                containerPreflightMs: 100,
                containerOpenRetryBackoffMs: 10,
                containerOpenRetryBudgetMs: 40,
                containerLoginRetryGraceMs: 15,
            },
        });
        disposables.push(controller, registry, stateChanges);
        return {
            controller,
            registry,
            restart,
            open,
            coordinator,
            coordinatorFactory,
            profiles,
            session,
            stateChanges,
        };
    }

    test("starts a stopped container before opening SQL and shares concurrent startup requests", async () => {
        const h = harness();
        const entered = Promise.withResolvers<void>();
        const ready = Promise.withResolvers<boolean>();
        h.restart.callsFake(() => {
            entered.resolve();
            return ready.promise;
        });
        const first = h.controller.connectProfile("p1");
        await entered.promise;
        const second = h.controller.connectProfile("p1");
        expect(h.open).not.to.have.been.called;
        ready.resolve(true);
        expect(await Promise.all([first, second])).to.deep.equal([true, true]);
        expect(h.restart).to.have.been.calledOnce;
        expect(h.open).to.have.been.calledOnce;
        expect(h.registry.stateOf("p1")).to.equal("connected");
        expect(h.coordinator.ensureServer).to.have.been.calledOnce;
    });

    test("ordinary saved profiles do not call Docker", async () => {
        const h = harness("");
        expect(await h.controller.connectProfile("p1")).to.equal(true);
        expect(h.restart).not.to.have.been.called;
    });

    test("canceling while a lost session retires prevents a replacement SQL open", async () => {
        const h = harness();
        expect(await h.controller.connectProfile("p1")).to.equal(true);
        h.stateChanges.fire({ previous: "open", current: "lost", reason: "network" });
        const entered = Promise.withResolvers<void>();
        const retired = Promise.withResolvers<void>();
        (h.session.close as sinon.SinonStub).callsFake(() => {
            entered.resolve();
            return retired.promise;
        });
        const reconnect = h.controller.connectProfile("p1");
        await entered.promise;
        expect(h.registry.stateOf("p1")).to.equal("lost");
        h.controller.cancelConnect("p1");
        retired.resolve();
        expect(await reconnect).to.equal(false);
        expect(h.open).to.have.been.calledOnce;
        expect(h.registry.stateOf("p1")).to.equal("disconnected");
    });

    test("container activity appears on the connection and clears when finished", async () => {
        const h = harness();
        h.controller.setContainerActivity("p1", "Starting test container");
        const findNode = async () =>
            (await h.controller.children()).find((node) => node.connectionId === "p1");
        expect((await findNode())?.description).to.equal("Starting test container");
        h.controller.setContainerActivity("p1", undefined);
        expect((await findNode())?.description).to.equal(undefined);
    });

    test("cancel while reading the saved profile prevents Docker startup", async () => {
        const h = harness();
        const profileRead = Promise.withResolvers<
            Array<{
                id: string;
                server: string;
                authenticationType: string;
                containerName: string;
            }>
        >();
        h.profiles.readAllConnections.returns(profileRead.promise);
        const connected = h.controller.connectProfile("p1");
        h.controller.cancelConnect("p1");
        profileRead.resolve([
            {
                id: "p1",
                server: "localhost",
                authenticationType: "Integrated",
                containerName: "test-container",
            },
        ]);
        expect(await connected).to.equal(false);
        expect(h.restart).not.to.have.been.called;
        expect(h.open).not.to.have.been.called;
    });

    for (const preflight of ["false", "error"]) {
        test(`SQL can still connect when Docker preparation returns ${preflight}`, async () => {
            const h = harness();
            if (preflight === "false") h.restart.resolves(false);
            else h.restart.rejects(new Error("Docker CLI unavailable"));
            expect(await h.controller.connectProfile("p1")).to.equal(true);
            expect(h.open).to.have.been.calledOnce;
            expect(h.registry.stateOf("p1")).to.equal("connected");
        });
    }

    test("preserves both Docker and SQL errors when neither path succeeds", async () => {
        const h = harness();
        h.restart.resolves(false);
        h.open.rejects(new Error("Login failed for user sa"));
        expect(await h.controller.connectProfile("p1")).to.equal(false);
        expect(h.open).to.have.been.calledOnce;
        expect(h.registry.get("p1")?.failureReason).to.equal(
            ObjectExplorerV2.containerAndConnectionFailed(
                ObjectExplorerV2.containerStartupFailed,
                "Login failed for user sa",
            ),
        );
    });

    test("canceled Docker preparation does not try SQL", async () => {
        const h = harness();
        h.restart.resolves(undefined);
        expect(await h.controller.connectProfile("p1")).to.equal(false);
        expect(h.open).not.to.have.been.called;
    });

    test("transient wizard password serves the connection and metadata only until disconnect", async () => {
        const h = harness();
        const stored = {
            id: "p1",
            server: "localhost,14330",
            authenticationType: "SqlLogin",
            user: "sa",
            containerName: "test-container",
            password: "",
        };
        h.profiles.readAllConnections.resolves([stored]);
        expect(
            await h.controller.connectProfile("p1", {
                password: "test-only-password",
                freshContainer: true,
            }),
        ).to.equal(true);
        const prepared = h.coordinatorFactory.firstCall.args[0] as PreparedConnection;
        expect(await prepared.auth.passwordProvider?.()).to.equal("test-only-password");
        expect(await h.open.firstCall.args[0].auth.passwordProvider()).to.equal(
            "test-only-password",
        );
        expect(stored.password).to.equal("");
        await h.controller.disconnectProfile("p1");
        expect(await prepared.auth.passwordProvider?.()).to.equal(undefined);
        expect(await h.controller.connectProfile("p1")).to.equal(true);
        expect(await h.open.secondCall.args[0].auth.passwordProvider()).to.equal(undefined);
    });

    test("disconnect keeps lifecycle progress and offers an explicit Start Container action", async () => {
        const h = harness();
        await h.controller.connectProfile("p1");
        h.controller.setContainerActivity("p1", LocalContainers.stoppingContainerLoadingLabel);
        await h.controller.disconnectProfile("p1");
        const node = (await h.controller.children()).find((n) => n.connectionId === "p1")!;
        expect(node.description).to.equal(LocalContainers.stoppingContainerLoadingLabel);
        h.controller.setContainerActivity("p1", undefined);
        const children = await h.controller.children(node);
        expect(h.restart).to.have.been.calledOnce;
        expect(children[0].action).to.equal("startContainer");
        const provider = new ObjectExplorerV2Provider(h.controller);
        disposables.push(provider);
        const item = provider.getTreeItem(children[0]);
        expect(item.command?.command).to.equal("mssql.objectExplorerV2.startContainer");
        expect(item.command?.arguments).to.deep.equal([children[0]]);
        expect(children[0].containerName).to.equal("test-container");
    });

    test("a hung preflight times out and cancels its Docker work", async () => {
        const clock = sandbox.useFakeTimers();
        const h = harness();
        const entered = Promise.withResolvers<void>();
        h.restart.callsFake(() => {
            entered.resolve();
            return new Promise(() => undefined);
        });
        const connected = h.controller.connectProfile("p1");
        await entered.promise;
        await clock.tickAsync(101);
        expect(await connected).to.equal(false);
        expect(h.restart.firstCall.args[2].aborted).to.equal(true);
        expect(h.registry.get("p1")?.failureReason).to.equal(
            ObjectExplorerV2.containerStartupTimedOut,
        );
        expect(h.open).not.to.have.been.called;
    });

    for (const action of [
        "cancelConnect",
        "disconnectProfile",
        "retireProfile",
        "dispose",
    ] as const) {
        test(`${action} cancels startup and ignores a late Docker success`, async () => {
            const h = harness();
            const entered = Promise.withResolvers<void>();
            const ready = Promise.withResolvers<boolean>();
            h.restart.callsFake(() => {
                entered.resolve();
                return ready.promise;
            });
            const connected = h.controller.connectProfile("p1");
            await entered.promise;
            if (action === "dispose") h.controller.dispose();
            else await h.controller[action]("p1");
            expect(await connected).to.equal(false);
            expect(h.restart.firstCall.args[2].aborted).to.equal(true);
            ready.resolve(true);
            await ready.promise;
            expect(h.open).not.to.have.been.called;
            expect(h.registry.stateOf("p1")).not.to.equal("failed");
        });
    }

    test("retries a transient pre-login reset while SQL Server is starting", async () => {
        const clock = sandbox.useFakeTimers();
        const h = harness();
        h.open
            .onFirstCall()
            .rejects(new Error("The connection was forcibly closed during pre-login handshake"));
        const connected = h.controller.connectProfile("p1");
        await clock.tickAsync(11);
        expect(await connected).to.equal(true);
        expect(h.open).to.have.been.calledTwice;
    });

    test("new containers retry a transient login failure during initialization", async () => {
        const clock = sandbox.useFakeTimers();
        const h = harness();
        h.open.onFirstCall().rejects(new Error("Login failed for user 'sa'."));
        const connected = h.controller.connectProfile("p1", { freshContainer: true });
        await clock.tickAsync(11);
        expect(await connected).to.equal(true);
        expect(h.open).to.have.been.calledTwice;
    });

    test("new container login failures stop after the short grace period", async () => {
        const clock = sandbox.useFakeTimers();
        const h = harness();
        h.open.rejects(new Error("Login failed for user 'sa'."));
        const connected = h.controller.connectProfile("p1", { freshContainer: true });
        await clock.tickAsync(50);
        expect(await connected).to.equal(false);
        expect(h.open).to.have.been.calledTwice;
        expect(h.registry.get("p1")?.failureReason).to.equal("Login failed for user 'sa'.");
    });

    for (const reason of [
        "Login failed for user sa",
        "Pre-login handshake: certificate chain is not trusted",
    ]) {
        test(`does not retry configuration failures: ${reason}`, async () => {
            const h = harness();
            h.open.rejects(new Error(reason));
            expect(await h.controller.connectProfile("p1")).to.equal(false);
            expect(h.open).to.have.been.calledOnce;
        });
    }

    test("cancel during the retry delay prevents another connection attempt", async () => {
        const clock = sandbox.useFakeTimers();
        const h = harness();
        h.open.rejects(new Error("Connection actively refused"));
        const connected = h.controller.connectProfile("p1");
        await clock.tickAsync(1);
        h.controller.cancelConnect("p1");
        await clock.tickAsync(50);
        expect(await connected).to.equal(false);
        expect(h.open).to.have.been.calledOnce;
        expect(h.registry.stateOf("p1")).to.equal("disconnected");
        expect(h.registry.get("p1")?.failureReason).to.equal(undefined);
    });

    test("retries stop at the startup budget", async () => {
        const clock = sandbox.useFakeTimers();
        const h = harness();
        h.open.rejects(new Error("Connection actively refused"));
        const connected = h.controller.connectProfile("p1");
        await clock.tickAsync(60);
        expect(await connected).to.equal(false);
        const attempts = h.open.callCount;
        await clock.tickAsync(1000);
        expect(h.open.callCount).to.equal(attempts);
        expect(h.registry.stateOf("p1")).to.equal("failed");
    });
});

suite("Object Explorer v2 container commands", () => {
    let sandbox: sinon.SinonSandbox;
    let subscriptions: vscode.Disposable[];
    setup(() => {
        sandbox = sinon.createSandbox();
        subscriptions = [];
    });
    teardown(() => {
        subscriptions.reverse().forEach((d) => d.dispose());
        sandbox.restore();
    });

    function harness() {
        const commands = new Map<string, (...args: unknown[]) => unknown>();
        sandbox.stub(vscode.commands, "registerCommand").callsFake((id, callback) => {
            commands.set(id, callback);
            return new vscode.Disposable(() => commands.delete(id));
        });
        sandbox.stub(vscode.commands, "executeCommand").resolves();
        sandbox
            .stub(vscode.window, "createTreeView")
            .returns({ dispose: () => undefined } as vscode.TreeView<never>);
        const profiles = [
            {
                id: "p1",
                profileName: "Selected",
                server: "localhost,14330",
                authenticationType: "Integrated",
                containerName: "shared-container",
            },
            {
                id: "p2",
                profileName: "Other database",
                server: "localhost,14330",
                authenticationType: "Integrated",
                containerName: "shared-container",
            },
        ];
        const remove = sandbox.stub().resolves();
        const deploy = sandbox.stub();
        const connect = sandbox.stub(OeV2TreeController.prototype, "connectProfile").resolves(true);
        const disconnect = sandbox
            .stub(OeV2TreeController.prototype, "disconnectProfile")
            .resolves();
        sandbox.stub(OeV2ClassicHandoffService.prototype, "close").resolves();
        const prepare = sandbox
            .stub(docker, "prepareForDockerContainerCommand")
            .resolves({ success: true });
        const stop = sandbox.stub(docker, "stopContainer").resolves(true);
        const removeContainer = sandbox.stub(docker, "deleteContainer").resolves(true);
        const warn = sandbox.stub(vscode.window, "showWarningMessage").resolves();
        const info = sandbox.stub(vscode.window, "showInformationMessage").resolves();
        let enabled = true;
        activateObjectExplorerV2({ subscriptions } as vscode.ExtensionContext, {
            instantiationService: {} as OeV2ActivationDeps["instantiationService"],
            profiles: {
                readAllConnections: async () => profiles,
                readAllConnectionGroups: async () => [],
                lookupPassword: async () => undefined,
                removeProfile: remove,
            } as OeV2ActivationDeps["profiles"],
            isEnabled: () => enabled,
            tokens: { acquireSqlAccessToken: sandbox.stub().resolves("unused-token") },
            deployNewDatabase: deploy,
        });
        const node = { connectionId: "p1", containerName: "shared-container" };
        const invoke = (command: string) =>
            commands.get(`mssql.objectExplorerV2.${command}`)!(node);
        return {
            invoke,
            profiles,
            remove,
            deploy,
            connect,
            disconnect,
            prepare,
            stop,
            removeContainer,
            warn,
            info,
            disable: () => {
                enabled = false;
            },
        };
    }

    test("deployment and container commands are inert while the feature is disabled", async () => {
        const h = harness();
        await h.invoke("deployNewDatabase");
        expect(h.deploy).to.have.been.calledOnce;
        h.deploy.resetHistory();
        h.disable();
        for (const command of [
            "deployNewDatabase",
            "startContainer",
            "stopContainer",
            "deleteContainer",
        ])
            await h.invoke(command);
        for (const stub of [
            h.deploy,
            h.connect,
            h.prepare,
            h.stop,
            h.removeContainer,
            h.remove,
            h.warn,
            h.info,
        ])
            expect(stub).not.to.have.been.called;
    });

    test("warns about other profiles sharing a container and honors declining deletion", async () => {
        const h = harness();
        await h.invoke("deleteContainer");
        expect(h.warn).to.have.been.calledWith(
            LocalContainers.deleteSharedContainerConfirmation("shared-container", [
                "Other database",
            ]),
            { modal: true },
            Common.delete,
        );
        expect(h.removeContainer).not.to.have.been.called;
        expect(h.remove).not.to.have.been.called;
    });

    test("successful deletion removes only the selected saved profile", async () => {
        const h = harness();
        h.warn.resolves(Common.delete as never);
        await h.invoke("deleteContainer");
        expect(h.removeContainer).to.have.been.calledWith("shared-container");
        expect(h.remove).to.have.been.calledOnce;
        expect(h.remove.firstCall.args[0]).to.include({ id: "p1" });
    });

    test("failed deletion keeps the saved profile", async () => {
        const h = harness();
        h.warn.resolves(Common.delete as never);
        h.removeContainer.resolves(false);
        await h.invoke("deleteContainer");
        expect(h.remove).not.to.have.been.called;
    });

    for (const command of ["stopContainer", "deleteContainer"]) {
        for (const boundary of ["prepare", "disconnect"] as const) {
            test(`editing a connection during ${boundary} prevents ${command}`, async () => {
                const h = harness();
                h.warn.resolves(Common.delete as never);
                const replace = () => {
                    // A different server with the same ID/container is also a replacement.
                    h.profiles[0].server = "replacement-server";
                };
                if (boundary === "prepare")
                    h.prepare.callsFake(async () => {
                        replace();
                        return { success: true };
                    });
                else h.disconnect.callsFake(async () => replace());
                await h.invoke(command);
                expect(h.stop).not.to.have.been.called;
                expect(h.removeContainer).not.to.have.been.called;
                expect(h.remove).not.to.have.been.called;
            });
        }
        for (const outcome of ["false", "throw"]) {
            test(`${command} clears preparation activity after ${outcome}`, async () => {
                const h = harness();
                const activity = sandbox.spy(OeV2TreeController.prototype, "setContainerActivity");
                h.warn.resolves(Common.delete as never);
                h.prepare.callsFake(async (_name, host) => {
                    await (host as ContainerHostAdapter).setStatus("Starting Docker");
                    if (outcome === "throw") throw new Error("engine unavailable");
                    return { success: false };
                });
                await Promise.resolve(h.invoke(command)).catch(() => undefined);
                expect(activity.lastCall.args).to.deep.equal(["p1", undefined]);
                expect(h.stop).not.to.have.been.called;
                expect(h.removeContainer).not.to.have.been.called;
            });
        }
        test(`disabling during disconnect prevents ${command}`, async () => {
            const h = harness();
            h.warn.resolves(Common.delete as never);
            h.disconnect.callsFake(async () => h.disable());
            await h.invoke(command);
            expect(h.stop).not.to.have.been.called;
            expect(h.removeContainer).not.to.have.been.called;
            expect(h.remove).not.to.have.been.called;
        });
    }

    test("a replacement profile is retained if it changes during container deletion", async () => {
        const h = harness();
        h.warn.resolves(Common.delete as never);
        h.removeContainer.callsFake(async () => {
            h.profiles[0].containerName = "replacement";
            return true;
        });
        await h.invoke("deleteContainer");
        expect(h.removeContainer).to.have.been.calledOnce;
        expect(h.remove).not.to.have.been.called;
    });

    test("disabling during confirmation cancels deletion", async () => {
        const h = harness();
        h.warn.callsFake(async () => {
            h.disable();
            return Common.delete as never;
        });
        await h.invoke("deleteContainer");
        expect(h.removeContainer).not.to.have.been.called;
        expect(h.prepare).not.to.have.been.called;
    });

    test("editing the selected profile during confirmation cancels deletion", async () => {
        const h = harness();
        h.warn.callsFake(async () => {
            h.profiles[0].containerName = "replacement";
            return Common.delete as never;
        });
        await h.invoke("deleteContainer");
        expect(h.removeContainer).not.to.have.been.called;
        expect(h.remove).not.to.have.been.called;
    });
});
