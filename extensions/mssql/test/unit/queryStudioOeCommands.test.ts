/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { previewService } from "../../src/previews/previewService";
import { registerOeV2NativeCommands } from "../../src/objectExplorer/v2/commands/oeV2NativeCommands";
import { OeV2TreeController } from "../../src/objectExplorer/v2/tree/oeV2TreeController";
import { OeV2Node } from "../../src/objectExplorer/v2/tree/oeV2Node";

suite("Query Studio native OE delivery", () => {
    const sandbox = sinon.createSandbox();
    teardown(() => sandbox.restore());

    function fixture(preventAutoExecute = false) {
        const get = sandbox.stub();
        get.withArgs("mssql.query.preventAutoExecuteScript", false).returns(preventAutoExecute);
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get,
        } as unknown as vscode.WorkspaceConfiguration);
        const handlers = new Map<string, (node: OeV2Node) => Promise<void>>();
        sandbox.stub(vscode.commands, "registerCommand").callsFake((id, handler) => {
            handlers.set(id, handler);
            return { dispose() {} };
        });
        const execute = sandbox.stub(vscode.commands, "executeCommand").resolves();
        const enabled = sandbox.stub(previewService, "isPrivatePreviewEnabled").returns(true);
        sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
        const controller = sandbox.createStubInstance(OeV2TreeController);
        controller.scriptObject.resolves({ script: "ALTER VIEW [dbo].[v] AS SELECT 1 AS n;" });
        registerOeV2NativeCommands(
            { subscriptions: [] } as unknown as vscode.ExtensionContext,
            () => controller,
        );
        const node = {
            kind: "object",
            connectionId: "saved-profile-id",
            database: "AppDb",
            schema: "sales]x",
            objectName: "T]x",
            capabilities: { canSelectTop: true, canScriptAlter: true },
        } as OeV2Node;
        return { handlers, execute, enabled, controller, node };
    }

    test("SELECT TOP keeps v1's 1000 rows, quotes identifiers, and carries connection identity", async () => {
        const { handlers, execute, node } = fixture();
        await handlers.get("mssql.objectExplorerV2.selectTop")!(node);
        const [command, payload] = execute.lastCall.args;
        expect(command).to.equal("mssql.queryStudio.newQueryFromContext");
        expect(payload).to.include({
            profileId: node.connectionId,
            database: "AppDb",
            autoRun: true,
        });
        expect(payload.initialSql).to.include("TOP 1000").and.include("[sales]]x].[T]]x]");
    });

    test("ALTER opens a script for review without running it, and unsupported operations are inert", async () => {
        const { handlers, execute, controller, node } = fixture();
        await handlers.get("mssql.objectExplorerV2.scriptAlter")!(node);
        sinon.assert.calledWith(controller.scriptObject, node, "alter");
        expect(execute.lastCall.args[1]).to.include({
            initialSql: "ALTER VIEW [dbo].[v] AS SELECT 1 AS n;",
        });
        expect(execute.lastCall.args[1]).not.to.have.property("autoRun");
        controller.scriptObject.resetHistory();
        execute.resetHistory();
        await handlers.get("mssql.objectExplorerV2.scriptExecute")!(node);
        sinon.assert.notCalled(controller.scriptObject);
        sinon.assert.notCalled(execute);
    });

    test("SELECT TOP respects the existing auto-execution preference and object capability", async () => {
        const { handlers, execute, node } = fixture(true);
        await handlers.get("mssql.objectExplorerV2.selectTop")!(node);
        expect(execute.lastCall.args[1]).to.include({ autoRun: false });
        execute.resetHistory();
        await handlers.get("mssql.objectExplorerV2.selectTop")!({
            ...node,
            capabilities: { ...node.capabilities, canSelectTop: false },
        } as OeV2Node);
        sinon.assert.notCalled(execute);
    });

    test("preview disabled blocks native query delivery and scripting", async () => {
        const { handlers, execute, enabled, controller, node } = fixture();
        enabled.returns(false);
        await handlers.get("mssql.objectExplorerV2.selectTop")!(node);
        await handlers.get("mssql.objectExplorerV2.scriptAlter")!(node);
        sinon.assert.notCalled(execute);
        sinon.assert.notCalled(controller.scriptObject);
    });
});
