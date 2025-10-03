/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as constants from "../../src/constants/constants";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { PublishProjectWebViewController } from "../../src/publishProject/publishProjectWebViewController";

suite("PublishProjectWebViewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let contextStub: vscode.ExtensionContext;
    let vscodeWrapperStub: VscodeWrapper;
    let workspaceConfigStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Create minimal context stub - only what the controller actually uses
        contextStub = {
            extensionUri: vscode.Uri.parse("file://ProjectPath"),
            extensionPath: "ProjectPath",
            subscriptions: [],
        } as vscode.ExtensionContext;

        const outputChannel: vscode.OutputChannel = {
            name: "test",
            append: () => undefined,
            appendLine: () => undefined,
            clear: () => undefined,
            replace: (_value: string) => undefined,
            show: () => undefined,
            hide: () => undefined,
            dispose: () => undefined,
        };

        // Subclass VscodeWrapper to override the outputChannel getter cleanly.
        class TestVscodeWrapper extends VscodeWrapper {
            public override get outputChannel(): vscode.OutputChannel {
                return outputChannel;
            }
        }
        vscodeWrapperStub = new TestVscodeWrapper();

        // Stub workspace configuration for preview features
        workspaceConfigStub = sandbox.stub(vscode.workspace, "getConfiguration");
        workspaceConfigStub.withArgs("sqlDatabaseProjects").returns({
            get: sandbox.stub().withArgs("enablePreviewFeatures").returns(false),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("constructor initializes state and derives database name", async () => {
        const projectPath = "c:/work/MySampleProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        // Initial synchronous expectations
        expect(controller.state.projectFilePath).to.equal(projectPath);
        expect(controller.state.formState.databaseName).to.equal("MySampleProject");

        // Wait for async initializeDialog() to finish populating formComponents
        await controller.initialized.promise;

        // Form components should be initialized after async initialization
        const components = controller.state.formComponents;
        // Basic fields expected from generatePublishFormComponents()
        expect(components.profileName, "profileName component should exist").to.exist;
        expect(components.serverName, "serverName component should exist").to.exist;
        expect(components.databaseName, "databaseName component should exist").to.exist;
        expect(components.publishTarget, "publishTarget component should exist").to.exist;
    });

    test("reducer handlers are registered on construction", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        // Access internal reducer handlers map
        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;

        // Verify all expected reducers are registered
        expect(reducerHandlers.has("publishNow"), "publishNow reducer should be registered").to.be
            .true;
        expect(
            reducerHandlers.has("generatePublishScript"),
            "generatePublishScript reducer should be registered",
        ).to.be.true;
        expect(
            reducerHandlers.has("selectPublishProfile"),
            "selectPublishProfile reducer should be registered",
        ).to.be.true;
        expect(
            reducerHandlers.has("savePublishProfile"),
            "savePublishProfile reducer should be registered",
        ).to.be.true;
    });

    test("default publish target is EXISTING_SERVER", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        expect(controller.state.formState.publishTarget).to.equal(
            constants.PublishTargets.EXISTING_SERVER,
        );
    });

    test("getActiveFormComponents returns correct fields for EXISTING_SERVER target", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        // Set publish target to EXISTING_SERVER (default)
        controller.state.formState.publishTarget = constants.PublishTargets.EXISTING_SERVER;

        const activeComponents = controller["getActiveFormComponents"](controller.state);

        // Should include basic fields but NOT container fields
        expect(activeComponents).to.include("publishTarget");
        expect(activeComponents).to.include("profileName");
        expect(activeComponents).to.include("serverName");
        expect(activeComponents).to.include("databaseName");

        // Should NOT include container fields
        expect(activeComponents).to.not.include("containerPort");
        expect(activeComponents).to.not.include("containerAdminPassword");
    });

    test("getActiveFormComponents returns correct fields for LOCAL_CONTAINER target", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        // Set publish target to LOCAL_CONTAINER
        controller.state.formState.publishTarget = constants.PublishTargets.LOCAL_CONTAINER;

        const activeComponents = controller["getActiveFormComponents"](controller.state);

        // Should include basic fields AND container fields
        expect(activeComponents).to.include("publishTarget");
        expect(activeComponents).to.include("profileName");
        expect(activeComponents).to.include("databaseName");

        // Should include container fields
        expect(activeComponents).to.include("containerPort");
        expect(activeComponents).to.include("containerAdminPassword");
        expect(activeComponents).to.include("containerAdminPasswordConfirm");
        expect(activeComponents).to.include("containerImageTag");
        expect(activeComponents).to.include("acceptContainerLicense");
    });

    test("state tracks inProgress and lastPublishResult", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        // Initial state
        expect(controller.state.inProgress).to.be.false;
        expect(controller.state.lastPublishResult).to.be.undefined;

        // Can be updated
        controller.state.inProgress = true;
        expect(controller.state.inProgress).to.be.true;
    });
});
