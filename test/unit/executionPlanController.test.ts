/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { ExecutionPlanWebviewController } from "../../src/controllers/executionPlanWebviewController";
import { ExecutionPlanService } from "../../src/services/executionPlanService";
import UntitledSqlDocumentService from "../../src/controllers/untitledSqlDocumentService";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { contents } from "../resources/testsqlplan";

suite("ExecutionPlanWebviewController Tests", () => {
    let controller: ExecutionPlanWebviewController;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockExecutionPlanService: ExecutionPlanService;
    let mockUntitledSqlDocumentService: UntitledSqlDocumentService;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock extension context
        mockContext = {
            extensionUri: vscode.Uri.parse("file://test"),
        } as unknown as vscode.ExtensionContext;

        // Mock dependencies
        mockExecutionPlanService = sandbox.createStubInstance(
            ExecutionPlanService,
        ) as unknown as ExecutionPlanService;
        mockUntitledSqlDocumentService = sandbox.createStubInstance(
            UntitledSqlDocumentService,
        ) as unknown as UntitledSqlDocumentService;

        // Initialize the controller
        controller = new ExecutionPlanWebviewController(
            mockContext,
            mockExecutionPlanService,
            mockUntitledSqlDocumentService,
            contents,
            "test-plan.xml",
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Should initialize with correct initial state", () => {
        assert.deepStrictEqual(
            controller.state.executionPlanState,
            {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
            "Initial state is not set correctly",
        );
    });

    test("Should register RPC handlers", () => {
        const rpcHandlers = (controller as any)._rpcHandlers;

        assert.ok(
            "getExecutionPlan" in rpcHandlers,
            "'getExecutionPlan' handler not registered",
        );
        assert.ok(
            "saveExecutionPlan" in rpcHandlers,
            "'saveExecutionPlan' handler not registered",
        );
        assert.ok(
            "showPlanXml" in rpcHandlers,
            "'showPlanXml' handler not registered",
        );
        assert.ok(
            "showQuery" in rpcHandlers,
            "'showQuery' handler not registered",
        );
        assert.ok(
            "updateTotalCost" in rpcHandlers,
            "'updateTotalCost' handler not registered",
        );
    });

    test("Should handle 'saveExecutionPlan' action", async () => {
        const saveExecutionPlanStub = sandbox.stub();
        const reducer = (controller as any)._rpcHandlers.saveExecutionPlan;

        await reducer(controller.state, { filePath: "path/to/save" });
        assert.ok(
            saveExecutionPlanStub.called,
            "'saveExecutionPlan' reducer not invoked correctly",
        );
    });

    test("Should handle 'showPlanXml' action", async () => {
        const showPlanXmlStub = sandbox.stub();
        const reducer = (controller as any)._rpcHandlers.showPlanXml;

        await reducer(controller.state, { xmlContents: "<PlanXml>" });
        assert.ok(
            showPlanXmlStub.called,
            "'showPlanXml' reducer not invoked correctly",
        );
    });

    test("Should handle 'updateTotalCost' action", async () => {
        const reducer = (controller as any)._rpcHandlers.updateTotalCost;
        const newState = await reducer(controller.state, { totalCost: 100 });

        assert.strictEqual(
            newState.executionPlanState.totalCost,
            100,
            "'updateTotalCost' reducer did not update state correctly",
        );
    });

    test("Should dispose properly", () => {
        const disposeStub = sandbox
            .stub(controller as any, "_disposables")
            .value([{ dispose: sandbox.stub() }]);
        controller.dispose();
        assert.ok(
            disposeStub[0].dispose.called,
            "Disposables not cleaned up on dispose",
        );
    });
});
