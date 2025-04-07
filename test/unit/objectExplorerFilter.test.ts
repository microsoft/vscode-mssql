/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import {
    ObjectExplorerFilter,
    ObjectExplorerFilterReactWebviewController,
} from "../../src/objectExplorer/objectExplorerFilter";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ObjectExplorerFilterState } from "../../src/sharedInterfaces/objectExplorerFilter";
import { TreeNodeInfo } from "../../src/objectExplorer/treeNodeInfo";
import * as telemetry from "../../src/telemetry/telemetry";

suite("ObjectExplorerFilterReactWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let controller: ObjectExplorerFilterReactWebviewController;
    let treeNode: TypeMoq.IMock<TreeNodeInfo>;
    let mockInitialState: ObjectExplorerFilterState;
    let expectedFilters: any;
    let sendActionStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = {
            extensionUri: vscode.Uri.parse("file://test"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        controller = new ObjectExplorerFilterReactWebviewController(
            mockContext,
            mockVscodeWrapper.object,
        );
        controller.revealToForeground();

        treeNode = TypeMoq.Mock.ofType(TreeNodeInfo, TypeMoq.MockBehavior.Loose);
        treeNode.setup((t) => t.nodeType).returns(() => "Databases");
        treeNode
            .setup((t) => t.filterableProperties)
            .returns(() => [
                {
                    name: "Name",
                    displayName: "Name",
                    description: "Description",
                    type: 0,
                },
            ]);
        treeNode.setup((t) => t.filters).returns(() => []);
        treeNode.setup((t) => t.nodePath).returns(() => "localhost,1433/Databases");

        mockInitialState = {
            filterProperties: treeNode.object.filterableProperties,
            existingFilters: [],
            nodePath: treeNode.object.nodePath,
        };

        expectedFilters = [{ name: "name", operator: 0, value: "Name" }] as any;
        sendActionStub = sandbox.stub(telemetry, "sendActionEvent");
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Controller should fire onSubmit and dispose panel when 'submit' reducer is triggered", async () => {
        const fireSpy = sandbox.spy((controller as any)._onSubmit, "fire");
        const disposeStub = sandbox.stub((controller as any).panel, "dispose");

        const result = await controller["_reducers"]["submit"](mockInitialState, {
            filters: expectedFilters,
        });

        assert.ok(fireSpy.calledOnce, "Submit should be fired once");
        assert.deepStrictEqual(fireSpy.firstCall.args, [expectedFilters]);
        assert.ok(disposeStub.calledOnce, "Panel should be disposed");
        assert.deepStrictEqual(result, mockInitialState);
    });

    test("Controller should fire onCancel and dispose panel when 'cancel' reducer is triggered", async () => {
        const fireSpy = sandbox.spy((controller as any)._onCancel, "fire");
        const disposeStub = sandbox.stub((controller as any).panel, "dispose");

        const result = await controller["_reducers"]["cancel"](mockInitialState, {});

        assert.ok(fireSpy.calledOnce, "Cancel should be fired once");
        assert.deepStrictEqual(fireSpy.firstCall.args, []);
        assert.ok(disposeStub.calledOnce, "Panel should be disposed");
        assert.deepStrictEqual(result, mockInitialState);
    });

    test("Controller should load and update state with loadData", () => {
        const testState: ObjectExplorerFilterState = {
            filterProperties: [
                { name: "prop1", displayName: "Property 1", type: 0, description: "description" },
            ],
            existingFilters: [{ name: "prop1", operator: 0, value: "123" }],
            nodePath: "node1",
        };

        controller.loadData(testState);
        const internalState = controller.state;
        assert.deepStrictEqual(internalState, testState);
    });

    test("GetFilters should resolve with submitted filters", async () => {
        // Start the getFilters promise
        const filtersPromise = ObjectExplorerFilter.getFilters(
            mockContext,
            mockVscodeWrapper.object,
            treeNode.object,
        );

        const internalController = (ObjectExplorerFilter as any)._filterWebviewController;

        // Act as if the user submitted filters
        await internalController._reducers.submit(mockInitialState, {
            filters: expectedFilters,
        });

        const result = await filtersPromise;

        assert.deepStrictEqual(result, expectedFilters);
    });

    test("GetFilters should resolve empty on cancel", async () => {
        const filtersPromise = ObjectExplorerFilter.getFilters(
            mockContext,
            mockVscodeWrapper.object,
            treeNode.object,
        );

        const internalController = (ObjectExplorerFilter as any)._filterWebviewController;

        await internalController._reducers.cancel(mockInitialState, {});

        const result = await filtersPromise;

        assert.strictEqual(result, undefined);
    });
});
