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
import { CodeAnalysisRuleInfo, GetCodeAnalysisRulesResult } from "vscode-mssql";
import { CodeAnalysisRuleSeverity } from "../../src/enums";
import { SqlCodeAnalysisRule } from "../../src/sharedInterfaces/codeAnalysis";
import { stubTelemetry, stubVscodeWrapper, stubWebviewPanel } from "./utils";

chai.use(sinonChai);

const mockRules: CodeAnalysisRuleInfo[] = [
    {
        ruleId: "SR0001",
        shortRuleId: "SR0001",
        displayName: "Error Rule",
        description: "desc",
        category: "Design",
        severity: "Error",
        ruleScope: "Element",
    },
    {
        ruleId: "SR0002",
        shortRuleId: "SR0002",
        displayName: "Disabled Rule",
        description: "desc",
        category: "Performance",
        severity: "None",
        ruleScope: "Model",
    },
    {
        ruleId: "SR0003",
        shortRuleId: "SR0003",
        displayName: "Warning Rule",
        description: "desc",
        category: "Naming",
        severity: "Warning",
        ruleScope: "Model",
    },
];

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
            rules: mockRules,
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
            fetchRulesFromDacFx: () => Promise<SqlCodeAnalysisRule[]>;
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
        // TODO: Currently false because loadRules() uses placeholder data that resolves synchronously.
        // Once loadRules() makes a real async service call, this should be true immediately
        // after construction (before the rules response arrives).
        expect(controller.state.isLoading).to.be.false;
        expect(controller.state.hasChanges).to.be.false;
        expect(controller.state.message).to.be.undefined;
        expect(controller.state.rules).to.be.an("array");
        expect(controller.state.rules.length).to.equal(mockRules.length);
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
        // Set up the infinite promise BEFORE creating the controller so the
        // constructor's void loadRules() is suspended on the same gate.
        let resolveLoad: ((value: GetCodeAnalysisRulesResult) => void) | undefined;
        dacFxServiceStub.getCodeAnalysisRules.returns(
            new Promise<GetCodeAnalysisRulesResult>((resolve) => {
                resolveLoad = resolve;
            }),
        );

        createController();

        const loadingStates: boolean[] = [];
        const updateStateStub = sandbox.stub(controller, "updateState").callsFake(() => {
            loadingStates.push(controller.state.isLoading);
        });

        resolveLoad?.({
            success: true,
            errorMessage: undefined,
            rules: [],
        } as GetCodeAnalysisRulesResult);

        // Flush the microtask queue so the constructor's loadRules continuation runs.
        await new Promise((r) => setTimeout(r, 0));

        expect(updateStateStub.callCount).to.equal(1);
        expect(loadingStates).to.deep.equal([false]);
    });

    test("fetchRulesFromDacFx maps Error/None/Warning severities and sets enabled correctly", async () => {
        createController();
        const rules = await getInternalController().fetchRulesFromDacFx();

        const [errorRule, disabledRule, defaultRule] = rules;

        expect(errorRule.severity).to.equal(CodeAnalysisRuleSeverity.Error);
        expect(errorRule.enabled).to.be.true;
        expect(errorRule.ruleId).to.equal("SR0001");
        expect(errorRule.category).to.equal("Design");
        expect(errorRule.ruleScope).to.equal("Element");

        expect(disabledRule.severity).to.equal(CodeAnalysisRuleSeverity.Disabled);
        expect(disabledRule.enabled).to.be.false;

        expect(defaultRule.severity).to.equal(CodeAnalysisRuleSeverity.Warning);
        expect(defaultRule.enabled).to.be.true;
    });

    test("loadRules catches fetchRulesFromDacFx errors and sets error state", async () => {
        createController();
        const internalController = getInternalController();
        sandbox
            .stub(internalController, "fetchRulesFromDacFx")
            .rejects(new Error("mapping failure"));

        await internalController.loadRules();

        expect(controller.state.isLoading).to.be.false;
        expect(controller.state.message?.intent).to.equal("error");
        expect(controller.state.message?.message).to.contain("mapping failure");
    });

    test("loadRules sets errorMessage from service directly in state when success is false", async () => {
        createController();
        const internalController = getInternalController();

        // With an explicit error message from the service
        dacFxServiceStub.getCodeAnalysisRules.resolves({
            success: false,
            errorMessage: "Service unavailable",
            rules: [],
        } as GetCodeAnalysisRulesResult);

        await internalController.loadRules();

        expect(controller.state.isLoading).to.be.false;
        expect(controller.state.message?.message).to.equal("Service unavailable");
        expect(controller.state.message?.intent).to.equal("error");

        // Without errorMessage — should fall back to the default locale string
        dacFxServiceStub.getCodeAnalysisRules.resolves({
            success: false,
            errorMessage: undefined,
            rules: [],
        } as GetCodeAnalysisRulesResult);

        await internalController.loadRules();

        expect(controller.state.message?.message).to.equal(ExtLoc.failedToLoadRules);
        expect(controller.state.message?.intent).to.equal("error");
    });

    test("closeMessage reducer clears the message from state", async () => {
        createController();
        const internalController = getInternalController();
        const closeMessageHandler = internalController._reducerHandlers.get("closeMessage");

        expect(closeMessageHandler).to.not.be.undefined;

        const stateWithMessage = {
            ...controller.state,
            message: { message: "some error", intent: "error" as const },
        };
        const newState = (await closeMessageHandler?.(
            stateWithMessage,
            {},
        )) as typeof stateWithMessage;

        expect(newState.message).to.be.undefined;
    });
});
