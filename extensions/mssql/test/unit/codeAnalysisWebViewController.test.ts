/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { expect } from "chai";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { CodeAnalysisWebViewController } from "../../src/codeAnalysis/codeAnalysisWebViewController";
import { CodeAnalysis as ExtLoc } from "../../src/constants/locConstants";
import { LocConstants as ReactLoc } from "../../src/reactviews/common/locConstants";
import { stubTelemetry, stubVscodeWrapper, stubWebviewPanel } from "./utils";

chai.use(sinonChai);

suite("CodeAnalysisWebViewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: CodeAnalysisWebViewController;
    let contextStub: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;

    setup(() => {
        sandbox = sinon.createSandbox();
        vscodeWrapperStub = stubVscodeWrapper(sandbox);

        contextStub = {
            extensionUri: vscode.Uri.parse("file://ProjectPath"),
            extensionPath: "ProjectPath",
            subscriptions: [],
        } as vscode.ExtensionContext;
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(projectPath = "c:/work/TestProject.sqlproj") {
        const telemetryStubs = stubTelemetry(sandbox);
        const panelStub = stubWebviewPanel(sandbox);
        sandbox.stub(vscode.window, "createWebviewPanel").returns(panelStub);

        controller = new CodeAnalysisWebViewController(contextStub, vscodeWrapperStub, projectPath);

        return {
            panelStub,
            telemetryStubs,
        };
    }

    test("constructor initializes state and loads code analysis rules", () => {
        createController("c:/work/MyProject.sqlproj");

        expect(controller.state.projectFilePath).to.equal("c:/work/MyProject.sqlproj");
        expect(controller.state.projectName).to.equal("MyProject");
        expect(controller.state.isLoading).to.be.false;
        expect(controller.state.hasChanges).to.be.false;
        expect(controller.state.errorMessage).to.be.undefined;
        expect(controller.state.rules).to.be.an("array");
        expect(controller.state.rules.length).to.be.greaterThan(0);
    });

    test("opens dialog with icon paths and project-based header context", () => {
        const panelStub = stubWebviewPanel(sandbox);
        const createWebviewPanelStub = sandbox
            .stub(vscode.window, "createWebviewPanel")
            .returns(panelStub);
        stubTelemetry(sandbox);

        controller = new CodeAnalysisWebViewController(
            contextStub,
            vscodeWrapperStub,
            "c:/work/MyProject.sqlproj",
        );

        expect(createWebviewPanelStub).to.have.been.calledOnce;
        expect(createWebviewPanelStub).to.have.been.calledWithMatch(
            "mssql-react-webview",
            ExtLoc.Title,
            sinon.match({ viewColumn: vscode.ViewColumn.Active }),
            sinon.match.object,
        );

        const iconPath = panelStub.iconPath as { dark: vscode.Uri; light: vscode.Uri };
        expect(iconPath.dark.path).to.contain("/media/codeAnalysis_dark.svg");
        expect(iconPath.light.path).to.contain("/media/codeAnalysis_light.svg");

        const headerTitle = ReactLoc.getInstance().codeAnalysis.codeAnalysisTitle(
            controller.state.projectName,
        );
        expect(headerTitle).to.equal("Code Analysis - MyProject");
    });
});
