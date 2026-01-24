/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as path from "path";
import * as mssql from "vscode-mssql";

import * as schemaCompareUtils from "../../src/schemaCompare/schemaCompareUtils";
import { ExtractTarget, TaskExecutionMode } from "../../src/sharedInterfaces/schemaCompare";

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

    test("publishProjectChanges should call schemaCompareService with project directory path", async () => {
        // Arrange
        const operationId = "test-operation-id";
        const projectFilePath = path.join("path", "to", "project.sqlproj");
        const projectDirectoryPath = path.dirname(projectFilePath);
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

        mockSchemaCompareService.publishProjectChanges.resolves(expectedResult);

        // Act
        const result = await schemaCompareUtils.publishProjectChanges(
            operationId,
            payload,
            mockSchemaCompareService as unknown as mssql.ISchemaCompareService,
        );

        // Assert
        expect(result).to.deep.equal(expectedResult);
        expect(mockSchemaCompareService.publishProjectChanges.calledOnce).to.be.true;
        expect(mockSchemaCompareService.publishProjectChanges.firstCall.args[0]).to.equal(
            operationId,
        );
        expect(mockSchemaCompareService.publishProjectChanges.firstCall.args[1]).to.equal(
            projectDirectoryPath,
        );
        expect(mockSchemaCompareService.publishProjectChanges.firstCall.args[2]).to.equal(
            extractTarget,
        );
        expect(mockSchemaCompareService.publishProjectChanges.firstCall.args[3]).to.equal(
            taskExecutionMode,
        );
    });
});
