/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    activateObjectExplorerV2,
    OeV2ActivationDeps,
} from "../../src/objectExplorer/v2/activation";
import { OeV2TreeController } from "../../src/objectExplorer/v2/tree/oeV2TreeController";
import { OeV2ClassicHandoffService } from "../../src/objectExplorer/v2/legacy/oeV2ClassicHandoffService";
import { OeV2SessionRegistry } from "../../src/objectExplorer/v2/sessions/oeV2SessionRegistry";
import { OeV2MetadataCoordinator } from "../../src/objectExplorer/v2/metadata/oeV2MetadataCoordinator";
import { prepareConnection } from "../../src/services/metadata/profileAuthAdapter";
import type { ISqlSession } from "../../src/services/sqlDataPlane/api";
import { SqlDataPlaneService } from "../../src/services/sqlDataPlane/sqlDataPlaneService";
import { FAKE_CAPABILITIES } from "../../src/services/sqlDataPlane/fakeBackend";
import { MetadataStoreService } from "../../src/services/metadata/metadataStoreService";
import { MetadataStore } from "../../src/services/metadata/metadataStore";
import { OeV2Node } from "../../src/objectExplorer/v2/tree/oeV2Node";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

suite("Object Explorer v2 lifecycle", () => {
    const sandbox = sinon.createSandbox();
    let subscriptions: vscode.Disposable[];
    setup(() => {
        subscriptions = [];
    });
    teardown(() => {
        subscriptions.forEach((subscription) => subscription.dispose());
        sandbox.restore();
    });

    test("expanding an Entra connection forwards token acquisition through activation", async () => {
        const profile = {
            id: "entra",
            server: "server.database.windows.net",
            authenticationType: "AzureMFA",
            accountId: "account",
            tenantId: "tenant",
            email: "user@example.test",
        };
        const tokens = { acquireSqlAccessToken: sandbox.stub().resolves("token-canary") };
        const session = {
            info: { sessionId: "entra-session" },
            onDidChangeState: () => ({ dispose: () => undefined }),
            close: async () => undefined,
        } as unknown as ISqlSession;
        const dataPlane = sandbox.createStubInstance(SqlDataPlaneService);
        sandbox.stub(SqlDataPlaneService, "get").returns(dataPlane);
        sandbox.stub(dataPlane, "enabled").get(() => true);
        dataPlane.availability.returns({
            state: "available",
            backend: "test",
            capabilities: FAKE_CAPABILITIES,
        });
        dataPlane.openSessionWithFallback.callsFake(async (params) => {
            expect(params.profile.authKind).to.equal("aad");
            expect(await params.auth?.tokenProvider?.()).to.equal("token-canary");
            expect(JSON.stringify(params.profile)).not.to.include("token-canary");
            return { session };
        });
        const metadata = sandbox.createStubInstance(MetadataStoreService);
        metadata.store.returns(sandbox.createStubInstance(MetadataStore));
        sandbox.stub(MetadataStoreService, "get").returns(metadata);
        sandbox.stub(OeV2MetadataCoordinator.prototype, "ensureServer").resolves();
        let provider: vscode.TreeDataProvider<OeV2Node>;
        sandbox.stub(vscode.window, "createTreeView").callsFake((_id, options) => {
            provider = options.treeDataProvider as vscode.TreeDataProvider<OeV2Node>;
            return { dispose: () => undefined } as vscode.TreeView<never>;
        });
        sandbox
            .stub(vscode.commands, "registerCommand")
            .returns(new vscode.Disposable(() => undefined));
        activateObjectExplorerV2({ subscriptions } as vscode.ExtensionContext, {
            instantiationService: {} as OeV2ActivationDeps["instantiationService"],
            profiles: {
                readAllConnections: async () => [profile],
                readAllConnectionGroups: async () => [],
                lookupPassword: async () => undefined,
                removeProfile: async () => undefined,
            } as OeV2ActivationDeps["profiles"],
            tokens,
            isEnabled: () => true,
        });
        const root = (await provider!.getChildren())!.find(
            (node) => node.connectionId === profile.id,
        )!;
        await provider!.getChildren(root);
        expect(tokens.acquireSqlAccessToken).to.have.been.calledWithMatch(profile);
        expect(
            (await provider!.getChildren())!.find((node) => node.connectionId === profile.id)?.kind,
        ).to.equal("connectedServer");
    });

    test("disposing a registry during profile replacement prevents the replacement open", async () => {
        const closing = Promise.withResolvers<void>();
        const closeStarted = Promise.withResolvers<void>();
        const session = {
            info: { sessionId: "session" },
            onDidChangeState: () => ({ dispose: () => undefined }),
            close: async () => {
                closeStarted.resolve();
                await closing.promise;
            },
        } as unknown as ISqlSession;
        const open = sandbox.stub().resolves({ session });
        const registry = new OeV2SessionRegistry(open);
        const profile = {
            id: "p1",
            server: "srv",
            database: "OldDb",
            authenticationType: "Integrated",
        };
        const secrets = { lookupPassword: async () => undefined };
        await registry.connect("p1", prepareConnection(profile, secrets));
        const replacement = registry.connect(
            "p1",
            prepareConnection({ ...profile, database: "NewDb" }, secrets),
        );
        await closeStarted.promise;
        registry.dispose();
        closing.resolve();
        expect((await replacement).state).to.equal("disconnected");
        expect((await registry.connect("p1", prepareConnection(profile, secrets))).state).to.equal(
            "disconnected",
        );
        sinon.assert.calledOnce(open);
    });

    for (const phase of ["handoff", "session"] as const) {
        test(`disabling and re-enabling during ${phase} teardown cancels old reconciliation`, async () => {
            let enabled = true;
            let profiles = [{ id: "old", server: "srv", authenticationType: "Integrated" }];
            const changes = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();
            subscriptions.push(changes);
            sandbox.stub(vscode.workspace, "onDidChangeConfiguration").callsFake(changes.event);
            sandbox
                .stub(vscode.commands, "registerCommand")
                .returns(new vscode.Disposable(() => undefined));
            sandbox
                .stub(vscode.window, "createTreeView")
                .returns({ dispose: () => undefined } as vscode.TreeView<never>);
            const gate = Promise.withResolvers<void>();
            const entered = Promise.withResolvers<void>();
            const close = sandbox.stub(OeV2ClassicHandoffService.prototype, "close").resolves();
            const retire = sandbox.stub(OeV2TreeController.prototype, "retireProfile").resolves();
            (phase === "handoff" ? close : retire).callsFake(async () => {
                entered.resolve();
                await gate.promise;
            });
            const connect = sandbox
                .stub(OeV2TreeController.prototype, "connectProfile")
                .resolves(true);
            const refresh = sandbox.spy(OeV2TreeController.prototype, "refresh");
            activateObjectExplorerV2({ subscriptions } as vscode.ExtensionContext, {
                instantiationService: {} as OeV2ActivationDeps["instantiationService"],
                profiles: {
                    readAllConnections: async () => profiles,
                    readAllConnectionGroups: async () => [],
                    lookupPassword: async () => undefined,
                    removeProfile: async () => undefined,
                } as OeV2ActivationDeps["profiles"],
                tokens: { acquireSqlAccessToken: async () => undefined },
                legacyConnections: { connect: async () => true, disconnect: async () => true },
                isEnabled: () => enabled,
            });
            await flush();
            profiles = [{ id: "new", server: "srv", authenticationType: "Integrated" }];
            const change = (key: string) =>
                changes.fire({ affectsConfiguration: (section) => section === key });
            change("mssql.connections");
            await entered.promise;
            enabled = false;
            change("mssql.objectExplorer.v2.enabled");
            enabled = true;
            change("mssql.objectExplorer.v2.enabled");
            gate.resolve();
            await flush();
            sinon.assert.notCalled(connect);
            sinon.assert.notCalled(refresh);
            if (phase === "handoff") sinon.assert.notCalled(retire);
        });
    }

    test("a controller disposed while profiles load never opens a session", async () => {
        const gate =
            Promise.withResolvers<{ id: string; server: string; authenticationType: string }[]>();
        const registry = sandbox.createStubInstance(OeV2SessionRegistry);
        registry.onDidChange.returns({ dispose: () => undefined });
        const coordinator = sandbox.stub();
        const controller = new OeV2TreeController({
            profiles: {
                readAllConnections: () => gate.promise,
                readAllConnectionGroups: async () => [],
            },
            dataPlane: { enabled: () => true, availabilityState: () => "available" },
            secrets: { lookupPassword: async () => undefined },
            sessions: registry,
            coordinatorFactory: coordinator,
        });
        const opening = controller.connectProfile("p1");
        controller.dispose();
        gate.resolve([{ id: "p1", server: "srv", authenticationType: "Integrated" }]);
        expect(await opening).to.equal(false);
        expect(await controller.connectProfile("p1")).to.equal(false);
        sinon.assert.notCalled(registry.connect);
        sinon.assert.notCalled(coordinator);
    });

    test("handoff facts use the current saved database even while a previous session remains", async () => {
        let profile = {
            id: "p1",
            server: "srv",
            database: "OldDb",
            authenticationType: "Integrated",
        };
        const secrets = { lookupPassword: async () => undefined };
        const oldPrepared = prepareConnection(profile, secrets);
        const registry = sandbox.createStubInstance(OeV2SessionRegistry);
        registry.onDidChange.returns({ dispose: () => undefined });
        registry.get.returns({ connectionId: "p1", state: "connected", prepared: oldPrepared });
        const controller = new OeV2TreeController({
            profiles: {
                readAllConnections: async () => [profile],
                readAllConnectionGroups: async () => [],
            },
            dataPlane: { enabled: () => true, availabilityState: () => "available" },
            secrets,
            sessions: registry,
        });
        const before = await controller.handoffFacts("p1");
        profile = { ...profile, database: "NewDb" };
        controller.refresh();
        const after = await controller.handoffFacts("p1");
        expect(after.stored.database).to.equal("NewDb");
        expect(after.fingerprint).to.not.equal(before.fingerprint);
        expect(prepareConnection(profile, secrets).serverFingerprint).to.equal(
            oldPrepared.serverFingerprint,
        );
        controller.dispose();
    });

    test("a controller disposed during session open never creates a metadata lease", async () => {
        const gate = Promise.withResolvers<Awaited<ReturnType<OeV2SessionRegistry["connect"]>>>();
        const entered = Promise.withResolvers<void>();
        const registry = sandbox.createStubInstance(OeV2SessionRegistry);
        registry.onDidChange.returns({ dispose: () => undefined });
        registry.connect.callsFake(() => {
            entered.resolve();
            return gate.promise;
        });
        const coordinator = sandbox.stub<[], OeV2MetadataCoordinator>();
        const controller = new OeV2TreeController({
            profiles: {
                readAllConnections: async () => [
                    { id: "p1", server: "srv", authenticationType: "Integrated" },
                ],
                readAllConnectionGroups: async () => [],
            },
            dataPlane: { enabled: () => true, availabilityState: () => "available" },
            secrets: { lookupPassword: async () => undefined },
            sessions: registry,
            coordinatorFactory: coordinator,
        });
        const opening = controller.connectProfile("p1");
        await entered.promise;
        controller.dispose();
        gate.resolve({ connectionId: "p1", state: "connected" });
        expect(await opening).to.equal(false);
        sinon.assert.notCalled(coordinator);
    });
});
