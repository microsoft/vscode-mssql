/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import type * as dataworkspace from "dataworkspace";
import { WorkspaceTreeDataProvider } from "../../src/dataWorkspace/common/workspaceTreeDataProvider";
import { IWorkspaceService } from "../../src/dataWorkspace/common/interfaces";
import { TelemetryReporter } from "../../src/dataWorkspace/common/telemetry";

chai.use(sinonChai);
const { expect } = chai;

suite("WorkspaceTreeDataProvider", function (): void {
    let sandbox: sinon.SinonSandbox;

    setup(function (): void {
        sandbox = sinon.createSandbox();
        sandbox.stub(TelemetryReporter, "sendMetricsEvent");
    });

    teardown(function (): void {
        sandbox.restore();
    });

    test("Should reveal and select an item in a collapsed project hierarchy", async function (): Promise<void> {
        const projectFile = vscode.Uri.file("C:\\test\\Project.sqlproj");
        const file = vscode.Uri.file("C:\\test\\dbo\\Tables\\Customer.sql");
        const rootElement = { projectFileUri: projectFile };
        const fileElement = { fileSystemUri: file };
        const revealStub = sandbox.stub().resolves();
        sandbox.stub(vscode.window, "createTreeView").returns({
            reveal: revealStub,
        } as unknown as vscode.TreeView<dataworkspace.WorkspaceTreeItem>);
        sandbox.stub(vscode.commands, "executeCommand").resolves();

        const projectTreeDataProvider: dataworkspace.IProjectTreeDataProvider = {
            getTreeItem: () => new vscode.TreeItem("item"),
            getChildren: (element?: unknown) => (element ? [] : [rootElement]),
            getParent: (element: unknown) => (element === fileElement ? rootElement : undefined),
            findItem: () => fileElement,
        };
        const projectProvider = {
            getProjectTreeDataProvider: sandbox.stub().resolves(projectTreeDataProvider),
        } as unknown as dataworkspace.IProjectProvider;
        const workspaceService = {
            onDidWorkspaceProjectsChange: sandbox.stub().returns({ dispose: sandbox.stub() }),
            getProjectsInWorkspace: sandbox.stub().resolves([projectFile]),
            getProjectProvider: sandbox.stub().resolves(projectProvider),
        } as unknown as IWorkspaceService;
        const provider = new WorkspaceTreeDataProvider(workspaceService);
        await provider.getChildren();

        const revealed = await provider.revealProjectItem(projectFile, file);

        expect(revealed).to.be.true;
        expect(revealStub).to.have.been.calledOnce;
        const revealedItem = revealStub.firstCall.args[0] as dataworkspace.WorkspaceTreeItem;
        expect(revealedItem.element).to.equal(fileElement);
        expect(revealStub.firstCall.args[1]).to.deep.equal({
            select: true,
            focus: true,
            expand: true,
        });
        expect((await provider.getParent(revealedItem))?.element).to.equal(rootElement);
    });
});
