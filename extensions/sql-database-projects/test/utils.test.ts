/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as path from "path";
import * as os from "os";
import * as constants from "../src/common/constants";
import * as utils from "../src/common/utils";

import { createDummyFileStructure, deleteGeneratedTestFolder } from "./testUtils";
import { Uri } from "vscode";

suite("Tests to verify utils functions", function (): void {
    test("Should determine existence of files/folders", async () => {
        let testFolderPath = await createDummyFileStructure(undefined);

        expect(
            await utils.exists(testFolderPath),
            "Should detect that test folder exists",
        ).to.equal(true);
        expect(
            await utils.exists(path.join(testFolderPath, "file1.sql")),
            "Should detect that file1.sql exists",
        ).to.equal(true);
        expect(
            await utils.exists(path.join(testFolderPath, "folder2")),
            "Should detect that folder2 exists",
        ).to.equal(true);
        expect(
            await utils.exists(path.join(testFolderPath, "folder4")),
            "Should detect that folder4 does not exist",
        ).to.equal(false);
        expect(
            await utils.exists(path.join(testFolderPath, "folder2", "file4.sql")),
            "Should detect that file4.sql in folder2 exists",
        ).to.equal(true);
        expect(
            await utils.exists(path.join(testFolderPath, "folder4", "file2.sql")),
            "Should detect that file2.sql in non-existent folder4 does not exist",
        ).to.equal(false);

        await deleteGeneratedTestFolder();
    });

    test("Should get correct relative paths of files/folders", async () => {
        const root = os.platform() === "win32" ? "Z:\\" : "/";
        let projectUri = Uri.file(path.join(root, "project", "folder", "project.sqlproj"));
        let fileUri = Uri.file(path.join(root, "project", "folder", "file.sql"));
        expect(
            utils.trimUri(projectUri, fileUri),
            "Should return relative path for file in same folder",
        ).to.equal("file.sql");

        fileUri = Uri.file(path.join(root, "project", "file.sql"));
        let urifile = utils.trimUri(projectUri, fileUri);
        expect(urifile, "Should return relative path with ../ for file in parent folder").to.equal(
            "../file.sql",
        );

        fileUri = Uri.file(path.join(root, "project", "forked", "file.sql"));
        expect(
            utils.trimUri(projectUri, fileUri),
            "Should return relative path for file in sibling folder",
        ).to.equal("../forked/file.sql");

        fileUri = Uri.file(path.join(root, "forked", "from", "top", "file.sql"));
        expect(
            utils.trimUri(projectUri, fileUri),
            "Should return relative path for file in deeply nested different branch",
        ).to.equal("../../forked/from/top/file.sql");
    });

    test("Should remove $() from sqlcmd variables", () => {
        expect(
            utils.removeSqlCmdVariableFormatting("$(test)"),
            "$() surrounding the variable should have been removed",
        ).to.equal("test");
        expect(
            utils.removeSqlCmdVariableFormatting("$(test"),
            "$( at the beginning of the variable should have been removed",
        ).to.equal("test");
        expect(
            utils.removeSqlCmdVariableFormatting("test"),
            "string should not have been changed because it is not in sqlcmd variable format",
        ).to.equal("test");
    });

    test("Should make variable be in sqlcmd variable format with $()", () => {
        expect(
            utils.formatSqlCmdVariable("$(test)"),
            "string should not have been changed because it was already in the correct format",
        ).to.equal("$(test)");
        expect(
            utils.formatSqlCmdVariable("test"),
            "string should have been changed to be in sqlcmd variable format",
        ).to.equal("$(test)");
        expect(
            utils.formatSqlCmdVariable("$(test"),
            "string should have been changed to be in sqlcmd variable format",
        ).to.equal("$(test)");
        expect(
            utils.formatSqlCmdVariable(""),
            "should not do anything to an empty string",
        ).to.equal("");
    });

    test("Should determine invalid sqlcmd variable names", () => {
        // valid names
        expect(
            utils.validateSqlCmdVariableName("$(test)"),
            "Variable name in full $() format should be valid",
        ).to.equal(null);
        expect(
            utils.validateSqlCmdVariableName("$(test    )"),
            "trailing spaces should be valid because they will be trimmed",
        ).to.equal(null);
        expect(
            utils.validateSqlCmdVariableName("test"),
            "Plain variable name should be valid",
        ).to.equal(null);
        expect(
            utils.validateSqlCmdVariableName("test  "),
            "trailing spaces should be valid because they will be trimmed",
        ).to.equal(null);
        expect(
            utils.validateSqlCmdVariableName("$(test"),
            "Variable name with $( prefix only should be valid",
        ).to.equal(null);
        expect(
            utils.validateSqlCmdVariableName("$(test    "),
            "trailing spaces should be valid because they will be trimmed",
        ).to.equal(null);

        // whitespace
        expect(
            utils.validateSqlCmdVariableName(""),
            "Empty string should return whitespace error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainWhitespace(""));
        expect(
            utils.validateSqlCmdVariableName(" "),
            "Single space should return whitespace error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainWhitespace(" "));
        expect(
            utils.validateSqlCmdVariableName("     "),
            "Multiple spaces should return whitespace error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainWhitespace("     "));
        expect(
            utils.validateSqlCmdVariableName("test abc"),
            "Name with embedded space should return whitespace error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainWhitespace("test abc"));
        expect(
            utils.validateSqlCmdVariableName("	"),
            "Tab character should return whitespace error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainWhitespace("	"));

        // invalid characters
        expect(
            utils.validateSqlCmdVariableName("$($test"),
            "Name with $ inside $( should return illegal chars error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainIllegalChars("$($test"));
        expect(
            utils.validateSqlCmdVariableName("$test"),
            "Name starting with $ should return illegal chars error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainIllegalChars("$test"));
        expect(
            utils.validateSqlCmdVariableName("test@"),
            "Name with @ should return illegal chars error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainIllegalChars("test@"));
        expect(
            utils.validateSqlCmdVariableName("test#"),
            "Name with # should return illegal chars error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainIllegalChars("test#"));
        expect(
            utils.validateSqlCmdVariableName('test"'),
            "Name with double quote should return illegal chars error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainIllegalChars('test"'));
        expect(
            utils.validateSqlCmdVariableName("test'"),
            "Name with single quote should return illegal chars error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainIllegalChars("test'"));
        expect(
            utils.validateSqlCmdVariableName("test-1"),
            "Name with hyphen should return illegal chars error",
        ).to.equal(constants.sqlcmdVariableNameCannotContainIllegalChars("test-1"));
    });

    test("Should convert from milliseconds to hr min sec correctly", () => {
        expect(
            utils.timeConversion(60 * 60 * 1000 + 59 * 60 * 1000 + 59 * 1000),
            "Should convert to hr, min, sec format",
        ).to.equal("1 hr, 59 min, 59 sec");
        expect(
            utils.timeConversion(60 * 60 * 1000 + 59 * 60 * 1000),
            "Should convert to hr, min format",
        ).to.equal("1 hr, 59 min");
        expect(utils.timeConversion(60 * 60 * 1000), "Should convert to hr only format").to.equal(
            "1 hr",
        );
        expect(
            utils.timeConversion(60 * 60 * 1000 + 59 * 1000),
            "Should convert to hr, sec format omitting zero min",
        ).to.equal("1 hr, 59 sec");
        expect(
            utils.timeConversion(59 * 60 * 1000 + 59 * 1000),
            "Should convert to min, sec format",
        ).to.equal("59 min, 59 sec");
        expect(utils.timeConversion(59 * 1000), "Should convert to sec only format").to.equal(
            "59 sec",
        );
        expect(utils.timeConversion(59), "Should convert to msec for sub-second values").to.equal(
            "59 msec",
        );
    });

    test("Should correctly detect present commands", async () => {
        expect(
            await utils.detectCommandInstallation("node"),
            '"node" should have been detected.',
        ).to.equal(true);
        expect(
            await utils.detectCommandInstallation("bogusFakeCommand"),
            '"bogusFakeCommand" should have been detected.',
        ).to.equal(false);
    });
});
