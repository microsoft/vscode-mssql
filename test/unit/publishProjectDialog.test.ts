/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as sinon from "sinon";
import * as constants from "../../src/constants/constants";
import { expect } from "chai";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { PublishProjectWebViewController } from "../../src/publishProject/publishProjectWebViewController";

suite("PublishProjectWebViewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    const projectPath = "c:/work/ContainerProject.sqlproj";

    setup(() => {
        sandbox = sinon.createSandbox();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext.setup((c) => c.extensionUri).returns(() => vscode.Uri.parse("file://fakePath"));
        mockContext.setup((c) => c.extensionPath).returns(() => "fakePath");
        mockContext.setup((c) => c.subscriptions).returns(() => []);
        const globalState = {
            get: (<T>(_key: string, defaultValue?: T) => defaultValue) as {
                <T>(key: string): T | undefined;
                <T>(key: string, defaultValue: T): T;
            },
            update: async () => undefined,
            keys: () => [] as readonly string[],
            setKeysForSync: (_keys: readonly string[]) => undefined,
        } as unknown as vscode.Memento & { setKeysForSync(keys: readonly string[]): void };
        mockContext.setup((c) => c.globalState).returns(() => globalState);

        mockVscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        const outputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        mockVscodeWrapper.setup((v) => v.outputChannel).returns(() => outputChannel.object);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("container target values are properly saved to state", async () => {
        // Arrange
        const controller = new PublishProjectWebViewController(
            mockContext.object,
            mockVscodeWrapper.object,
            projectPath,
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        // Access internal reducer handlers map to invoke reducers directly
        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const setPublishValues = reducerHandlers.get("setPublishValues");
        expect(setPublishValues, "setPublishValues reducer should be registered").to.exist;

        // Set target to localContainer first
        let newState = await setPublishValues(controller.state, {
            publishTarget: constants.PublishTargets.LOCAL_CONTAINER,
        });
        controller.updateState(newState);

        // Act - Test updating container port
        newState = await setPublishValues(controller.state, {
            containerPort: "1434",
        });
        controller.updateState(newState);

        // Act - Test updating admin password
        newState = await setPublishValues(controller.state, {
            containerAdminPassword: "TestPassword123!",
        });
        controller.updateState(newState);

        // Act - Test updating password confirmation
        newState = await setPublishValues(controller.state, {
            containerAdminPasswordConfirm: "TestPassword123!",
        });
        controller.updateState(newState);

        // Act - Test updating image tag
        newState = await setPublishValues(controller.state, {
            containerImageTag: "2022-latest",
        });
        controller.updateState(newState);

        // Act - Test accepting license agreement
        newState = await setPublishValues(controller.state, {
            acceptContainerLicense: true,
        });
        controller.updateState(newState);

        // Assert - Verify all values are saved to state
        expect(controller.state.formState.publishTarget).to.equal(
            constants.PublishTargets.LOCAL_CONTAINER,
        );
        expect(controller.state.formState.containerPort).to.equal("1434");
        expect(controller.state.formState.containerAdminPassword).to.equal("TestPassword123!");
        expect(controller.state.formState.containerAdminPasswordConfirm).to.equal(
            "TestPassword123!",
        );
        expect(controller.state.formState.containerImageTag).to.equal("2022-latest");
        expect(controller.state.formState.acceptContainerLicense).to.equal(true);

        // Assert - Verify form components exist for container fields
        expect(controller.state.formComponents.containerPort).to.exist;
        expect(controller.state.formComponents.containerAdminPassword).to.exist;
        expect(controller.state.formComponents.containerAdminPasswordConfirm).to.exist;
        expect(controller.state.formComponents.containerImageTag).to.exist;
        expect(controller.state.formComponents.acceptContainerLicense).to.exist;

        // Assert - Verify container components are not hidden when target is localContainer
        expect(controller.state.formComponents.containerPort?.hidden).to.not.be.true;
        expect(controller.state.formComponents.containerAdminPassword?.hidden).to.not.be.true;
        expect(controller.state.formComponents.containerAdminPasswordConfirm?.hidden).to.not.be
            .true;
        expect(controller.state.formComponents.containerImageTag?.hidden).to.not.be.true;
        expect(controller.state.formComponents.acceptContainerLicense?.hidden).to.not.be.true;
    });

    test("container fields are hidden when target is existingServer", async () => {
        // Arrange
        const controller = new PublishProjectWebViewController(
            mockContext.object,
            mockVscodeWrapper.object,
            projectPath,
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        // Access internal reducer handlers map to invoke reducers directly
        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const setPublishValues = reducerHandlers.get("setPublishValues");
        expect(setPublishValues, "setPublishValues reducer should be registered").to.exist;

        // Set target to existingServer
        const newState = await setPublishValues(controller.state, {
            publishTarget: constants.PublishTargets.EXISTING_SERVER,
        });
        controller.updateState(newState);

        // Assert - Verify container components are hidden when target is existingServer
        expect(controller.state.formComponents.containerPort?.hidden).to.be.true;
        expect(controller.state.formComponents.containerAdminPassword?.hidden).to.be.true;
        expect(controller.state.formComponents.containerAdminPasswordConfirm?.hidden).to.be.true;
        expect(controller.state.formComponents.containerImageTag?.hidden).to.be.true;
        expect(controller.state.formComponents.acceptContainerLicense?.hidden).to.be.true;

        // Assert - Verify server component is not hidden
        expect(controller.state.formComponents.serverName?.hidden).to.not.be.true;
    });

    test("validatePublishForm correctly validates container target fields", async () => {
        // Import the validation function
        const { validatePublishForm } = await import("../../src/publishProject/projectUtils");

        // Test invalid cases
        expect(validatePublishForm({})).to.be.false; // No target or database
        expect(validatePublishForm({ publishTarget: constants.PublishTargets.LOCAL_CONTAINER })).to
            .be.false; // No database
        expect(
            validatePublishForm({
                publishTarget: constants.PublishTargets.LOCAL_CONTAINER,
                databaseName: "TestDB",
            }),
        ).to.be.false; // Missing container fields

        expect(
            validatePublishForm({
                publishTarget: constants.PublishTargets.LOCAL_CONTAINER,
                databaseName: "TestDB",
                containerPort: "1433",
                containerAdminPassword: "Password123!",
                containerAdminPasswordConfirm: "DifferentPassword", // Passwords don't match
                containerImageTag: "2022-latest",
                acceptContainerLicense: true,
            }),
        ).to.be.false; // Passwords don't match

        expect(
            validatePublishForm({
                publishTarget: constants.PublishTargets.LOCAL_CONTAINER,
                databaseName: "TestDB",
                containerPort: "1433",
                containerAdminPassword: "Password123!",
                containerAdminPasswordConfirm: "Password123!",
                containerImageTag: "2022-latest",
                acceptContainerLicense: false, // License not accepted
            }),
        ).to.be.false; // License not accepted

        // Test valid case
        expect(
            validatePublishForm({
                publishTarget: constants.PublishTargets.LOCAL_CONTAINER,
                databaseName: "TestDB",
                containerPort: "1433",
                containerAdminPassword: "Password123!",
                containerAdminPasswordConfirm: "Password123!",
                containerImageTag: "2022-latest",
                acceptContainerLicense: true,
            }),
        ).to.be.true; // All fields valid

        // Test existing server validation
        expect(
            validatePublishForm({
                publishTarget: constants.PublishTargets.EXISTING_SERVER,
                databaseName: "TestDB",
                serverName: "localhost",
            }),
        ).to.be.true; // Valid existing server

        expect(
            validatePublishForm({
                publishTarget: constants.PublishTargets.EXISTING_SERVER,
                databaseName: "TestDB",
            }),
        ).to.be.false; // Missing server name
    });
});
