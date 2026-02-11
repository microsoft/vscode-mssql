/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as newProjectTool from "../src/tools/newProjectTool";
import { generateTestFolderPath, createTestFile, deleteGeneratedTestFolder } from "./testUtils";

let testFolderPath: string;

suite("NewProjectTool: New project tool tests", function (): void {
    setup(async function () {
        testFolderPath = await generateTestFolderPath(this.test);

        const dataWorkspaceStub = {
            defaultProjectSaveLocation: vscode.Uri.file(testFolderPath),
        };
        sinon.stub(vscode.extensions, "getExtension").returns(<any>{ exports: dataWorkspaceStub });
    });

    suiteTeardown(async function (): Promise<void> {
        await deleteGeneratedTestFolder();
    });

    teardown(async function () {
        sinon.restore();
    });

    test("Should generate correct default project names", async function (): Promise<void> {
        expect(
            newProjectTool.defaultProjectNameNewProj(),
            "Default new project name should be DatabaseProject1",
        ).to.equal("DatabaseProject1");
        expect(
            newProjectTool.defaultProjectNameFromDb("master"),
            "Default project name from db master should be DatabaseProjectmaster",
        ).to.equal("DatabaseProjectmaster");
    });

    test("Should auto-increment default project names for new projects", async function (): Promise<void> {
        expect(
            newProjectTool.defaultProjectNameNewProj(),
            "Initial default project name should be DatabaseProject1",
        ).to.equal("DatabaseProject1");

        await createTestFile(this.test, "", "DatabaseProject1", testFolderPath);
        expect(
            newProjectTool.defaultProjectNameNewProj(),
            "Should increment to DatabaseProject2 after DatabaseProject1 exists",
        ).to.equal("DatabaseProject2");

        await createTestFile(this.test, "", "DatabaseProject2", testFolderPath);
        expect(
            newProjectTool.defaultProjectNameNewProj(),
            "Should increment to DatabaseProject3 after DatabaseProject2 exists",
        ).to.equal("DatabaseProject3");
    });

    test("Should auto-increment default project names for create project for database", async function (): Promise<void> {
        expect(
            newProjectTool.defaultProjectNameFromDb("master"),
            "Initial from-db project name should be DatabaseProjectmaster",
        ).to.equal("DatabaseProjectmaster");

        await createTestFile(this.test, "", "DatabaseProjectmaster", testFolderPath);
        expect(
            newProjectTool.defaultProjectNameFromDb("master"),
            "Should increment to DatabaseProjectmaster2 after DatabaseProjectmaster exists",
        ).to.equal("DatabaseProjectmaster2");

        await createTestFile(this.test, "", "DatabaseProjectmaster2", testFolderPath);
        expect(
            newProjectTool.defaultProjectNameFromDb("master"),
            "Should increment to DatabaseProjectmaster3 after DatabaseProjectmaster2 exists",
        ).to.equal("DatabaseProjectmaster3");
    });

    test("Should not return a project name if undefined is passed in ", async function (): Promise<void> {
        expect(
            newProjectTool.defaultProjectNameFromDb(undefined),
            "Should return empty string when db name is undefined",
        ).to.equal("");
        expect(
            newProjectTool.defaultProjectNameFromDb(""),
            "Should return empty string when db name is empty",
        ).to.equal("");
        expect(
            newProjectTool.defaultProjectNameFromDb("test"),
            "Should return DatabaseProjecttest for db name test",
        ).to.equal("DatabaseProjecttest");
    });
});
