/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import * as path from "path";
import * as constants from "../../common/constants";
import { createNewProjectWithQuickpick } from "../../dialogs/newProjectQuickpick";
import { WorkspaceService } from "../../services/workspaceService";
import { IProjectType } from "dataworkspace";

chai.use(sinonChai);

suite("New Project QuickPick", function (): void {
    let sandbox: sinon.SinonSandbox;
    let workspaceServiceStub: sinon.SinonStubbedInstance<WorkspaceService>;
    let showQuickPickStub: sinon.SinonStub;
    let showInputBoxStub: sinon.SinonStub;
    let showOpenDialogStub: sinon.SinonStub;
    let sqlServerProjectType: IProjectType;
    let azureSqlProjectType: IProjectType;
    let mockQuickPickSelectionIndex: number;

    setup(() => {
        sandbox = sinon.createSandbox();
        workspaceServiceStub = sandbox.createStubInstance(WorkspaceService);
        showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
        showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
        showOpenDialogStub = sandbox.stub(vscode.window, "showOpenDialog");
        mockQuickPickSelectionIndex = 0; // Default to selecting first item

        // Stub createQuickPick for SDK style selection
        const mockQuickPick = {
            items: [],
            title: "",
            ignoreFocusOut: false,
            buttons: [],
            placeholder: "",
            show: sandbox.stub(),
            hide: sandbox.stub(),
            onDidHide: sandbox.stub().returns({ dispose: sandbox.stub() }),
            onDidChangeSelection: sandbox
                .stub()
                .callsFake((callback: (e: readonly vscode.QuickPickItem[]) => void) => {
                    // Trigger selection with the configured item
                    setTimeout(
                        () => callback([mockQuickPick.items[mockQuickPickSelectionIndex]]),
                        0,
                    );
                    return { dispose: sandbox.stub() };
                }),
            onDidTriggerButton: sandbox.stub().returns({ dispose: sandbox.stub() }),
        };
        sandbox
            .stub(vscode.window, "createQuickPick")
            .returns(mockQuickPick as unknown as vscode.QuickPick<vscode.QuickPickItem>);

        // Define the target platforms that should be available for selection
        // These match the SqlTargetPlatform enum values from sql-database-projects
        const targetPlatforms = [
            "SQL Server 2012",
            "SQL Server 2014",
            "SQL Server 2016",
            "SQL Server 2017",
            "SQL Server 2019",
            "SQL Server 2022",
            "SQL Server 2025",
            "Azure SQL Database",
            "Azure Synapse SQL Pool",
            "Azure SQL Edge",
            "Azure Synapse Serverless SQL Pool",
            "Synapse Data Warehouse in Microsoft Fabric",
            "SQL database in Fabric (preview)",
        ];

        // Create mock project types that match the real types
        sqlServerProjectType = {
            id: "emptySqlDatabaseProjectTypeId",
            displayName: "SQL Server Database",
            description: "Create a new SQL Server database project",
            icon: "",
            projectFileExtension: "sqlproj",
            targetPlatforms: targetPlatforms,
            defaultTargetPlatform: "SQL Server 2025",
            sdkStyleOption: true,
        };

        azureSqlProjectType = {
            id: "emptyAzureDbSqlDatabaseProjectTypeId",
            displayName: "Azure SQL Database",
            description: "Create a new Azure SQL Database project",
            icon: "",
            projectFileExtension: "sqlproj",
            targetPlatforms: targetPlatforms,
            defaultTargetPlatform: "Azure SQL Database",
            sdkStyleOption: true,
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Should complete full QuickPick flow for SQL Server project type", async function (): Promise<void> {
        workspaceServiceStub.getAllProjectTypes.resolves([sqlServerProjectType]);

        // Mock user selections through the entire flow
        let quickPickCallCount = 0;
        showQuickPickStub.callsFake(
            async (items: vscode.QuickPickItem[] | string[], options: vscode.QuickPickOptions) => {
                quickPickCallCount++;
                if (quickPickCallCount === 1) {
                    // Step 1: Select project type
                    expect(options.title).to.equal(constants.SelectProjectType);
                    expect((items as vscode.QuickPickItem[])[0].label).to.equal(
                        "SQL Server Database",
                    );
                    return (items as vscode.QuickPickItem[])[0]; // Select SQL Server project
                } else if (quickPickCallCount === 2) {
                    // Step 2: Select location
                    return constants.BrowseEllipsisWithIcon;
                } else if (quickPickCallCount === 3) {
                    // Step 3: Select target platform
                    expect(options.title).to.equal(constants.SelectTargetPlatform);
                    expect(items.length).to.be.greaterThan(0);
                    expect(
                        (items as vscode.QuickPickItem[]).some(
                            (item) => item.label === "SQL Server 2025",
                        ),
                    ).to.be.true;
                    expect(
                        (items as vscode.QuickPickItem[]).some(
                            (item) => item.label === "Azure SQL Database",
                        ),
                    ).to.be.true;
                    return (items as vscode.QuickPickItem[]).find(
                        (item) => item.label === "SQL Server 2025",
                    );
                } else if (quickPickCallCount === 4) {
                    // Step 4: Configure build (SDK style handled by createQuickPick, not showQuickPick)
                    expect(options.title).to.equal(
                        constants.confirmCreateProjectWithBuildTaskDialogName,
                    );
                    expect(items).to.include(constants.Yes);
                    expect(items).to.include(constants.No);
                    return constants.Yes;
                }
                return undefined;
            },
        );

        showInputBoxStub.resolves("TestSqlServerProject");
        showOpenDialogStub.resolves([vscode.Uri.file(path.join(__dirname, "test"))]);
        workspaceServiceStub.createProject.resolves();

        await createNewProjectWithQuickpick(workspaceServiceStub);

        // Verify all QuickPicks were shown (4 showQuickPick calls + SDK style via createQuickPick)
        expect(quickPickCallCount).to.equal(4, "All 4 showQuickPick steps should be called");

        // Verify createProject was called with correct parameters
        expect(workspaceServiceStub.createProject).to.have.been.calledOnce;
        const createProjectArgs = workspaceServiceStub.createProject.getCall(0).args;
        expect(createProjectArgs[0]).to.equal("TestSqlServerProject"); // name
        expect(createProjectArgs[2]).to.equal("emptySqlDatabaseProjectTypeId"); // projectTypeId
        expect(createProjectArgs[3]).to.equal("SQL Server 2025"); // targetPlatform
        expect(createProjectArgs[4]).to.be.true; // sdkStyle
        expect(createProjectArgs[5]).to.be.true; // configureDefaultBuild
    });

    test("Should complete full QuickPick flow for Azure SQL Database project type", async function (): Promise<void> {
        workspaceServiceStub.getAllProjectTypes.resolves([azureSqlProjectType]);

        // Configure SDK style selection to select "No" (index 1)
        mockQuickPickSelectionIndex = 1;

        // Mock user selections through the entire flow
        let quickPickCallCount = 0;
        showQuickPickStub.callsFake(
            async (items: vscode.QuickPickItem[] | string[], options: vscode.QuickPickOptions) => {
                quickPickCallCount++;
                if (quickPickCallCount === 1) {
                    // Step 1: Select project type
                    expect(options.title).to.equal(constants.SelectProjectType);
                    expect((items as vscode.QuickPickItem[])[0].label).to.equal(
                        "Azure SQL Database",
                    );
                    return (items as vscode.QuickPickItem[])[0]; // Select Azure SQL Database project
                } else if (quickPickCallCount === 2) {
                    // Step 2: Select location
                    return constants.BrowseEllipsisWithIcon;
                } else if (quickPickCallCount === 3) {
                    // Step 3: Select target platform - THIS IS KEY FOR AZURE SQL DATABASE
                    expect(options.title).to.equal(constants.SelectTargetPlatform);
                    expect(items.length).to.be.greaterThan(0);
                    expect(
                        (items as vscode.QuickPickItem[]).some(
                            (item) => item.label === "Azure SQL Database",
                        ),
                    ).to.be.true;
                    expect(
                        (items as vscode.QuickPickItem[]).some(
                            (item) => item.label === "SQL Server 2025",
                        ),
                    ).to.be.true;
                    expect(
                        (items as vscode.QuickPickItem[]).some(
                            (item) => item.label === "SQL Server 2022",
                        ),
                    ).to.be.true;
                    // Verify default is first in list
                    expect((items as vscode.QuickPickItem[])[0].label).to.equal(
                        "Azure SQL Database",
                    );
                    expect((items as vscode.QuickPickItem[])[0].description).to.equal(
                        constants.Default,
                    );
                    return (items as vscode.QuickPickItem[])[0]; // Select Azure SQL Database
                } else if (quickPickCallCount === 4) {
                    // Step 4: Configure build (SDK style handled by createQuickPick, not showQuickPick)
                    expect(options.title).to.equal(
                        constants.confirmCreateProjectWithBuildTaskDialogName,
                    );
                    expect(items).to.include(constants.Yes);
                    expect(items).to.include(constants.No);
                    return constants.No;
                }
                return undefined;
            },
        );

        showInputBoxStub.resolves("TestAzureProject");
        showOpenDialogStub.resolves([vscode.Uri.file(path.join(__dirname, "test"))]);
        workspaceServiceStub.createProject.resolves();

        await createNewProjectWithQuickpick(workspaceServiceStub);

        // Verify all QuickPicks were shown (4 showQuickPick calls + SDK style via createQuickPick)
        expect(quickPickCallCount).to.equal(4, "All 4 showQuickPick steps should be called");

        // Verify createProject was called with correct parameters
        expect(workspaceServiceStub.createProject).to.have.been.calledOnce;
        const createProjectArgs = workspaceServiceStub.createProject.getCall(0).args;
        expect(createProjectArgs[0]).to.equal("TestAzureProject"); // name
        expect(createProjectArgs[2]).to.equal("emptyAzureDbSqlDatabaseProjectTypeId"); // projectTypeId
        expect(createProjectArgs[3]).to.equal("Azure SQL Database"); // targetPlatform
        expect(createProjectArgs[4]).to.be.false; // sdkStyle
        expect(createProjectArgs[5]).to.be.false; // configureDefaultBuild
    });
});
