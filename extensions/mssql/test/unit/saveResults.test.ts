/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";

import * as Interfaces from "../../src/models/interfaces";
import ResultsSerializer, { SaveAsRequestParams } from "../../src/models/resultsSerializer";
import { SaveResultsAsCsvRequestParams } from "../../src/models/contracts";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as Contracts from "../../src/models/contracts";
import { stubVscodeWrapper } from "./utils";

chai.use(sinonChai);

suite("save results tests", () => {
    const testFile = "file:///my/test/file.sql";
    let sandbox: sinon.SinonSandbox;
    let fileUri: vscode.Uri;
    let serverClient: sinon.SinonStubbedInstance<SqlToolsServerClient>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

    setup(() => {
        sandbox = sinon.createSandbox();
        serverClient = sandbox.createStubInstance(SqlToolsServerClient);
        vscodeWrapper = stubVscodeWrapper(sandbox);
        (vscodeWrapper.getConfiguration as sinon.SinonStub).callsFake(
            (extensionName: string, resource?: vscode.ConfigurationScope) => {
                return vscode.workspace.getConfiguration(extensionName, resource);
            },
        );
        if (os.platform() === "win32") {
            fileUri = vscode.Uri.file("c:\\test.csv");
        } else {
            fileUri = vscode.Uri.file("/test.csv");
        }
    });

    teardown(() => {
        sandbox.restore();
    });

    function createSerializer(): ResultsSerializer {
        return new ResultsSerializer(serverClient, vscodeWrapper);
    }

    function configureSuccess(
        saveDialogUri: vscode.Uri = fileUri,
        response: Partial<Contracts.SaveResultRequestResult> = {},
    ): void {
        (vscodeWrapper.showSaveDialog as sinon.SinonStub).resolves(saveDialogUri);
        (vscodeWrapper.openTextDocument as sinon.SinonStub).resolves(
            undefined as unknown as vscode.TextDocument,
        );
        (vscodeWrapper.showTextDocument as sinon.SinonStub).resolves(
            undefined as unknown as vscode.TextEditor,
        );
        (vscodeWrapper.showInformationMessage as sinon.SinonStub).returns(undefined);
        serverClient.sendRequest.resolves({ messages: undefined, ...response });
    }

    function configureFailure(message: string): void {
        (vscodeWrapper.showSaveDialog as sinon.SinonStub).resolves(fileUri);
        (vscodeWrapper.showErrorMessage as sinon.SinonStub).returns(undefined);
        serverClient.sendRequest.resolves({ messages: message });
    }

    test("check if filepath prompt displays and right value is set", (done) => {
        (vscodeWrapper.showSaveDialog as sinon.SinonStub).resolves(fileUri);
        serverClient.sendRequest.callsFake((type, details: SaveResultsAsCsvRequestParams) => {
            try {
                expect(details.ownerUri).to.equal(testFile);
                expect(details.filePath).to.equal(fileUri.fsPath);
                done();
            } catch (error) {
                done(error);
            }
            return Promise.resolve({ messages: "failure" });
        });

        const saveResults = createSerializer();
        void saveResults.onSaveResults(testFile, 0, 0, "csv", undefined);
    });

    function testSaveSuccess(format: string): Thenable<void> {
        configureSuccess();
        const saveResults = createSerializer();
        return saveResults.onSaveResults(testFile, 0, 0, format, undefined).then(() => {
            expect(vscodeWrapper.showInformationMessage).to.have.been.calledOnce;
        });
    }

    function testSaveFailure(format: string): Thenable<void> {
        configureFailure("failure");
        const saveResults = createSerializer();
        return saveResults.onSaveResults(testFile, 0, 0, format, undefined).then(() => {
            expect(vscodeWrapper.showErrorMessage).to.have.been.calledOnce;
        });
    }

    test("Save as CSV - test if information message is displayed on success", () => {
        return testSaveSuccess("csv");
    });

    test("Save as CSV - test if error message is displayed on failure to save", () => {
        return testSaveFailure("csv");
    });

    test("Save as JSON - test if information message is displayed on success", () => {
        return testSaveSuccess("json");
    });

    test("Save as JSON - test if error message is displayed on failure to save", () => {
        return testSaveFailure("json");
    });

    test("Save as Excel - test if information message is displayed on success", () => {
        return testSaveSuccess("excel");
    });

    test("Save as Excel - test if error message is displayed on failure to save", () => {
        return testSaveFailure("excel");
    });

    test("Save as with selection - test if selected range is passed in parameters", () => {
        const selection: Interfaces.ISlickRange[] = [
            {
                fromCell: 0,
                toCell: 1,
                fromRow: 0,
                toRow: 1,
            },
        ];

        configureSuccess();
        serverClient.sendRequest.callsFake((type, params: SaveResultsAsCsvRequestParams) => {
            expect(params.columnStartIndex).to.equal(selection[0].fromCell);
            expect(params.columnEndIndex).to.equal(selection[0].toCell);
            expect(params.rowStartIndex).to.equal(selection[0].fromRow);
            expect(params.rowEndIndex).to.equal(selection[0].toRow);
            return Promise.resolve({ messages: undefined });
        });

        const saveResults = createSerializer();
        return saveResults.onSaveResults(testFile, 0, 0, "csv", selection);
    });

    test("Save as with selection - test case when right click on single cell - no selection is set in parameters", () => {
        const selection: Interfaces.ISlickRange[] = [
            {
                fromCell: 0,
                toCell: 0,
                fromRow: 0,
                toRow: 0,
            },
        ];

        configureSuccess();
        serverClient.sendRequest.callsFake((type, params: SaveResultsAsCsvRequestParams) => {
            expect(params.columnStartIndex).to.equal(undefined);
            expect(params.columnEndIndex).to.equal(undefined);
            expect(params.rowStartIndex).to.equal(undefined);
            expect(params.rowEndIndex).to.equal(undefined);
            return Promise.resolve({ messages: undefined });
        });

        const saveResults = createSerializer();
        return saveResults.onSaveResults(testFile, 0, 0, "csv", selection);
    });

    test("canceling out of save file dialog cancels serialization", async () => {
        (vscodeWrapper.showSaveDialog as sinon.SinonStub).resolves(undefined);

        const saveResults = createSerializer();
        await saveResults.onSaveResults(testFile, 0, 0, "csv", undefined);

        expect(serverClient.sendRequest).to.not.have.been.called;
    });

    test("CSV configuration options are properly applied", (done) => {
        const customWrapper = stubVscodeWrapper(sandbox);
        (customWrapper.showSaveDialog as sinon.SinonStub).resolves(fileUri);
        (customWrapper.getConfiguration as sinon.SinonStub).returns({
            saveAsCsv: {
                delimiter: "\t",
                encoding: "utf-16le",
                includeHeaders: false,
                textIdentifier: "'",
                lineSeparator: "\r\n",
            },
        } as unknown as vscode.WorkspaceConfiguration);

        serverClient.sendRequest.callsFake((_type, params: SaveResultsAsCsvRequestParams) => {
            try {
                expect(params.delimiter).to.equal("\t");
                expect(params.encoding).to.equal("utf-16le");
                expect(params.includeHeaders).to.equal(false);
                expect(params.textIdentifier).to.equal("'");
                expect(params.lineSeperator).to.equal("\r\n");
                done();
            } catch (error) {
                done(error);
            }
            return Promise.resolve({ messages: undefined });
        });

        const saveResults = new ResultsSerializer(serverClient, customWrapper);
        void saveResults.onSaveResults(testFile, 0, 0, "csv", undefined);
    });

    test("Save as INSERT - test if information message is displayed on success", () => {
        return testSaveSuccess("insert");
    });

    test("Save as INSERT - test if error message is displayed on failure to save", () => {
        return testSaveFailure("insert");
    });

    test("Save as INSERT - test if correct file extension is used", (done) => {
        (vscodeWrapper.showSaveDialog as sinon.SinonStub).callsFake(
            (options: vscode.SaveDialogOptions) => {
                try {
                    expect(options.filters?.["SQL Files"], "Should have SQL Files filter").to.exist;
                    expect(
                        options.filters?.["SQL Files"],
                        "Should use .sql extension",
                    ).to.deep.equal(["sql"]);
                    done();
                } catch (error) {
                    done(error);
                }
                return Promise.resolve(fileUri);
            },
        );
        serverClient.sendRequest.resolves({ messages: undefined });

        const saveResults = createSerializer();
        void saveResults.onSaveResults(testFile, 0, 0, "insert", undefined);
    });

    test("Save as INSERT - test if correct request type is used", (done) => {
        (vscodeWrapper.showSaveDialog as sinon.SinonStub).resolves(fileUri);
        serverClient.sendRequest.callsFake((type, params: SaveAsRequestParams) => {
            try {
                expect(type.method, "Should use INSERT request type").to.equal("query/saveInsert");
                expect(params.ownerUri).to.equal(testFile);
                expect(params.filePath).to.equal(fileUri.fsPath);
                done();
            } catch (error) {
                done(error);
            }
            return Promise.resolve({ messages: undefined });
        });

        const saveResults = createSerializer();
        void saveResults.onSaveResults(testFile, 0, 0, "insert", undefined);
    });
});
