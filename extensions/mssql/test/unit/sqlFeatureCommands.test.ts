/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import { capabilitiesFrom } from "sql-feature/core";
import { SqlDiagnosticsController } from "../../src/sqlDiagnostics/sqlDiagnosticsController";
import { SqlDiagnosticsWebviewController } from "../../src/sqlDiagnostics/sqlDiagnosticsWebviewController";
import { DiagnosticsSessionOpener } from "../../src/sqlDiagnostics/sessionOpener";
import { DataPlaneRunner } from "../../src/sqlDiagnostics/dataPlaneRunner";
import { ISqlSession } from "../../src/services/sqlDataPlane/api";
import { DiagnosticsSection } from "../../src/sharedInterfaces/sqlDiagnostics";
import { stubExtensionContext } from "./utils";
import { ITreeNodeInfo } from "vscode-mssql";

suite("SQL feature entry points", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: SqlDiagnosticsController;
    let opener: sinon.SinonStubbedInstance<DiagnosticsSessionOpener>;
    let capabilities: sinon.SinonStub;
    let commands: Map<string, (...args: unknown[]) => unknown>;
    let panels: {
        section: DiagnosticsSection;
        chooseDatabase: () => Promise<void>;
        panel: sinon.SinonStubbedInstance<SqlDiagnosticsWebviewController>;
    }[];
    let close: sinon.SinonStub;
    let openDatabase: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        commands = new Map();
        panels = [];
        sandbox.stub(vscode.commands, "registerCommand").callsFake((id, handler) => {
            commands.set(id, handler);
            return new vscode.Disposable(() => commands.delete(id));
        });
        opener = sandbox.createStubInstance(DiagnosticsSessionOpener);
        close = sandbox.stub().resolves();
        openDatabase = sandbox.stub().resolves(undefined);
        opener.open.resolves({
            session: { close } as unknown as ISqlSession,
            connectionKey: "connection-a",
            openDatabase,
            serverKey: "server-a",
            label: "Same display name",
        });
        capabilities = sandbox
            .stub(DataPlaneRunner.prototype, "capabilities")
            .resolves(capabilitiesFrom({ engineEditionId: 3, majorVersion: 16, database: "One" }));
        controller = new SqlDiagnosticsController(
            stubExtensionContext(sandbox),
            () => true,
            opener,
            (_context, _runner, _label, section, chooseDatabase) => {
                const panel = sandbox.createStubInstance(SqlDiagnosticsWebviewController);
                Object.defineProperty(panel, "onDisposed", { value: sandbox.stub() });
                panels.push({ section, panel, chooseDatabase });
                return panel;
            },
        );
    });

    teardown(() => {
        controller.dispose();
        sandbox.restore();
    });

    test("palette commands open independent features and the legacy command reuses activity", async () => {
        await commands.get("mssql.queryStore.open")!();
        await commands.get("mssql.sqlAgent.open")!();
        await commands.get("mssql.sqlActivity.open")!();
        expect(panels.map((entry) => entry.section)).to.deep.equal(["querystore", "agent", "dmv"]);
        await commands.get("mssql.sqlDiagnostics.open")!();
        expect(panels).to.have.length(3);
        expect(panels.find((entry) => entry.section === "dmv")!.panel.revealToForeground).to.have
            .been.called;
        expect(close).to.have.been.called;
    });

    test("Query Store separates databases but Agent reuses its connection-scoped panel", async () => {
        await controller.open("querystore");
        await controller.open("agent");
        capabilities.resolves(
            capabilitiesFrom({ engineEditionId: 3, majorVersion: 16, database: "Two" }),
        );
        await controller.open("querystore");
        await controller.open("agent");
        expect(panels.filter((entry) => entry.section === "querystore")).to.have.length(2);
        expect(panels.filter((entry) => entry.section === "agent")).to.have.length(1);
    });

    test("matching labels do not merge different connections", async () => {
        await controller.open("agent");
        opener.open.resolves({
            session: { close } as unknown as ISqlSession,
            connectionKey: "connection-b",
            openDatabase: sandbox.stub().resolves(undefined),
            serverKey: "server-a",
            label: "Same display name",
        });
        await controller.open("agent");
        expect(panels).to.have.length(2);
    });

    test("cancelled connection selection does not create a panel", async () => {
        opener.open.resolves(undefined);
        await controller.open("querystore");
        expect(panels).to.have.length(0);
    });

    test("database picker reuses the authenticated connection and opens the selected scope", async () => {
        sandbox
            .stub(DataPlaneRunner.prototype, "query")
            .resolves({ columns: [], rows: [{ name: "Chosen" }], truncated: false });
        sandbox.stub(vscode.window, "showQuickPick").resolves("Chosen" as never);
        openDatabase.callsFake(async (database: string) => {
            capabilities.resolves(
                capabilitiesFrom({ engineEditionId: 3, majorVersion: 16, database }),
            );
            return {
                session: { close } as unknown as ISqlSession,
                connectionKey: "connection-a",
                serverKey: "server-a",
                label: "Same display name",
                openDatabase,
            };
        });
        await controller.open("querystore");
        await panels[0].chooseDatabase();
        expect(openDatabase).to.have.been.calledWith("Chosen");
        expect(panels).to.have.length(2);
        expect(close).not.to.have.been.called;
    });

    test("cancelling the database picker leaves the original panel and session intact", async () => {
        sandbox
            .stub(DataPlaneRunner.prototype, "query")
            .resolves({ columns: [], rows: [{ name: "Chosen" }], truncated: false });
        sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
        await controller.open("querystore");
        await panels[0].chooseDatabase();
        expect(openDatabase).not.to.have.been.called;
        expect(close).not.to.have.been.called;
        expect(panels).to.have.length(1);
    });

    test("database context actions open the selected database with its connection profile", async () => {
        const profile = { id: "context-connection", server: "localhost", database: "master" };
        const node = {
            connectionProfile: profile,
            nodeType: "Database",
            metadata: { metadataTypeName: "Database", name: "SelectedDatabase" },
        } as unknown as ITreeNodeInfo;
        await commands.get("mssql.queryStore.open")!(node);
        expect(opener.open).to.have.been.calledWith(profile, "SelectedDatabase");
    });

    test("commands are contributed for palette and matching Object Explorer contexts", () => {
        // Resolve from the emitted test location as well as the source tree.
        const manifest = require("../../../package.json") as {
            contributes: {
                commands: { command: string }[];
                menus: Record<string, { command: string; when?: string }[]>;
            };
        };
        for (const id of [
            "mssql.sqlActivity.open",
            "mssql.queryStore.open",
            "mssql.sqlAgent.open",
        ]) {
            expect(
                manifest.contributes.commands.some((command) => command.command === id),
            ).to.equal(true);
            expect(commands.has(id)).to.equal(true);
            const action = manifest.contributes.menus["view/item/context"].find(
                (item) => item.command === id,
            );
            expect(action?.when).to.include("view == objectExplorer");
        }
    });

    test("failed discovery releases the opened session", async () => {
        capabilities.rejects(new Error("Unavailable"));
        sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
        await controller.open("querystore");
        expect(close).to.have.been.called;
        expect(panels).to.have.length(0);
    });
});
