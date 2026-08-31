/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as LocConstants from "../../src/constants/locConstants";
import { DiagnosticsManager } from "../../src/diagnostics/diagnosticsManager";
import { stubExtensionContext } from "./utils";

suite("DiagnosticsManager private preview", () => {
    let sandbox: sinon.SinonSandbox;
    let context: vscode.ExtensionContext;
    let settings: Map<string, unknown>;
    let handlers: Map<string, (...args: unknown[]) => unknown>;
    let configuration: vscode.WorkspaceConfiguration;

    setup(() => {
        sandbox = sinon.createSandbox();
        context = stubExtensionContext(sandbox, { version: "1.0.0" });
        settings = new Map<string, unknown>();
        handlers = new Map<string, (...args: unknown[]) => unknown>();

        configuration = {
            get: sandbox
                .stub()
                .callsFake((key: string, defaultValue?: unknown) =>
                    settings.has(key) ? settings.get(key) : defaultValue,
                ),
            update: sandbox.stub().resolves(),
            has: sandbox.stub().returns(false),
            inspect: sandbox.stub().returns(undefined),
        } as unknown as vscode.WorkspaceConfiguration;

        sandbox.stub(vscode.workspace, "getConfiguration").returns(configuration);
        sandbox
            .stub(vscode.workspace, "onDidChangeConfiguration")
            .returns({ dispose: sandbox.stub() });
        sandbox.stub(vscode.extensions, "getExtension").returns(undefined);
        sandbox
            .stub(vscode.commands, "registerCommand")
            .callsFake((command: string, handler: (...args: unknown[]) => unknown) => {
                handlers.set(command, handler);
                return { dispose: sandbox.stub() };
            });
        sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("does not allow a live setting change to bypass the activation snapshot", () => {
        settings.set("enableExperimentalFeatures", true);
        settings.set("mssql.sessionDiag.enabled", true);
        const manager = new DiagnosticsManager(context, {
            debugConsoleActiveAtActivation: false,
            sessionDiagnosticsActiveAtActivation: false,
        });

        expect(manager.storeActive).to.be.false;
        expect(() => manager.applyCaptureMode("redacted")).to.throw(
            LocConstants.SessionDiag.privatePreviewRequired,
        );
        expect(vscode.commands.registerCommand).to.not.have.been.calledWith(
            "mssql.sessionDiag.enable",
        );

        manager.dispose();
    });

    test("fails closed when a registered command outlives its live gate", async () => {
        settings.set("enableExperimentalFeatures", true);
        settings.set("mssql.sessionDiag.enabled", false);
        const manager = new DiagnosticsManager(context, {
            debugConsoleActiveAtActivation: false,
            sessionDiagnosticsActiveAtActivation: true,
        });

        const handler = handlers.get("mssql.sessionDiag.enable");
        expect(handler).to.not.be.undefined;
        await handler!();

        expect(vscode.window.showInformationMessage).to.have.been.calledWith(
            LocConstants.SessionDiag.privatePreviewRequired,
        );
        expect(configuration.update).to.not.have.been.called;

        manager.dispose();
    });

    test("shows capture status without linking to a disabled Debug Console", () => {
        settings.set("enableExperimentalFeatures", true);
        settings.set("mssql.sessionDiag.enabled", false);
        settings.set("mssql.debugConsole.enabled", false);
        const statusItem = {
            name: "",
            text: "",
            tooltip: undefined,
            command: undefined,
            backgroundColor: undefined,
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
        } as unknown as vscode.StatusBarItem;
        sandbox.stub(vscode.window, "createStatusBarItem").returns(statusItem);
        const manager = new DiagnosticsManager(context, {
            debugConsoleActiveAtActivation: false,
            sessionDiagnosticsActiveAtActivation: true,
        });

        settings.set("mssql.sessionDiag.enabled", true);
        manager.updateStatusItem();

        expect(statusItem.command).to.be.undefined;
        expect(statusItem.tooltip).to.equal(LocConstants.SessionDiag.statusOffTooltipNoConsole);
        expect(statusItem.show).to.have.been.called;

        manager.dispose();
    });
});
