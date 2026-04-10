/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as constants from "../src/common/constants";
import * as utils from "../src/common/utils";
import { addDatabaseReferenceQuickpick } from "../src/dialogs/addDatabaseReferenceQuickpick";
import {
    IDacpacReferenceSettings,
    INugetPackageReferenceSettings,
    IProjectReferenceSettings,
    ISystemDatabaseReferenceSettings,
} from "../src/models/IDatabaseReferenceSettings";
import { Project } from "../src/models/project";
import { ProjectType, SystemDbReferenceType } from "vscode-mssql";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

/** vscode.window method names used with sandbox.stub() */
const ShowQuickPick = "showQuickPick" as const;
const ShowInputBox = "showInputBox" as const;
const ShowOpenDialog = "showOpenDialog" as const;
const ShowErrorMessage = "showErrorMessage" as const;

/** utils method name used with sandbox.stub() */
const GetSqlProjectsInWorkspace = "getSqlProjectsInWorkspace" as const;

/** Repeated path / URI fixtures */
const defaultProjectPath = "C:\\projects\\MyProj\\MyProj.sqlproj";
const otherProjectUri = vscode.Uri.file("C:\\other\\OtherProj\\OtherProj.sqlproj");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal Project-like stub. Avoids real disk I/O. */
function makeProject(opts: {
    sqlProjStyle?: ProjectType;
    targetVersion?: string;
    projectFilePath?: string;
}): Project {
    const proj = Object.create(Project.prototype) as Project;
    const projFields = proj as unknown as { _sqlProjStyle: ProjectType; _projectFilePath: string };
    projFields._sqlProjStyle = opts.sqlProjStyle ?? ProjectType.LegacyStyle;
    // Normalize via vscode.Uri.file so fsPath casing matches Uri.file(...).fsPath (e.g. lowercase drive letter on Windows)
    projFields._projectFilePath = vscode.Uri.file(
        opts.projectFilePath ?? defaultProjectPath,
    ).fsPath;
    proj.getProjectTargetVersion = () => opts.targetVersion ?? "SqlServer2022";
    return proj;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

suite("addDatabaseReferenceQuickpick", function (): void {
    let sandbox: sinon.SinonSandbox;

    setup(function (): void {
        sandbox = sinon.createSandbox();
    });

    teardown(function (): void {
        sandbox.restore();
    });

    // -------------------------------------------------------------------------
    // Dispatcher — addDatabaseReferenceQuickpick
    // -------------------------------------------------------------------------

    suite("dispatcher", function (): void {
        test("Returns undefined when user cancels reference type selection", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            sandbox.stub(vscode.window, ShowQuickPick).resolves(undefined);

            const result = await addDatabaseReferenceQuickpick(makeProject({}));
            expect(result).to.be.undefined;
        });

        test("Does not include nupkg option for legacy-style project", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox
                .stub(vscode.window, ShowQuickPick)
                .resolves(undefined);

            await addDatabaseReferenceQuickpick(
                makeProject({ sqlProjStyle: ProjectType.LegacyStyle }),
            );

            const items = showQuickPick.firstCall.args[0] as unknown as string[];
            expect(items).to.not.include(constants.nupkgText);
        });

        test("Includes nupkg option for SDK-style project", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox
                .stub(vscode.window, ShowQuickPick)
                .resolves(undefined);

            await addDatabaseReferenceQuickpick(
                makeProject({ sqlProjStyle: ProjectType.SdkStyle }),
            );

            const items = showQuickPick.firstCall.args[0] as unknown as string[];
            expect(items).to.include(constants.nupkgText);
        });

        test("Does not show project option when no other projects are in the workspace", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox
                .stub(vscode.window, ShowQuickPick)
                .resolves(undefined);

            await addDatabaseReferenceQuickpick(makeProject({}));

            const items = showQuickPick.firstCall.args[0] as unknown as string[];
            expect(items).to.not.include(constants.projectLabel);
        });

        test("Shows project option when other projects exist in the workspace", async function (): Promise<void> {
            sandbox
                .stub(utils, GetSqlProjectsInWorkspace)
                .resolves([vscode.Uri.file("C:\\other\\Other.sqlproj")]);
            const showQuickPick: sinon.SinonStub = sandbox
                .stub(vscode.window, ShowQuickPick)
                .resolves(undefined);

            await addDatabaseReferenceQuickpick(makeProject({}));

            const items = showQuickPick.firstCall.args[0] as unknown as string[];
            expect(items).to.include(constants.projectLabel);
        });
    });

    // -------------------------------------------------------------------------
    // System database reference
    // -------------------------------------------------------------------------

    suite("addSystemDatabaseReference", function (): void {
        test("Returns undefined when user cancels system database selection", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            // Step 1: pick reference type → systemDatabase
            showQuickPick.onFirstCall().resolves(constants.systemDatabase);
            // Step 2: pick system db → cancel
            showQuickPick.onSecondCall().resolves(undefined);

            const result = await addDatabaseReferenceQuickpick(makeProject({}));
            expect(result).to.be.undefined;
        });

        test("Returns ISystemDatabaseReferenceSettings for legacy project with master db", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.systemDatabase); // type
            showQuickPick.onSecondCall().resolves(constants.master); // system db
            showQuickPick.onThirdCall().resolves(constants.noStringDefault); // suppress errors

            sandbox.stub(vscode.window, ShowInputBox).resolves("master"); // db name

            const result = await addDatabaseReferenceQuickpick(makeProject({}));
            const sysResult = result as ISystemDatabaseReferenceSettings;

            expect(sysResult).to.not.be.undefined;
            expect(sysResult.systemDb).to.equal(utils.getSystemDatabase(constants.master));
            expect(sysResult.suppressMissingDependenciesErrors).to.be.false;
        });

        test("Sets suppressMissingDependenciesErrors to true when user picks Yes", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.systemDatabase);
            showQuickPick.onSecondCall().resolves(constants.master);
            showQuickPick.onThirdCall().resolves(constants.yesString); // suppress errors = yes

            sandbox.stub(vscode.window, ShowInputBox).resolves("master");

            const result = await addDatabaseReferenceQuickpick(makeProject({}));

            expect((result as ISystemDatabaseReferenceSettings).suppressMissingDependenciesErrors)
                .to.be.true;
        });

        test("Uses ArtifactReference for SDK-style project when Artifact Reference is picked", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.systemDatabase);
            showQuickPick.onSecondCall().resolves(constants.master);
            showQuickPick.onThirdCall().resolves(constants.artifactReference); // reference type
            showQuickPick.onCall(3).resolves(constants.noStringDefault); // suppress errors

            sandbox.stub(vscode.window, ShowInputBox).resolves("master");

            const result = await addDatabaseReferenceQuickpick(
                makeProject({ sqlProjStyle: ProjectType.SdkStyle }),
            );

            expect((result as ISystemDatabaseReferenceSettings).systemDbReferenceType).to.equal(
                SystemDbReferenceType.ArtifactReference,
            );
        });

        test("Uses PackageReference for SDK-style project when Package Reference is picked", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.systemDatabase);
            showQuickPick.onSecondCall().resolves(constants.master);
            showQuickPick.onThirdCall().resolves(constants.packageReference); // reference type
            showQuickPick.onCall(3).resolves(constants.noStringDefault); // suppress errors

            sandbox.stub(vscode.window, ShowInputBox).resolves("master");

            const result = await addDatabaseReferenceQuickpick(
                makeProject({ sqlProjStyle: ProjectType.SdkStyle }),
            );

            expect((result as ISystemDatabaseReferenceSettings).systemDbReferenceType).to.equal(
                SystemDbReferenceType.PackageReference,
            );
        });

        test("getSystemDbOptions returns only master for Azure target version", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.systemDatabase);
            showQuickPick.onSecondCall().resolves(undefined); // cancel after options shown

            await addDatabaseReferenceQuickpick(makeProject({ targetVersion: "SqlAzureV12" }));

            const systemDbItems = showQuickPick.secondCall.args[0] as unknown as string[];
            expect(systemDbItems).to.deep.equal([constants.master]);
        });

        test("getSystemDbOptions returns master and msdb for non-Azure target version", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.systemDatabase);
            showQuickPick.onSecondCall().resolves(undefined); // cancel after options shown

            await addDatabaseReferenceQuickpick(makeProject({ targetVersion: "SqlServer2022" }));

            const systemDbItems = showQuickPick.secondCall.args[0] as unknown as string[];
            expect(systemDbItems).to.deep.equal([constants.master, constants.msdb]);
        });
    });

    // -------------------------------------------------------------------------
    // Project reference
    // -------------------------------------------------------------------------

    suite("addProjectReference", function (): void {
        test("Returns undefined when user cancels project selection", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([otherProjectUri]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.projectLabel); // type
            showQuickPick.onSecondCall().resolves(undefined); // project → cancel

            const result = await addDatabaseReferenceQuickpick(makeProject({}));
            expect(result).to.be.undefined;
        });

        test("Returns IProjectReferenceSettings for same-database location", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([otherProjectUri]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.projectLabel);
            showQuickPick.onSecondCall().resolves({ label: "OtherProj", uri: otherProjectUri });
            showQuickPick.onThirdCall().resolves(constants.sameDatabase); // location
            showQuickPick.onCall(3).resolves(constants.noStringDefault); // suppress errors

            const result = await addDatabaseReferenceQuickpick(makeProject({}));
            const projResult = result as IProjectReferenceSettings;

            expect(projResult).to.not.be.undefined;
            expect(projResult.projectName).to.equal("OtherProj");
            expect(projResult.suppressMissingDependenciesErrors).to.be.false;
        });

        test("Returns IProjectReferenceSettings with db and server vars for different-server location", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([otherProjectUri]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.projectLabel);
            showQuickPick.onSecondCall().resolves({ label: "OtherProj", uri: otherProjectUri });
            showQuickPick.onThirdCall().resolves(constants.differentDbDifferentServer);
            showQuickPick.onCall(3).resolves(constants.noStringDefault); // suppress errors

            const showInputBox = sandbox.stub(vscode.window, ShowInputBox);
            showInputBox.onFirstCall().resolves("OtherProjDB"); // db name
            showInputBox.onSecondCall().resolves("$(OtherProjDBVar)"); // db var
            showInputBox.onThirdCall().resolves("OtherServer"); // server name
            showInputBox.onCall(3).resolves("$(OtherServerVar)"); // server var

            const result = await addDatabaseReferenceQuickpick(makeProject({}));
            const projResult = result as IProjectReferenceSettings;

            expect(projResult).to.not.be.undefined;
            expect(projResult.databaseName).to.equal("OtherProjDB");
            expect(projResult.serverName).to.equal("OtherServer");
        });
    });

    // -------------------------------------------------------------------------
    // Dacpac reference
    // -------------------------------------------------------------------------

    suite("addDacpacReference", function (): void {
        test("Returns undefined when user cancels location selection", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.dacpacText);
            showQuickPick.onSecondCall().resolves(undefined); // location → cancel

            const result = await addDatabaseReferenceQuickpick(makeProject({}));
            expect(result).to.be.undefined;
        });

        test("Shows error and re-prompts when dacpac is on a different drive", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.dacpacText);
            showQuickPick.onSecondCall().resolves(constants.sameDatabase);
            showQuickPick.onThirdCall().resolves(constants.browseEllipsisWithIcon); // browse
            showQuickPick.onCall(3).resolves(undefined); // second browse prompt → cancel

            const showOpenDialog = sandbox.stub(vscode.window, ShowOpenDialog).resolves([
                vscode.Uri.file("D:\\dacpacs\\Other.dacpac"), // different drive from C:\ project
            ]);
            const showErrorMessage = sandbox
                .stub(vscode.window, ShowErrorMessage)
                .resolves(undefined);

            const result = await addDatabaseReferenceQuickpick(
                makeProject({ projectFilePath: defaultProjectPath }),
            );

            expect(showOpenDialog.calledOnce).to.be.true;
            expect(showErrorMessage.calledOnce).to.be.true;
            expect(result).to.be.undefined; // cancelled on second browse
        });

        test("Returns IDacpacReferenceSettings for happy path", async function (): Promise<void> {
            const dacpacUri = vscode.Uri.file("C:\\dacpacs\\MyDep.dacpac");

            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.dacpacText);
            showQuickPick.onSecondCall().resolves(constants.sameDatabase);
            showQuickPick.onThirdCall().resolves(constants.browseEllipsisWithIcon);
            showQuickPick.onCall(3).resolves(constants.noStringDefault); // suppress errors

            sandbox.stub(vscode.window, ShowOpenDialog).resolves([dacpacUri]);

            const result = await addDatabaseReferenceQuickpick(
                makeProject({ projectFilePath: defaultProjectPath }),
            );
            const dacResult = result as IDacpacReferenceSettings;

            expect(dacResult).to.not.be.undefined;
            expect(dacResult.dacpacFileLocation.fsPath).to.include("MyDep.dacpac");
            expect(dacResult.suppressMissingDependenciesErrors).to.be.false;
        });
    });

    // -------------------------------------------------------------------------
    // NuGet package reference
    // -------------------------------------------------------------------------

    suite("addNupkgReference", function (): void {
        test("Returns undefined when user cancels package name input", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.nupkgText);
            showQuickPick.onSecondCall().resolves(constants.sameDatabase);

            sandbox.stub(vscode.window, ShowInputBox).resolves(undefined); // pkg name → cancel

            const result = await addDatabaseReferenceQuickpick(
                makeProject({ sqlProjStyle: ProjectType.SdkStyle }),
            );
            expect(result).to.be.undefined;
        });

        test("Returns INugetPackageReferenceSettings for happy path with same-database location", async function (): Promise<void> {
            sandbox.stub(utils, GetSqlProjectsInWorkspace).resolves([]);
            const showQuickPick: sinon.SinonStub = sandbox.stub(vscode.window, ShowQuickPick);
            showQuickPick.onFirstCall().resolves(constants.nupkgText);
            showQuickPick.onSecondCall().resolves(constants.sameDatabase); // location
            showQuickPick.onThirdCall().resolves(constants.noStringDefault); // suppress errors

            const showInputBox = sandbox.stub(vscode.window, ShowInputBox);
            showInputBox.onFirstCall().resolves("MyPackage"); // pkg name
            showInputBox.onSecondCall().resolves("1.0.0"); // version

            const result = await addDatabaseReferenceQuickpick(
                makeProject({ sqlProjStyle: ProjectType.SdkStyle }),
            );
            const nupkgResult = result as INugetPackageReferenceSettings;

            expect(nupkgResult).to.not.be.undefined;
            expect(nupkgResult.packageName).to.equal("MyPackage");
            expect(nupkgResult.packageVersion).to.equal("1.0.0");
            expect(nupkgResult.suppressMissingDependenciesErrors).to.be.false;
        });
    });
});
