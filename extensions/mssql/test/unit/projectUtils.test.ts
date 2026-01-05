/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as path from "path";
import { readProjectProperties } from "../../src/publishProject/projectUtils";
import { SqlProjectsService } from "../../src/services/sqlProjectsService";

suite("projectUtils Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockSqlProjectsService: sinon.SinonStubbedInstance<SqlProjectsService>;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockSqlProjectsService = sandbox.createStubInstance(SqlProjectsService);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("readProjectProperties normalizes Windows backslashes in outputPath on Unix", async () => {
        const projectPath = "/home/user/project/TestProject.sqlproj";

        // Mock getProjectProperties to return Windows-style path with backslashes
        mockSqlProjectsService.getProjectProperties.resolves({
            success: true,
            outputPath: "bin\\Debug", // Windows-style path with backslashes
            databaseSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
        } as any);

        const result = await readProjectProperties(mockSqlProjectsService, projectPath);

        expect(result).to.exist;
        expect(result?.dacpacOutputPath).to.exist;

        // The dacpac path should use forward slashes, not backslashes
        expect(result?.dacpacOutputPath).to.not.include("\\");
        expect(result?.dacpacOutputPath).to.include("/");

        // Verify the path is constructed correctly with forward slashes
        const expectedPath = path.join("/home/user/project", "bin/Debug", "TestProject.dacpac");
        expect(result?.dacpacOutputPath).to.equal(expectedPath);
    });

    test("readProjectProperties handles absolute paths", async () => {
        const projectPath = "/home/user/project/TestProject.sqlproj";
        const absoluteOutputPath = "/absolute/output/path";

        mockSqlProjectsService.getProjectProperties.resolves({
            success: true,
            outputPath: absoluteOutputPath,
            databaseSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
        } as any);

        const result = await readProjectProperties(mockSqlProjectsService, projectPath);

        expect(result).to.exist;
        expect(result?.dacpacOutputPath).to.exist;

        // For absolute paths, should use the absolute path directly
        const expectedPath = path.join(absoluteOutputPath, "TestProject.dacpac");
        expect(result?.dacpacOutputPath).to.equal(expectedPath);
    });

    test("readProjectProperties normalizes Windows backslashes in absolute paths", async () => {
        const projectPath = "/home/user/project/TestProject.sqlproj";
        // Absolute path with Windows-style backslashes (edge case but should be handled)
        const absoluteOutputPath = "C:\\absolute\\output\\path";

        mockSqlProjectsService.getProjectProperties.resolves({
            success: true,
            outputPath: absoluteOutputPath,
            databaseSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
        } as any);
        const result = await readProjectProperties(mockSqlProjectsService, projectPath);
        expect(result).to.exist;
        expect(result?.dacpacOutputPath).to.exist;

        // Even for absolute paths, backslashes should be normalized
        expect(result?.dacpacOutputPath).to.not.include("\\");
    });

    test("readProjectProperties handles relative paths with forward slashes", async () => {
        const projectPath = "/home/user/project/TestProject.sqlproj";

        mockSqlProjectsService.getProjectProperties.resolves({
            success: true,
            outputPath: "bin/Debug", // Unix-style path
            databaseSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
        } as any);

        const result = await readProjectProperties(mockSqlProjectsService, projectPath);

        expect(result).to.exist;
        expect(result?.dacpacOutputPath).to.exist;

        const expectedPath = path.join("/home/user/project", "bin/Debug", "TestProject.dacpac");
        expect(result?.dacpacOutputPath).to.equal(expectedPath);
    });
});
