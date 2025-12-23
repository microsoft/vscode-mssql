/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as path from "path";
import { readProjectProperties } from "../../src/publishProject/projectUtils";
import { SqlProjectsService } from "../../src/services/sqlProjectsService";
import { GetProjectPropertiesResult } from "vscode-mssql";
import { stubPathAsPlatform } from "./utils";

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
        } as GetProjectPropertiesResult);

        stubPathAsPlatform(sandbox, path.posix);

        const result = await readProjectProperties(mockSqlProjectsService, projectPath);

        expect(result, "project properties should be successfully retrieved").to.exist;
        expect(result?.dacpacOutputPath, "dacpac output path read from properties").to.exist;

        // The dacpac path should use forward slashes, not backslashes
        expect(result?.dacpacOutputPath).to.not.include("\\");
        expect(result?.dacpacOutputPath).to.include("/");

        // Verify the path is constructed correctly with forward slashes
        const expectedPath = path.posix.join(
            "/home/user/project",
            "bin/Debug",
            "TestProject.dacpac",
        );

        expect(result?.dacpacOutputPath).to.equal(expectedPath);
    });

    test("readProjectProperties normalizes Unix slashes in outputPath on Windows", async () => {
        const projectPath = "C:\\Users\\TestUser\\project\\TestProject.sqlproj";

        // Mock getProjectProperties to return Unix-style path with forward slashes
        mockSqlProjectsService.getProjectProperties.resolves({
            success: true,
            outputPath: "bin/Debug", // Unix-style path with forward slashes
            databaseSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
        } as GetProjectPropertiesResult);

        stubPathAsPlatform(sandbox, path.win32);

        const result = await readProjectProperties(mockSqlProjectsService, projectPath);

        expect(result, "project properties should be successfully retrieved").to.exist;
        expect(result?.dacpacOutputPath, "dacpac output path read from properties").to.exist;

        // The dacpac path should use forward slashes, not backslashes
        expect(result?.dacpacOutputPath).to.not.include("/");
        expect(result?.dacpacOutputPath).to.include("\\");

        // Verify the path is constructed correctly with forward slashes
        const expectedPath = path.win32.join(
            "C:\\Users\\TestUser\\project",
            "bin\\Debug",
            "TestProject.dacpac",
        );

        expect(result?.dacpacOutputPath).to.equal(expectedPath);
    });

    test("readProjectProperties handles absolute paths", async () => {
        const projectPath = "/home/user/project/TestProject.sqlproj";
        const absoluteOutputPath = "/absolute/output/path";

        mockSqlProjectsService.getProjectProperties.resolves({
            success: true,
            outputPath: absoluteOutputPath,
            databaseSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
        } as GetProjectPropertiesResult);

        const result = await readProjectProperties(mockSqlProjectsService, projectPath);

        expect(result).to.exist;
        expect(result?.dacpacOutputPath).to.exist;

        // For absolute paths, should use the absolute path directly
        const expectedPath = path.join(absoluteOutputPath, "TestProject.dacpac");
        expect(result?.dacpacOutputPath).to.equal(expectedPath);
    });

    test("readProjectProperties normalizes Windows backslashes in absolute paths", async () => {
        const projectPath = "/home/user/project/TestProject.sqlproj";
        // Absolute path with Windows-style backslashes that gets normalized
        const absoluteOutputPath = "\\absolute\\output\\path";

        mockSqlProjectsService.getProjectProperties.resolves({
            success: true,
            outputPath: absoluteOutputPath,
            databaseSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
        } as GetProjectPropertiesResult);

        const result = await readProjectProperties(mockSqlProjectsService, projectPath);

        expect(result).to.exist;
        expect(result?.dacpacOutputPath).to.exist;

        // After normalization, the backslashes become forward slashes
        // Unix-style absolute paths (starting with /) are absolute on both Windows and Unix
        const expectedPath = path.join("/absolute/output/path", "TestProject.dacpac");
        expect(result?.dacpacOutputPath).to.equal(expectedPath);
    });

    test("readProjectProperties handles relative paths with forward slashes", async () => {
        const projectPath = "/home/user/project/TestProject.sqlproj";

        mockSqlProjectsService.getProjectProperties.resolves({
            success: true,
            outputPath: "bin/Debug", // Unix-style path
            databaseSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
        } as GetProjectPropertiesResult);

        const result = await readProjectProperties(mockSqlProjectsService, projectPath);

        expect(result).to.exist;
        expect(result?.dacpacOutputPath).to.exist;

        const expectedPath = path.join("/home/user/project", "bin/Debug", "TestProject.dacpac");
        expect(result?.dacpacOutputPath).to.equal(expectedPath);
    });
});
