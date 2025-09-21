/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { PublishProjectWebViewController } from "../../src/publishProject/publishProjectWebViewController";

suite("PublishProjectWebViewController fetchDockerTags reducer", () => {
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

    test("fetchDockerTags populates tag options and selects default tag", async () => {
        // Arrange
        const controller = new PublishProjectWebViewController(
            mockContext.object,
            mockVscodeWrapper.object,
            projectPath,
        );

        // Force publish target to localContainer and initialize container components
        // Access internal reducer handlers map to invoke reducers directly
        const reducerHandlers = (controller as any)._reducerHandlers as Map<string, Function>;
        const setPublishValues = reducerHandlers.get("setPublishValues");
        expect(setPublishValues, "setPublishValues reducer should be registered").to.exist;
        const newState = await setPublishValues(controller.state, {
            publishTarget: "localContainer",
        });
        controller.updateState(newState);

        // Wait for async form component generation
        await new Promise((r) => setTimeout(r, 0));

        // Mock global fetch
        const tagsResponse = { tags: ["2023-GDR1", "latest", "2022-CU1"] };
        const fetchStub = sandbox.stub(globalThis, "fetch").resolves({
            ok: true,
            json: async () => tagsResponse,
        } as Response);

        // Act
        const fetchDockerTags = reducerHandlers.get("fetchDockerTags");
        expect(fetchDockerTags, "fetchDockerTags reducer should be registered").to.exist;
        const updatedState = await fetchDockerTags(controller.state, {
            tagsUrl: "https://example/tags",
        });
        controller.updateState(updatedState);

        // Assert
        const tagComponent = controller.state.formComponents["containerImageTag"];
        expect(tagComponent, "containerImageTag component should exist").to.exist;
        const options = tagComponent.options ?? [];
        expect(options.length).to.be.greaterThan(0, "should add at least one tag option");
        expect(controller.state.formState.containerImageTag).to.equal(
            options[0].value,
            "first tag should be selected by default",
        );
        expect(fetchStub.calledOnce).to.be.true;
    });
});
