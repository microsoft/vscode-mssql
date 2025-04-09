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
import {
    NodeFilterOperator,
    NodeFilterPropertyDataType,
    ObjectExplorerFilterState,
    ObjectExplorerFilterUtils,
} from "../../src/sharedInterfaces/objectExplorerFilter";
import { TreeNodeInfo } from "../../src/objectExplorer/treeNodeInfo";

suite("ObjectExplorerFilterReactWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let controller: ObjectExplorerFilterReactWebviewController;
    let treeNode: TypeMoq.IMock<TreeNodeInfo>;
    let mockInitialState: ObjectExplorerFilterState;
    let expectedFilters: any;

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

suite("ObjectExplorerFilterUtils", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("getFilterOperatorEnum should map correctly from string to enum", () => {
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Contains"),
            NodeFilterOperator.Contains,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Not Contains"),
            NodeFilterOperator.NotContains,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Ends With"),
            NodeFilterOperator.EndsWith,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Equals"),
            NodeFilterOperator.Equals,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Greater Than"),
            NodeFilterOperator.GreaterThan,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Greater Than or Equals"),
            NodeFilterOperator.GreaterThanOrEquals,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Less Than"),
            NodeFilterOperator.LessThan,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Less Than or Equals"),
            NodeFilterOperator.LessThanOrEquals,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Not Between"),
            NodeFilterOperator.NotBetween,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Not Ends With"),
            NodeFilterOperator.NotEndsWith,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Not Equals"),
            NodeFilterOperator.NotEquals,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Not Starts With"),
            NodeFilterOperator.NotStartsWith,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("Starts With"),
            NodeFilterOperator.StartsWith,
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorEnum("nonexistent"),
            NodeFilterOperator.Equals, // default case
        );
    });

    test("getFilterOperatorString should map correctly from enum to string", () => {
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.Contains),
            "Contains",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.NotContains),
            "Not Contains",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.EndsWith),
            "Ends With",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.Equals),
            "Equals",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.GreaterThan),
            "Greater Than",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(
                NodeFilterOperator.GreaterThanOrEquals,
            ),
            "Greater Than or Equals",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.LessThan),
            "Less Than",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.LessThanOrEquals),
            "Less Than or Equals",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.NotBetween),
            "Not Between",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.NotEndsWith),
            "Not Ends With",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.NotEquals),
            "Not Equals",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.NotStartsWith),
            "Not Starts With",
        );
        assert.strictEqual(
            ObjectExplorerFilterUtils.getFilterOperatorString(NodeFilterOperator.StartsWith),
            "Starts With",
        );
        assert.strictEqual(ObjectExplorerFilterUtils.getFilterOperatorString(undefined), undefined);
    });

    test("getFilterOperators returns correct operators based on property type", () => {
        let result = ObjectExplorerFilterUtils.getFilterOperators({
            type: NodeFilterPropertyDataType.String,
        } as any);
        assert.ok(result.includes("Contains"));
        result = ObjectExplorerFilterUtils.getFilterOperators({
            type: NodeFilterPropertyDataType.Number,
        } as any);
        assert.ok(result.includes("Between"));
        result = ObjectExplorerFilterUtils.getFilterOperators({
            type: NodeFilterPropertyDataType.Date,
        } as any);
        assert.ok(result.includes("Between"));
        result = ObjectExplorerFilterUtils.getFilterOperators({
            type: NodeFilterPropertyDataType.Boolean,
        } as any);
        assert.ok(result.includes("Equals"));
        result = ObjectExplorerFilterUtils.getFilterOperators({
            type: NodeFilterPropertyDataType.Choice,
        } as any);
        assert.ok(result.includes("Equals"));
    });

    test("getFilters should convert string filters properly", () => {
        const filters = ObjectExplorerFilterUtils.getFilters([
            {
                type: NodeFilterPropertyDataType.String,
                name: "test",
                selectedOperator: "Equals",
                value: "abc",
            },
        ] as any);

        assert.deepStrictEqual(filters[0].name, "test");
        assert.deepStrictEqual(filters[0].value, "abc");
        assert.deepStrictEqual(filters[0].operator, NodeFilterOperator.Equals);
    });

    test("getFilters should filter out empty BETWEEN values", () => {
        const filters = ObjectExplorerFilterUtils.getFilters([
            {
                type: NodeFilterPropertyDataType.Number,
                name: "range",
                selectedOperator: "Between",
                value: ["1", "2"],
            },
        ] as any);
        assert.deepStrictEqual(filters, [{ ...filters[0], value: [1, 2] }]);
    });

    test("getErrorTextFromFilters returns correct error if first BETWEEN value is empty", () => {
        const filters = [
            {
                name: "range",
                operator: NodeFilterOperator.Between,
                value: ["", 10],
            },
        ] as any;

        const err = ObjectExplorerFilterUtils.getErrorTextFromFilters(filters);
        const opString = ObjectExplorerFilterUtils.getFilterOperatorString(filters.operator);
        assert.ok(err.includes("range") || err.includes(opString));
    });

    test("getErrorTextFromFilters returns correct error if second BETWEEN value is empty", () => {
        const filters = [
            {
                name: "range",
                operator: NodeFilterOperator.Between,
                value: [10, ""],
            },
        ] as any;

        const err = ObjectExplorerFilterUtils.getErrorTextFromFilters(filters);
        const opString = ObjectExplorerFilterUtils.getFilterOperatorString(filters.operator);
        assert.ok(err.includes("range") || err.includes(opString));
    });

    test("getErrorTextFromFilters returns correct error if first > second in BETWEEN", () => {
        const filters = [
            {
                name: "range",
                operator: NodeFilterOperator.Between,
                value: [20, 10],
            },
        ] as any;

        const err = ObjectExplorerFilterUtils.getErrorTextFromFilters(filters);
        const opString = ObjectExplorerFilterUtils.getFilterOperatorString(filters.operator);
        assert.ok(err.includes("range") || err.includes(opString));
    });
});
