/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as Constants from "../../src/constants/constants";
import {
    DEFAULT_TRACE_FOLDER_NAME,
    DEFAULT_TRACE_MAX_FILE_SIZE_MB,
    getConfiguredTraceFolder,
    getTraceMaxFileSizeMBSetting,
} from "../../src/copilot/inlineCompletionDebug/tracePersistence";
import { MAX_TRACE_FILE_SIZE_MB } from "../../src/copilot/inlineCompletionDebug/traceSerializer";

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

    test("clamps the configured trace size to the limit that loading enforces", () => {
        expect(maxFileSizeMBFor(500)).to.equal(MAX_TRACE_FILE_SIZE_MB);
        expect(maxFileSizeMBFor(MAX_TRACE_FILE_SIZE_MB)).to.equal(MAX_TRACE_FILE_SIZE_MB);
        expect(maxFileSizeMBFor(20)).to.equal(20);
    });

    test("falls back to the default trace size for invalid values", () => {
        expect(maxFileSizeMBFor(0)).to.equal(DEFAULT_TRACE_MAX_FILE_SIZE_MB);
        expect(maxFileSizeMBFor(-5)).to.equal(DEFAULT_TRACE_MAX_FILE_SIZE_MB);
        expect(maxFileSizeMBFor(Number.NaN)).to.equal(DEFAULT_TRACE_MAX_FILE_SIZE_MB);
        expect(maxFileSizeMBFor("64")).to.equal(DEFAULT_TRACE_MAX_FILE_SIZE_MB);
        expect(DEFAULT_TRACE_MAX_FILE_SIZE_MB).to.be.at.most(MAX_TRACE_FILE_SIZE_MB);
    });

    function maxFileSizeMBFor(configured: unknown): number {
        sandbox.restore();
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: (key: string, defaultValue?: unknown) =>
                key === Constants.configCopilotInlineCompletionsTraceMaxFileSizeMB
                    ? configured
                    : defaultValue,
        } as unknown as vscode.WorkspaceConfiguration);
        return getTraceMaxFileSizeMBSetting();
    }
});
