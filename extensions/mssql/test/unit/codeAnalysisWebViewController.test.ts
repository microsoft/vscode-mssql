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
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { DacFxService } from "../../src/services/dacFxService";
import { GetCodeAnalysisRulesResult } from "vscode-mssql";
import { stubTelemetry, stubVscodeWrapper, stubWebviewPanel } from "./utils";

chai.use(sinonChai);

suite("CodeAnalysisWebViewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: CodeAnalysisWebViewController;
    let contextStub: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let dacFxServiceStub: sinon.SinonStubbedInstance<DacFxService>;

    setup(() => {
        sandbox = sinon.createSandbox();
        vscodeWrapperStub = stubVscodeWrapper(sandbox);
        dacFxServiceStub = sandbox.createStubInstance(DacFxService);

        dacFxServiceStub.getCodeAnalysisRules.resolves({
            success: true,
            errorMessage: undefined,
            rules: [
                {
                    ruleId: "Microsoft.Rules.Data.SR0001",
                    shortRuleId: "SR0001",
                    displayName: "Avoid SELECT *",
                    description: "Avoid wildcard selects",
                    category: "Design",
                    severity: "Warning",
                    ruleScope: "Model",
                },
            ],
        } as GetCodeAnalysisRulesResult);

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

        controller = new CodeAnalysisWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
            dacFxServiceStub,
        );

        return {
            panelStub,
            telemetryStubs,
        };
    }

    function getInternalController() {
        return controller as unknown as {
            loadRules: () => Promise<void>;
            _reducerHandlers: Map<
                string,
                (state: unknown, payload: unknown) => Promise<unknown> | unknown
            >;
        };
    }

    test("constructor initializes state and loads code analysis rules", async () => {
        createController("c:/work/MyProject.sqlproj");
        await getInternalController().loadRules();

        expect(controller.state.projectFilePath).to.equal("c:/work/MyProject.sqlproj");
        expect(controller.state.projectName).to.equal("MyProject");
        expect(controller.state.isLoading).to.be.false;
        expect(controller.state.hasChanges).to.be.false;
        expect(controller.state.message).to.be.undefined;
        expect(controller.state.rules).to.be.an("array");
        expect(controller.state.rules.length).to.equal(1);
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
            dacFxServiceStub,
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

    test("close reducer handler disposes the webview panel", async () => {
        const { panelStub } = createController();
        const internalController = getInternalController();
        const closeHandler = internalController._reducerHandlers.get("close");

        expect(closeHandler).to.not.be.undefined;
        await closeHandler?.(controller.state, {});

        expect(panelStub.dispose).to.have.been.calledOnce;
    });

    test("loadRules handles errors, sets message, and fires error telemetry", async () => {
        const { telemetryStubs } = createController();
        const internalController = getInternalController();
        dacFxServiceStub.getCodeAnalysisRules.rejects(new Error("load error"));

        telemetryStubs.sendErrorEvent.resetHistory();

        await internalController.loadRules();

        expect(controller.state.isLoading).to.be.false;
        expect(controller.state.message?.message).to.equal("load error");
        expect(controller.state.message?.intent).to.equal("error");
        expect(telemetryStubs.sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.SqlProjects,
            TelemetryActions.CodeAnalysisRulesLoadError,
            sinon.match.instanceOf(Error),
            false,
        );
    });

    test("successful rules load fires CodeAnalysisRulesLoaded telemetry event", async () => {
        const { telemetryStubs } = createController();
        const internalController = getInternalController();

        telemetryStubs.sendActionEvent.resetHistory();

        await internalController.loadRules();

        expect(telemetryStubs.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.SqlProjects,
            TelemetryActions.CodeAnalysisRulesLoaded,
            sinon.match.has("ruleCount"),
        );
    });

    test("isLoading state transitions correctly during loadRules", async () => {
        createController();
        const internalController = getInternalController();

        let resolveLoad: ((value: GetCodeAnalysisRulesResult) => void) | undefined;
        dacFxServiceStub.getCodeAnalysisRules.returns(
            new Promise<GetCodeAnalysisRulesResult>((resolve) => {
                resolveLoad = resolve;
            }),
        );

        const loadingStates: boolean[] = [];
        const updateStateStub = sandbox.stub(controller, "updateState").callsFake(() => {
            loadingStates.push(controller.state.isLoading);
        });

        const loadPromise = internalController.loadRules();

        resolveLoad?.({
            success: true,
            errorMessage: undefined,
            rules: [],
        } as GetCodeAnalysisRulesResult);

        await loadPromise;

        expect(updateStateStub.callCount).to.equal(1);
        expect(loadingStates).to.deep.equal([false]);
    });
});
