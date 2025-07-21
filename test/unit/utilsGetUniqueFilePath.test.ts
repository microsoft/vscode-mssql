/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as utils from "../../src/utils/utils";

suite("Utils - getUniqueFilePath tests", () => {
    let sandbox: sinon.SinonSandbox;
    let existsStub: sinon.SinonStub;
    const testFolder = vscode.Uri.file("/test/folder");

    setup(() => {
        sandbox = sinon.createSandbox();
        existsStub = sandbox.stub(utils, "exists");
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should handle basename without extension correctly", async () => {
        // Setup: no existing files
        existsStub.resolves(false);

        const result = await utils.getUniqueFilePath(testFolder, "Script1", "sql");
        expect(result.fsPath).to.equal("/test/folder/Script1.sql");
    });

    test("should handle basename with extension correctly (no double extension)", async () => {
        // Setup: no existing files
        existsStub.resolves(false);

        const result = await utils.getUniqueFilePath(testFolder, "Script1.sql", "sql");
        expect(result.fsPath).to.equal("/test/folder/Script1.sql");
    });

    test("should append number when file with extension already exists", async () => {
        // Setup: Script1.sql exists, but Script11.sql doesn't
        existsStub.callsFake((path: string) => {
            return Promise.resolve(path === "Script1.sql");
        });

        const result = await utils.getUniqueFilePath(testFolder, "Script1.sql", "sql");
        expect(result.fsPath).to.equal("/test/folder/Script11.sql");
    });

    test("should append number when file without extension exists", async () => {
        // Setup: Script1.sql exists, but Script11.sql doesn't
        existsStub.callsFake((path: string) => {
            return Promise.resolve(path === "Script1.sql");
        });

        const result = await utils.getUniqueFilePath(testFolder, "Script1", "sql");
        expect(result.fsPath).to.equal("/test/folder/Script11.sql");
    });

    test("should handle multiple existing files and find next available number", async () => {
        // Setup: Script1.sql, Script11.sql, Script12.sql exist, but Script13.sql doesn't
        existsStub.callsFake((path: string) => {
            const existingFiles = ["Script1.sql", "Script11.sql", "Script12.sql"];
            return Promise.resolve(existingFiles.includes(path));
        });

        const result = await utils.getUniqueFilePath(testFolder, "Script1.sql", "sql");
        expect(result.fsPath).to.equal("/test/folder/Script13.sql");
    });

    test("should work with different file extensions", async () => {
        // Setup: no existing files
        existsStub.resolves(false);

        const result = await utils.getUniqueFilePath(testFolder, "document.txt", "txt");
        expect(result.fsPath).to.equal("/test/folder/document.txt");
    });

    test("should work with extensions that don't match basename extension", async () => {
        // Setup: no existing files
        existsStub.resolves(false);

        // User provides "Script1.sql" but we want to create a ".json" file
        const result = await utils.getUniqueFilePath(testFolder, "Script1.sql", "json");
        expect(result.fsPath).to.equal("/test/folder/Script1.sql.json");
    });
});
