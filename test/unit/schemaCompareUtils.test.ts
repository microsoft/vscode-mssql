/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as TypeMoq from "typemoq";
import * as sinon from "sinon";
import * as path from "path";
import * as mssql from "vscode-mssql";

import * as schemaCompareUtils from "../../src/schemaCompare/schemaCompareUtils";

suite("Schema Compare Utils Tests", () => {
    let mockSchemaCompareService: TypeMoq.IMock<mssql.ISchemaCompareService>;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        mockSchemaCompareService = TypeMoq.Mock.ofType<mssql.ISchemaCompareService>();
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("publishProjectChanges should call schemaCompareService with project directory path", async () => {
        // Arrange
        const operationId = "test-operation-id";
        const projectFilePath = path.join("path", "to", "project.sqlproj");
        const projectDirectoryPath = path.dirname(projectFilePath);
        const extractTarget = mssql.ExtractTarget.schemaObjectType;
        const taskExecutionMode = mssql.TaskExecutionMode.execute;

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

        mockSchemaCompareService
            .setup((x) =>
                x.publishProjectChanges(
                    TypeMoq.It.isValue(operationId),
                    TypeMoq.It.isValue(projectDirectoryPath),
                    TypeMoq.It.isValue(extractTarget),
                    TypeMoq.It.isValue(taskExecutionMode),
                ),
            )
            .returns(() => Promise.resolve(expectedResult))
            .verifiable(TypeMoq.Times.once());

        // Act
        const result = await schemaCompareUtils.publishProjectChanges(
            operationId,
            payload,
            mockSchemaCompareService.object,
        );

        // Assert
        assert.strictEqual(result, expectedResult);
        mockSchemaCompareService.verify(
            (x) =>
                x.publishProjectChanges(
                    TypeMoq.It.isValue(operationId),
                    TypeMoq.It.isValue(projectDirectoryPath),
                    TypeMoq.It.isValue(extractTarget),
                    TypeMoq.It.isValue(taskExecutionMode),
                ),
            TypeMoq.Times.once(),
        );
    });
});
