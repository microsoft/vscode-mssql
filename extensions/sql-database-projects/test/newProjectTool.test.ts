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
let sandbox: sinon.SinonSandbox;

suite("NewProjectTool: New project tool tests", function (): void {
    setup(async function () {
        testFolderPath = await generateTestFolderPath(this.test);
        sandbox = sinon.createSandbox();

        const dataWorkspaceMock = {
            defaultProjectSaveLocation: vscode.Uri.file(testFolderPath),
        };
        sandbox
            .stub(vscode.extensions, "getExtension")
            .returns(<any>{ exports: dataWorkspaceMock });
    });

    suiteTeardown(async function (): Promise<void> {
        await deleteGeneratedTestFolder();
    });

    teardown(async function () {
        sandbox.restore();
    });

    test("Should generate correct default project names", async function (): Promise<void> {
        expect(newProjectTool.defaultProjectNameNewProj()).to.equal("DatabaseProject1");
        expect(newProjectTool.defaultProjectNameFromDb("master")).to.equal("DatabaseProjectmaster");
    });

    test("Should auto-increment default project names for new projects", async function (): Promise<void> {
        expect(newProjectTool.defaultProjectNameNewProj()).to.equal("DatabaseProject1");

        await createTestFile(this.test, "", "DatabaseProject1", testFolderPath);
        expect(newProjectTool.defaultProjectNameNewProj()).to.equal("DatabaseProject2");

        await createTestFile(this.test, "", "DatabaseProject2", testFolderPath);
        expect(newProjectTool.defaultProjectNameNewProj()).to.equal("DatabaseProject3");
    });

    test("Should auto-increment default project names for create project for database", async function (): Promise<void> {
        expect(newProjectTool.defaultProjectNameFromDb("master")).to.equal("DatabaseProjectmaster");

        await createTestFile(this.test, "", "DatabaseProjectmaster", testFolderPath);
        expect(newProjectTool.defaultProjectNameFromDb("master")).to.equal(
            "DatabaseProjectmaster2",
        );

        await createTestFile(this.test, "", "DatabaseProjectmaster2", testFolderPath);
        expect(newProjectTool.defaultProjectNameFromDb("master")).to.equal(
            "DatabaseProjectmaster3",
        );
    });

    test("Should not return a project name if undefined is passed in ", async function (): Promise<void> {
        expect(newProjectTool.defaultProjectNameFromDb(undefined)).to.equal("");
        expect(newProjectTool.defaultProjectNameFromDb("")).to.equal("");
        expect(newProjectTool.defaultProjectNameFromDb("test")).to.equal("DatabaseProjecttest");
    });
});
