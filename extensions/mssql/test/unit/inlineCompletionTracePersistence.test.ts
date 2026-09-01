/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import {
    DEFAULT_TRACE_FOLDER_NAME,
    getConfiguredTraceFolder,
} from "../../src/copilot/inlineCompletionDebug/tracePersistence";

suite("Inline completion trace persistence", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => sandbox.restore());

    test("relative configured trace folders fall back to extension storage", () => {
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: () => "relative/traces",
        } as unknown as vscode.WorkspaceConfiguration);
        const context = {
            globalStorageUri: vscode.Uri.file("C:\\mssql-test-storage"),
        } as vscode.ExtensionContext;

        expect(getConfiguredTraceFolder(context)).to.equal(
            vscode.Uri.joinPath(context.globalStorageUri, DEFAULT_TRACE_FOLDER_NAME).fsPath,
        );
    });
});
