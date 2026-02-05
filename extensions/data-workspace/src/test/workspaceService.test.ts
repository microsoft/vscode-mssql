/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "mocha";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import * as constants from "../common/constants";
import { WorkspaceService } from "../services/workspaceService";
import { ProjectProviderRegistry } from "../common/projectProviderRegistry";
import { createProjectProvider } from "./projectProviderRegistry.test";

/**
 * Create a stub for vscode.extensions.all
 * @param extensions extensions to return
 */
function stubAllExtensions(extensions: vscode.Extension<any>[]): sinon.SinonStub {
  return sinon.stub(vscode.extensions, "all").value(extensions);
}

function createMockExtension(
  id: string,
  isActive: boolean,
  projectTypes: string[] | undefined,
): { extension: vscode.Extension<any>; activationStub: sinon.SinonStub } {
  const activationStub = sinon.stub().resolves();
  const extension: vscode.Extension<any> = {
    id: id,
    isActive: isActive,
    packageJSON: {},
    activate: () => {
      return activationStub();
    },
  } as vscode.Extension<any>;
  extension.packageJSON.contributes =
    projectTypes === undefined ? undefined : { projects: projectTypes };
  return {
    extension: extension,
    activationStub: activationStub,
  };
}

suite("WorkspaceService", function (): void {
  let service = new WorkspaceService();

  this.afterEach(() => {
    sinon.restore();
  });

  test("getProjectsInWorkspace", async () => {
    // No workspace is loaded
    let projects = await service.getProjectsInWorkspace(undefined, true);
    expect(
      projects.length,
      `no projects should be returned when no workspace is loaded, but found ${projects.map((p) => p.fsPath).join(", ")}`,
    ).to.equal(0);

    // No projects are present in the workspace file
    const workspaceFoldersStub = sinon.stub(vscode.workspace, "workspaceFolders").value([]);
    projects = await service.getProjectsInWorkspace(undefined, true);
    expect(
      projects.length,
      "no projects should be returned when projects are present in the workspace file",
    ).to.equal(0);
    workspaceFoldersStub.restore();

    // Projects are present - Not in order
    sinon.stub(vscode.workspace, "workspaceFolders").value([{ uri: vscode.Uri.file("") }]);
    sinon
      .stub(service, "getAllProjectsInFolder")
      .resolves([
        vscode.Uri.file("/test/folder/folder2/abc2.sqlproj"),
        vscode.Uri.file("/test/folder/abc.sqlproj"),
        vscode.Uri.file("/test/folder/folder1/abc1.sqlproj"),
      ]);

    projects = await service.getProjectsInWorkspace(undefined, true);
    expect(projects.length, "there should be 3 projects").to.equal(3);
    const project1 = vscode.Uri.file("/test/folder/abc.sqlproj");
    const project2 = vscode.Uri.file("/test/folder/folder1/abc1.sqlproj");
    const project3 = vscode.Uri.file("/test/folder/folder2/abc2.sqlproj");

    // Verify if the projects are sorted correctly by their paths
    expect(projects[0].path).to.equal(project1.path);
    expect(projects[1].path).to.equal(project2.path);
    expect(projects[2].path).to.equal(project3.path);
  });

  test("getAllProjectTypes", async () => {
    // extensions that are already activated
    const extension1 = createMockExtension("ext1", true, ["csproj"]); // with projects contribution
    const extension2 = createMockExtension("ext2", true, []); // with empty projects contribution
    const extension3 = createMockExtension("ext3", true, undefined); // with no contributes in packageJSON

    // extensions that are still not activated
    const extension4 = createMockExtension("ext4", false, ["sqlproj"]); // with projects contribution
    const extension5 = createMockExtension("ext5", false, ["dbproj"]); // with projects contribution but activate() will throw error
    extension5.activationStub.throws(); // extension activation failure shouldn't cause the getAllProjectTypes() call to fail
    const extension6 = createMockExtension("ext6", false, undefined); // with no contributes in packageJSON
    const extension7 = createMockExtension("ext7", false, []); // with empty projects contribution

    stubAllExtensions(
      [extension1, extension2, extension3, extension4, extension5, extension6, extension7].map(
        (ext) => ext.extension,
      ),
    );

    // Mock workspace.findFiles to return project files so extensions get activated
    sinon.stub(vscode.workspace, "findFiles").callsFake((pattern: any) => {
      const patternStr = pattern.toString();
      if (patternStr.includes("sqlproj")) {
        return Promise.resolve([vscode.Uri.file("test.sqlproj")]);
      } else if (patternStr.includes("dbproj")) {
        return Promise.resolve([vscode.Uri.file("test.dbproj")]);
      }
      return Promise.resolve([]);
    });

    const provider1 = createProjectProvider(
      [
        {
          id: "tp1",
          description: "",
          projectFileExtension: "testproj",
          icon: "",
          displayName: "test project",
        },
        {
          id: "tp2",
          description: "",
          projectFileExtension: "testproj1",
          icon: "",
          displayName: "test project 1",
        },
      ],
      [
        {
          id: "testAction1",
          run: async (): Promise<any> => {
            return Promise.resolve();
          },
        },
        {
          id: "testAction2",
          run: async (): Promise<any> => {
            return Promise.resolve();
          },
        },
      ],
      [
        {
          name: "tableInfo1",
          columns: [{ displayName: "c1", width: 75, type: "string" }],
          data: [["d1"]],
        },
        {
          name: "tableInfo2",
          columns: [{ displayName: "c1", width: 75, type: "string" }],
          data: [["d1"]],
        },
      ],
    );
    const provider2 = createProjectProvider(
      [
        {
          id: "sp1",
          description: "",
          projectFileExtension: "sqlproj",
          icon: "",
          displayName: "sql project",
        },
      ],
      [
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
      [
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
      ],
    );
    sinon.stub(ProjectProviderRegistry, "providers").value([provider1, provider2]);
    sinon.stub(console, "error");
    const projectTypes = await service.getAllProjectTypes();
    expect(projectTypes.length).to.equal(3);
    expect(projectTypes[0].projectFileExtension).to.equal("testproj");
    expect(projectTypes[1].projectFileExtension).to.equal("testproj1");
    expect(projectTypes[2].projectFileExtension).to.equal("sqlproj");
    expect(extension1.activationStub.notCalled, "extension1.activate() should not have been called")
      .to.be.true;
    expect(extension2.activationStub.notCalled, "extension2.activate() should not have been called")
      .to.be.true;
    expect(extension3.activationStub.notCalled, "extension3.activate() should not have been called")
      .to.be.true;
    expect(extension4.activationStub.calledOnce, "extension4.activate() should have been called").to
      .be.true;
    expect(extension5.activationStub.called, "extension5.activate() should have been called").to.be
      .true;
    expect(extension6.activationStub.notCalled, "extension6.activate() should not have been called")
      .to.be.true;
    expect(extension7.activationStub.notCalled, "extension7.activate() should not have been called")
      .to.be.true;
  });

  test("getProjectProvider", async () => {
    const extension1 = createMockExtension("ext1", true, ["csproj"]);
    const extension2 = createMockExtension("ext2", false, ["sqlproj"]);
    const extension3 = createMockExtension("ext3", false, ["dbproj"]);
    stubAllExtensions([extension1, extension2, extension3].map((ext) => ext.extension));

    // Mock workspace.findFiles to return project files so extensions get activated
    sinon.stub(vscode.workspace, "findFiles").callsFake((pattern: any) => {
      const patternStr = pattern.toString();
      if (patternStr.includes("sqlproj")) {
        return Promise.resolve([vscode.Uri.file("test.sqlproj")]);
      } else if (patternStr.includes("dbproj")) {
        return Promise.resolve([vscode.Uri.file("test.dbproj")]);
      }
      return Promise.resolve([]);
    });
    const getProviderByProjectTypeStub = sinon.stub(
      ProjectProviderRegistry,
      "getProviderByProjectExtension",
    );
    getProviderByProjectTypeStub.onFirstCall().returns(undefined);
    getProviderByProjectTypeStub.onSecondCall().returns(
      createProjectProvider(
        [
          {
            id: "sp1",
            description: "",
            projectFileExtension: "sqlproj",
            icon: "",
            displayName: "test project",
          },
        ],
        [
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
        [
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
        ],
      ),
    );
    let provider = await service.getProjectProvider(vscode.Uri.file("abc.sqlproj"));
    expect(provider, "Provider should be returned for sqlproj").to.not.be.undefined;
    expect(provider!.supportedProjectTypes[0].projectFileExtension).to.equal("sqlproj");
    expect(
      extension1.activationStub.notCalled,
      "the ext1.activate() should not have been called for sqlproj",
    ).to.be.true;
    expect(
      extension2.activationStub.calledOnce,
      "the ext2.activate() should have been called once after requesting sqlproj provider",
    ).to.be.true;
    expect(
      extension3.activationStub.notCalled,
      "the ext3.activate() should not have been called for sqlproj",
    ).to.be.true;

    getProviderByProjectTypeStub.reset();
    getProviderByProjectTypeStub.returns(
      createProjectProvider(
        [
          {
            id: "tp2",
            description: "",
            projectFileExtension: "csproj",
            icon: "",
            displayName: "test cs project",
          },
        ],
        [
          {
            id: "testAction2",
            run: async (): Promise<any> => {
              return Promise.resolve();
            },
          },
        ],
        [
          {
            name: "tableInfo2",
            columns: [{ displayName: "c1", width: 75, type: "string" }],
            data: [["d1"]],
          },
        ],
      ),
    );
    provider = await service.getProjectProvider(vscode.Uri.file("abc.csproj"));
    expect(provider, "Provider should be returned for csproj").to.not.be.undefined;
    expect(provider!.supportedProjectTypes[0].projectFileExtension).to.equal("csproj");
    expect(
      extension1.activationStub.notCalled,
      "the ext1.activate() should not have been called for csproj",
    ).to.be.true;
    expect(
      extension2.activationStub.calledOnce,
      "the ext2.activate() should still have been called once",
    ).to.be.true;
    expect(
      extension3.activationStub.notCalled,
      "the ext3.activate() should not have been called for csproj",
    ).to.be.true;
  });

  test("addProjectsToWorkspace", async () => {
    sinon
      .stub(service, "getProjectsInWorkspace")
      .resolves([vscode.Uri.file("folder/folder1/proj2.sqlproj")]);
    const onWorkspaceProjectsChangedStub = sinon.stub();
    const showInformationMessageStub = sinon.stub(vscode.window, "showInformationMessage");
    const onWorkspaceProjectsChangedDisposable = service.onDidWorkspaceProjectsChange(() => {
      onWorkspaceProjectsChangedStub();
    });
    const asRelativeStub = sinon.stub(vscode.workspace, "asRelativePath");
    sinon.stub(vscode.workspace, "workspaceFolders").value(["."]);
    asRelativeStub.onFirstCall().returns(`proj1.sqlproj`);
    asRelativeStub.onSecondCall().returns("other/proj3.sqlproj");
    const updateWorkspaceFoldersStub = sinon.stub(vscode.workspace, "updateWorkspaceFolders");
    await service.addProjectsToWorkspace([
      vscode.Uri.file("folder/proj1.sqlproj"), // within the workspace folder
      vscode.Uri.file("folder/folder1/proj2.sqlproj"), //already exists
      vscode.Uri.file("other/proj3.sqlproj"), // new workspace folder
    ]);
    expect(
      updateWorkspaceFoldersStub.calledOnce,
      "updateWorkspaceFolders should have been called once",
    ).to.be.true;
    expect(showInformationMessageStub.calledOnce, "showInformationMessage should be called once").to
      .be.true;
    const expectedProjPath = vscode.Uri.file("folder/folder1/proj2.sqlproj").fsPath;
    expect(
      showInformationMessageStub.calledWith(constants.ProjectAlreadyOpened(expectedProjPath)),
      `showInformationMessage not called with expected message '${constants.ProjectAlreadyOpened(expectedProjPath)}' Actual '${showInformationMessageStub.getCall(0).args[0]}'`,
    ).to.be.true;
    expect(
      updateWorkspaceFoldersStub.calledWith(
        1,
        undefined,
        sinon.match((arg) => {
          return arg.uri.path === vscode.Uri.file("other").path;
        }),
      ),
      "updateWorkspaceFolder parameters does not match expectation",
    ).to.be.true;
    expect(
      onWorkspaceProjectsChangedStub.calledOnce,
      "the onDidWorkspaceProjectsChange event should have been fired",
    ).to.be.true;
    onWorkspaceProjectsChangedDisposable.dispose();
  });

  test("addProjectsToWorkspace when no workspace open", async () => {
    const onWorkspaceProjectsChangedStub = sinon.stub();
    const onWorkspaceProjectsChangedDisposable = service.onDidWorkspaceProjectsChange(() => {
      onWorkspaceProjectsChangedStub();
    });
    const updateWorkspaceFoldersStub = sinon
      .stub(vscode.workspace, "updateWorkspaceFolders")
      .returns(true);

    await service.addProjectsToWorkspace([vscode.Uri.file("/test/folder/proj1.sqlproj")]);

    expect(
      onWorkspaceProjectsChangedStub.calledOnce,
      "the onDidWorkspaceProjectsChange event should have been fired",
    ).to.be.true;
    expect(updateWorkspaceFoldersStub.calledOnce, "updateWorkspaceFolders should have been called")
      .to.be.true;
    onWorkspaceProjectsChangedDisposable.dispose();
  });

  test("addProjectsToWorkspace when untitled workspace is open", async () => {
    sinon.stub(service, "getProjectsInWorkspace").resolves([]);
    const onWorkspaceProjectsChangedStub = sinon.stub();
    const onWorkspaceProjectsChangedDisposable = service.onDidWorkspaceProjectsChange(() => {
      onWorkspaceProjectsChangedStub();
    });
    sinon.replaceGetter(vscode.workspace, "workspaceFolders", () => [
      { uri: vscode.Uri.file("folder1"), name: "", index: 0 },
    ]);
    const updateWorkspaceFoldersStub = sinon
      .stub(vscode.workspace, "updateWorkspaceFolders")
      .returns(true);
    await service.addProjectsToWorkspace([vscode.Uri.file("/test/folder/proj1.sqlproj")]);

    expect(
      onWorkspaceProjectsChangedStub.calledOnce,
      "the onDidWorkspaceProjectsChange event should have been fired",
    ).to.be.true;
    expect(updateWorkspaceFoldersStub.calledOnce, "updateWorkspaceFolders should have been called")
      .to.be.true;
    onWorkspaceProjectsChangedDisposable.dispose();
  });

  test("createProject uses values from QuickPick", async () => {
    // Arrange: Create a new instance of WorkspaceService
    const service = new WorkspaceService();

    // Arrange: Stub createProject to observe its call and return a fixed URI
    const createProjectStub = sinon
      .stub(service, "createProject")
      .resolves(vscode.Uri.file("/tmp/TestProject"));

    // Arrange: Prepare the QuickPick items to simulate user selections
    const quickPickItems = [
      { label: "Select Database Project Type", value: "SQL Server Database", picked: true },
      { label: "Enter Project Name", value: "TestProject", picked: true },
      { label: "Select Project Location", value: "/tmp/TestProject", picked: true },
      { label: "Select Target Platform", value: "SQL Server", picked: true },
      { label: "SDK-style project", value: constants.YesRecommended, picked: true },
      {
        label: constants.confirmCreateProjectWithBuildTaskDialogName,
        value: constants.Yes,
        picked: true,
      },
    ];

    // Arrange: Stub showQuickPick to return each item in order for each call
    const quickPickStub = sinon.stub(vscode.window, "showQuickPick");
    quickPickItems.forEach((item, idx) => {
      quickPickStub.onCall(idx).resolves(item);
    });

    // Act: Call createProject directly with values from the simulated QuickPick selections
    const projectUri = await service.createProject(
      quickPickItems[1].value, // Project name
      vscode.Uri.file(quickPickItems[2].value), // Project location as URI
      quickPickItems[0].value, // Project type ID
      quickPickItems[3].value, // Target platform
      quickPickItems[4].picked, // SDK-style project flag
      quickPickItems[5].picked, // Configure default build flag
    );

    // Assert: createProject should have been called once
    expect(createProjectStub.calledOnce, "createProject should have been called once").to.be.true;
    // Assert: The returned URI path should match the expected path
    expect(projectUri.path, "project URI should match the expected path").to.equal(
      "/tmp/TestProject",
    );
    // Assert: The arguments passed to createProject should match the simulated QuickPick selections
    const callArgs = createProjectStub.getCall(0).args;
    expect(callArgs[0], "name should match").to.equal(quickPickItems[1].value);
    expect(callArgs[1].path, "location should match").to.equal(quickPickItems[2].value);
    expect(callArgs[2], "projectTypeId should match QuickPick label").to.equal(
      quickPickItems[0].value,
    );
    expect(callArgs[3], "projectTargetVersion should match").to.equal(quickPickItems[3].value);
    expect(callArgs[4], "sdkStyleProject should match").to.be.true;
    expect(callArgs[5], "configureDefaultBuild should be true").to.be.true;

    // Cleanup: Restore the stubbed showQuickPick method
    quickPickStub.restore();
  });
});
