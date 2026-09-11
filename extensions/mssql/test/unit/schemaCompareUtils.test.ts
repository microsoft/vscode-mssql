/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as path from "path";
import * as vscode from "vscode";
import * as mssql from "vscode-mssql";

import * as schemaCompareUtils from "../../src/schemaCompare/schemaCompareUtils";
import { ExtractTarget, TaskExecutionMode } from "../../src/enums";

suite("Schema Compare Utils Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockSchemaCompareService: sinon.SinonStubbedInstance<mssql.ISchemaCompareService>;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockSchemaCompareService = {
            compare: sandbox.stub(),
            generateScript: sandbox.stub(),
            publishDatabaseChanges: sandbox.stub(),
            publishProjectChanges: sandbox.stub(),
            includeExcludeNode: sandbox.stub(),
            includeExcludeAllNodes: sandbox.stub(),
            openScmp: sandbox.stub(),
            saveScmp: sandbox.stub(),
            cancel: sandbox.stub(),
        } as sinon.SinonStubbedInstance<mssql.ISchemaCompareService>;
    });

    teardown(() => {
        sandbox.restore();
    });

    test("publishProjectChanges should route through SQL Projects so the project file is updated", async () => {
        // Arrange
        const operationId = "test-operation-id";
        const projectFilePath = path.join("path", "to", "project.sqlproj");
        const extractTarget = ExtractTarget.schemaObjectType;
        const taskExecutionMode = TaskExecutionMode.execute;

        const payload = {
            targetProjectPath: projectFilePath,
            targetFolderStructure: extractTarget,
            taskExecutionMode: taskExecutionMode,
        };

        const expectedResult: mssql.SchemaComparePublishProjectResult = {
            success: true,
            errorMessage: undefined,
            changedFiles: [],
            addedFiles: [],
            deletedFiles: [],
        };

        const executeCommandStub = sandbox
            .stub(vscode.commands, "executeCommand")
            .withArgs(
                schemaCompareUtils.sqlDatabaseProjectsPublishChanges,
                operationId,
                projectFilePath,
                extractTarget,
            )
            .resolves(expectedResult);

        // Act
        const result = await schemaCompareUtils.publishProjectChanges(operationId, payload);

        // Assert
        expect(result).to.deep.equal(expectedResult);
        expect(executeCommandStub.calledOnce).to.be.true;
        expect(mockSchemaCompareService.publishProjectChanges.notCalled).to.be.true;
    });

    test("upgradeLegacyScmpProjectEndpoints resolves a classic project endpoint", () => {
        const classicScmp = `<?xml version="1.0" encoding="utf-8"?>
<SchemaComparison>
  <SourceModelProvider>
    <ProjectBasedModelProvider>
      <ProjectGuid>{67CBC824-A49E-4E9B-A947-360F3DFE65C3}</ProjectGuid>
      <Name>Database43</Name>
    </ProjectBasedModelProvider>
  </SourceModelProvider>
</SchemaComparison>`;

        const upgraded = schemaCompareUtils.upgradeLegacyScmpProjectEndpoints(classicScmp, [
            {
                projectGuid: "67cbc824-a49e-4e9b-a947-360f3dfe65c3",
                projectName: "Database43",
                projectFilePath: "C:\\src\\Database43\\Database43.sqlproj",
                targetScripts: ["C:\\src\\Database43\\dbo\\Table1.sql"],
                dataSchemaProvider: "160",
            },
        ]);

        expect(upgraded.changed).to.be.true;
        expect(upgraded.content).to.contain(
            "<ProjectFilePath>C:\\src\\Database43\\Database43.sqlproj</ProjectFilePath>",
        );
        expect(upgraded.content).to.contain(
            "<TargetScripts>[C:\\src\\Database43\\dbo\\Table1.sql]</TargetScripts>",
        );
        expect(upgraded.content).to.contain("<Dsp>160</Dsp>");
        expect(upgraded.content).to.contain("<FolderStructure>SchemaObjectType</FolderStructure>");
    });

    test("upgradeLegacyScmpProjectEndpoints reports an unresolved classic project", () => {
        const classicScmp = `<SchemaComparison><SourceModelProvider><ProjectBasedModelProvider><ProjectGuid>{missing}</ProjectGuid><Name>MissingProject</Name></ProjectBasedModelProvider></SourceModelProvider></SchemaComparison>`;

        expect(() =>
            schemaCompareUtils.upgradeLegacyScmpProjectEndpoints(classicScmp, []),
        ).to.throw("MissingProject");
    });
});
