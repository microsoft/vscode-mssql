/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDashboardTable, IProjectProvider, WorkspaceTreeItem } from "dataworkspace";
import "mocha";
import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { WorkspaceTreeDataProvider } from "../src/common/workspaceTreeDataProvider";
import { WorkspaceService } from "../src/services/workspaceService";
import { MockTreeDataProvider } from "./projectProviderRegistry.test";

suite("workspaceTreeDataProvider Tests", function (): void {
  let sandbox: sinon.SinonSandbox;
  const workspaceService = new WorkspaceService();
  const treeProvider = new WorkspaceTreeDataProvider(workspaceService);

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test("test refresh()", async () => {
    const treeDataChangeHandler = sandbox.stub();
    treeProvider.onDidChangeTreeData!((e) => {
      treeDataChangeHandler(e);
    });
    await treeProvider.refresh();
    expect(treeDataChangeHandler.calledOnce).to.be.true;
  });

  test("test getTreeItem()", async function (): Promise<void> {
    const getTreeItemStub = sandbox.stub();
    await treeProvider.getTreeItem({
      treeDataProvider: {
        getTreeItem: (arg: WorkspaceTreeItem) => {
          return getTreeItemStub(arg);
        },
      } as vscode.TreeDataProvider<any>,
    } as WorkspaceTreeItem);
    expect(getTreeItemStub.calledOnce).to.be.true;
  });

  test("test getChildren() for non-root element", async () => {
    const getChildrenStub = sandbox.stub().resolves([]);
    const element = {
      treeDataProvider: {
        getChildren: (arg: any) => {
          return getChildrenStub(arg);
        },
      } as vscode.TreeDataProvider<any>,
      element: "obj1",
    };
    const children = await treeProvider.getChildren(element);
    expect(children.length, "children count should be 0").to.equal(0);
    expect(getChildrenStub.calledWithExactly("obj1"), "getChildren parameter should be obj1").to.be
      .true;
  });

  test("test getChildren() for root element", async () => {
    const getProjectsInWorkspaceStub = sandbox
      .stub(workspaceService, "getProjectsInWorkspace")
      .resolves([
        vscode.Uri.file("test/proj1/proj1.sqlproj"),
        vscode.Uri.file("test/proj2/proj2.csproj"),
      ]);
    const treeDataProvider = new MockTreeDataProvider();
    const projectProvider: IProjectProvider = {
      supportedProjectTypes: [
        {
          id: "sp1",
          projectFileExtension: "sqlproj",
          icon: "",
          displayName: "sql project",
          description: "",
        },
      ],
      getProjectTreeDataProvider: (
        projectFile: vscode.Uri,
      ): Promise<vscode.TreeDataProvider<any>> => {
        return Promise.resolve(treeDataProvider);
      },
      createProject: (name: string, location: vscode.Uri): Promise<vscode.Uri> => {
        return Promise.resolve(location);
      },
      projectToolbarActions: [
        {
          id: "Add",
          run: async (): Promise<any> => {
            return Promise.resolve();
          },
        },
        {
          id: "Schema Compare",
          run: async (): Promise<any> => {
            return Promise.resolve();
          },
        },
        {
          id: "Build",
          run: async (): Promise<any> => {
            return Promise.resolve();
          },
        },
        {
          id: "Publish",
          run: async (): Promise<any> => {
            return Promise.resolve();
          },
        },
        {
          id: "Target Version",
          run: async (): Promise<any> => {
            return Promise.resolve();
          },
        },
      ],
      getDashboardComponents: (projectFile: string): IDashboardTable[] => {
        return [
          {
            name: "Deployments",
            columns: [{ displayName: "c1", width: 75, type: "string" }],
            data: [["d1"]],
          },
          {
            name: "Builds",
            columns: [{ displayName: "c1", width: 75, type: "string" }],
            data: [["d1"]],
          },
        ];
      },
    };
    const getProjectProviderStub = sandbox.stub(workspaceService, "getProjectProvider");
    getProjectProviderStub.onFirstCall().resolves(undefined);
    getProjectProviderStub.onSecondCall().resolves(projectProvider);
    sandbox.stub(treeDataProvider, "getChildren").resolves(["treeitem1"]);
    const showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");
    const children = await treeProvider.getChildren(undefined);
    expect(children.length, "there should be 1 tree item returned").to.equal(1);
    expect(children[0].element).to.equal("treeitem1");
    expect(getProjectsInWorkspaceStub.calledOnce, "getProjectsInWorkspaceStub should be called").to
      .be.true;
    expect(getProjectProviderStub.calledTwice, "getProjectProvider should be called twice").to.be
      .true;
    expect(showErrorMessageStub.calledOnce, "showErrorMessage should be called once").to.be.true;
  });
});
