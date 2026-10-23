/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { previewService } from "../../src/previews/previewService";
import { isQueryStudioResource } from "../../src/queryStudio/queryStudioFeatureGate";
import {
    QUERY_STUDIO_VIEW_TYPE,
    registerQueryStudio,
} from "../../src/queryStudio/queryStudioEditorProvider";

suite("Query Studio activation contribution", () => {
    const sandbox = sinon.createSandbox();
    teardown(() => sandbox.restore());

    test("associates only .mssql and gives it the existing SQL language support", () => {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
        );
        const editor = manifest.contributes.customEditors.find(
            (item: { viewType: string }) => item.viewType === QUERY_STUDIO_VIEW_TYPE,
        );
        expect(editor.selector).to.deep.equal([{ filenamePattern: "*.mssql" }]);
        expect(editor.priority).to.equal("default");
        const language = manifest.contributes.languages.find(
            (item: { id: string }) => item.id === "sql",
        );
        expect(language.extensions).to.include.members([".sql", ".mssql"]);
        const settings = manifest.contributes.configuration.flatMap(
            (group: { properties?: Record<string, unknown> }) =>
                Object.keys(group.properties ?? {}),
        );
        expect(
            settings.filter((key: string) =>
                /^mssql\.queryStudio\.(spatial|vectorWorkbench|replay)(\.|$)/.test(key),
            ),
        ).to.deep.equal([]);
    });

    test("accepts untitled and remote .mssql documents but excludes ordinary SQL files", () => {
        for (const uri of [
            "untitled:Untitled-1",
            "file:///query.mssql",
            "vscode-remote://host/query.MSSQL",
        ]) {
            expect(isQueryStudioResource(vscode.Uri.parse(uri)), uri).to.equal(true);
        }
        for (const uri of [
            "file:///query.sql",
            "file:///query.mssql.sql",
            "file:///query.mssql.bak",
        ]) {
            expect(isQueryStudioResource(vscode.Uri.parse(uri)), uri).to.equal(false);
        }
    });

    test("falls back to the text editor when the preview is disabled without changing settings", async () => {
        sandbox.stub(previewService, "isPrivatePreviewEnabled").returns(false);
        const register = sandbox
            .stub(vscode.window, "registerCustomEditorProvider")
            .returns({ dispose() {} });
        const execute = sandbox.stub(vscode.commands, "executeCommand").resolves();
        const registerCommand = sandbox.stub(vscode.commands, "registerCommand");
        registerQueryStudio({ subscriptions: [] } as unknown as vscode.ExtensionContext);
        const provider = register.firstCall.args[1] as vscode.CustomTextEditorProvider;
        const uri = vscode.Uri.parse("file:///query.mssql");
        const dispose = sandbox.spy();
        await provider.resolveCustomTextEditor(
            { uri } as vscode.TextDocument,
            { viewColumn: vscode.ViewColumn.One, dispose } as unknown as vscode.WebviewPanel,
            new vscode.CancellationTokenSource().token,
        );
        sinon.assert.calledWith(execute, "vscode.openWith", uri, "default", {
            viewColumn: vscode.ViewColumn.One,
        });
        sinon.assert.calledOnce(dispose);
        sinon.assert.notCalled(registerCommand);
    });
    test("activates when VS Code restores or opens the custom editor", () => {
        const packageJsonPath = path.join(__dirname, "..", "..", "..", "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
            activationEvents?: string[];
        };

        expect(packageJson.activationEvents).to.include(`onCustomEditor:${QUERY_STUDIO_VIEW_TYPE}`);
    });
});
