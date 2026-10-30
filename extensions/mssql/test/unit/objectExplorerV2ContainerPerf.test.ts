/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as docker from "../../src/docker/dockerUtils";
import * as sqlContainer from "../../src/deployment/sqlServerContainer";
import { Perf } from "../../src/perf/perfTelemetry";
import { IConnectionProfile } from "../../src/models/interfaces";
import { registerOeV2ContainerPerfSeams } from "../../src/objectExplorer/v2/perf/oeV2ContainerPerfSeams";

suite("Object Explorer v2 container performance fixtures", () => {
    let sandbox: sinon.SinonSandbox;
    let commands: Map<string, () => Promise<unknown>>;
    let execute: sinon.SinonStub;
    let removeContainer: sinon.SinonStub;
    let removeProfile: sinon.SinonStub;
    let ready: sinon.SinonStub;
    let lookup: sinon.SinonStub;
    let create: sinon.SinonStub;

    const invoke = (name: string) => commands.get(`mssql.perf.oeV2Container${name}`)!();
    const expectFailure = async (operation: Promise<unknown>, message: string) => {
        const error = await operation.then(
            () => undefined,
            (failure: unknown) => failure,
        );
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include(message);
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(Perf, "enabled").value(true);
        commands = new Map();
        sandbox.stub(vscode.commands, "registerCommand").callsFake((name, callback) => {
            commands.set(name, callback);
            return { dispose: () => undefined };
        });
        execute = sandbox.stub(vscode.commands, "executeCommand").resolves(true);
        sandbox.stub(docker, "checkDockerInstallation").resolves({ success: true });
        sandbox.stub(docker, "startDocker").resolves({ success: true });
        sandbox.stub(docker, "checkEngine").resolves({ success: true });
        sandbox.stub(docker, "execDockerCommand").resolves("cached-image");
        sandbox.stub(docker, "findAvailablePort").resolves(14330);
        removeContainer = sandbox.stub(docker, "deleteContainer").resolves(true);
        lookup = sandbox.stub(docker, "getContainerByName").resolves({} as never);
        create = sandbox
            .stub(sqlContainer, "startSqlServerDockerContainer")
            .resolves({ success: true });
        ready = sandbox
            .stub(sqlContainer, "checkIfSqlServerContainerIsReadyForConnections")
            .resolves({ success: true });
        removeProfile = sandbox.stub().resolves();
        registerOeV2ContainerPerfSeams(
            { subscriptions: [] } as unknown as vscode.ExtensionContext,
            {
                isEnabled: () => true,
                saveProfile: async (profile: IConnectionProfile) => ({
                    ...profile,
                    id: "owned-profile",
                }),
                removeProfile,
            },
        );
    });

    teardown(async () => {
        execute.resolves(true);
        removeContainer.resolves(true);
        removeProfile.resolves();
        await invoke("Cleanup");
        sandbox.restore();
    });

    test("deploy connects through v2 and cleanup removes only its uniquely owned resources", async () => {
        await invoke("Deploy");
        expect(execute).to.have.been.calledWith(
            "mssql.objectExplorerV2.connectProfileById",
            "owned-profile",
        );
        await invoke("Cleanup");
        expect(removeContainer).to.have.been.calledOnce;
        expect(removeContainer.firstCall.args[0]).to.match(/^mssql-perftest-oev2-[\da-f-]{36}$/);
        expect(removeProfile.firstCall.args[0]).to.include({ id: "owned-profile" });
    });

    test("readiness failure deletes the container without waiting for harness cleanup", async () => {
        ready.resolves({ success: false, error: "not ready" });
        await expectFailure(invoke("Deploy"), "container never became ready");
        expect(removeContainer).to.have.been.calledOnce;
        expect(removeProfile).not.to.have.been.called;
    });

    test("connect failure removes the saved profile and container and preserves the failure", async () => {
        execute
            .withArgs("mssql.objectExplorerV2.connectProfileById")
            .rejects(new Error("open failed"));
        await expectFailure(invoke("Deploy"), "open failed");
        expect(removeContainer).to.have.been.calledOnce;
        expect(removeProfile.firstCall.args[0]).to.include({ id: "owned-profile" });
    });

    test("disconnect failure does not prevent deletion or retain already removed resources", async () => {
        await invoke("Deploy");
        execute
            .withArgs("mssql.objectExplorerV2.disconnect")
            .rejects(new Error("disconnect failed"));
        await expectFailure(invoke("Cleanup"), "cleanup failed");
        expect(removeContainer).to.have.been.calledOnce;
        expect(removeProfile).to.have.been.calledOnce;
        await invoke("Cleanup");
        expect(removeContainer).to.have.been.calledOnce;
    });

    test("failed container deletion remains owned and can be retried", async () => {
        await invoke("Deploy");
        removeContainer.resolves(false);
        await expectFailure(invoke("Cleanup"), "cleanup failed");
        expect(removeProfile).not.to.have.been.called;
        removeContainer.resolves(true);
        await invoke("Cleanup");
        expect(removeContainer).to.have.been.calledTwice;
        expect(removeContainer.secondCall.args).to.deep.equal(removeContainer.firstCall.args);
        expect(removeProfile).to.have.been.calledOnce;
    });

    test("failed creation with no container releases ownership for the next run", async () => {
        create.resolves({ success: false, error: "invalid image" });
        removeContainer.resolves(false);
        lookup.resolves(undefined);
        await expectFailure(invoke("Deploy"), "container create failed");
        expect(lookup).to.have.been.calledOnce;
        expect(removeProfile).not.to.have.been.called;
        create.resolves({ success: true });
        await invoke("Deploy");
        expect(create).to.have.been.calledTwice;
    });

    test("engine lookup failure does not treat the owned container as absent", async () => {
        await invoke("Deploy");
        removeContainer.resolves(false);
        lookup.rejects(new Error("engine disconnected"));
        await expectFailure(invoke("Cleanup"), "cleanup failed");
        expect(removeProfile).not.to.have.been.called;
        lookup.resolves(undefined);
        await invoke("Cleanup");
        expect(removeProfile).to.have.been.calledOnce;
    });
});
