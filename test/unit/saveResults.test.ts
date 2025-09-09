/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as assert from "assert";
import * as Interfaces from "../../src/models/interfaces";
import ResultsSerializer from "../../src/models/resultsSerializer";
import { SaveResultsAsCsvRequestParams } from "../../src/models/contracts";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as vscode from "vscode";
import * as os from "os";
import * as sinon from "sinon";

suite("save results tests", () => {
    const testFile = "file:///my/test/file.sql";
    let fileUri: vscode.Uri;
    let serverClient: TypeMoq.IMock<SqlToolsServerClient>;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        serverClient = TypeMoq.Mock.ofType(SqlToolsServerClient, TypeMoq.MockBehavior.Strict);
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        vscodeWrapper
            .setup((x) => x.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((extensionName) => {
                return vscode.workspace.getConfiguration(extensionName);
            });
        if (os.platform() === "win32") {
            fileUri = vscode.Uri.file("c:\\test.csv");
        } else {
            fileUri = vscode.Uri.file("/test.csv");
        }
    });

    teardown(() => {
        sandbox.restore();
    });

    test("check if filepath prompt displays and right value is set", (done) => {
        // setup mock filepath prompt
        vscodeWrapper
            .setup((x) => x.showSaveDialog(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(fileUri));
        // setup mock sql tools server client
        serverClient
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((type, details: SaveResultsAsCsvRequestParams) => {
                // check if filepath was set from answered prompt
                try {
                    assert.equal(details.ownerUri, testFile);
                    assert.equal(details.filePath, fileUri.fsPath);
                    done();
                } catch (error) {
                    done(error);
                }
            })
            .returns(() => {
                // This will come back as null from the service layer, but tslinter doesn't like that
                return Promise.resolve({ messages: "failure" });
            });

        let saveResults = new ResultsSerializer(serverClient.object, vscodeWrapper.object);

        saveResults.onSaveResults(testFile, 0, 0, "csv", undefined);
    });

    function testSaveSuccess(format: string): Thenable<void> {
        // setup mocks
        vscodeWrapper.setup((x) => x.showInformationMessage(TypeMoq.It.isAnyString()));
        vscodeWrapper
            .setup((x) => x.openTextDocument(TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(undefined);
            });
        vscodeWrapper
            .setup((x) => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(undefined);
            });
        vscodeWrapper
            .setup((x) => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(undefined);
            });
        vscodeWrapper
            .setup((x) => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(undefined);
            });
        vscodeWrapper
            .setup((x) => x.showSaveDialog(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(fileUri));
        serverClient
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                // This will come back as null from the service layer, but tslinter doesn't like that
                return Promise.resolve({ messages: undefined });
            });

        let saveResults = new ResultsSerializer(serverClient.object, vscodeWrapper.object);
        return saveResults.onSaveResults(testFile, 0, 0, format, undefined).then(() => {
            // check if information message was displayed
            vscodeWrapper.verify(
                (x) => x.showInformationMessage(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
        });
    }

    function testSaveFailure(format: string): Thenable<void> {
        // setup mocks
        vscodeWrapper.setup((x) => x.showErrorMessage(TypeMoq.It.isAnyString()));
        vscodeWrapper
            .setup((x) => x.showSaveDialog(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(fileUri));
        serverClient
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve({ messages: "failure" });
            });

        let saveResults = new ResultsSerializer(serverClient.object, vscodeWrapper.object);
        return saveResults.onSaveResults(testFile, 0, 0, format, undefined).then(() => {
            // check if error message was displayed
            vscodeWrapper.verify(
                (x) => x.showErrorMessage(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
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
        let selection: Interfaces.ISlickRange[] = [
            {
                fromCell: 0,
                toCell: 1,
                fromRow: 0,
                toRow: 1,
            },
        ];

        // setup mocks
        vscodeWrapper.setup((x) => x.showInformationMessage(TypeMoq.It.isAnyString()));
        vscodeWrapper
            .setup((x) => x.openTextDocument(TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(undefined);
            });
        vscodeWrapper
            .setup((x) => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(undefined);
            });
        vscodeWrapper
            .setup((x) => x.showSaveDialog(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(fileUri));
        serverClient
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((type, params: SaveResultsAsCsvRequestParams) => {
                // check if right parameters were set from the selection
                assert.equal(params.columnStartIndex, selection[0].fromCell);
                assert.equal(params.columnEndIndex, selection[0].toCell);
                assert.equal(params.rowStartIndex, selection[0].fromRow);
                assert.equal(params.rowEndIndex, selection[0].toRow);
            })
            .returns(() => {
                // This will come back as null from the service layer, but tslinter doesn't like that
                return Promise.resolve({ messages: undefined });
            });

        let saveResults = new ResultsSerializer(serverClient.object, vscodeWrapper.object);
        return saveResults.onSaveResults(testFile, 0, 0, "csv", selection);
    });

    test("Save as with selection - test case when right click on single cell - no selection is set in parameters", () => {
        let selection: Interfaces.ISlickRange[] = [
            {
                fromCell: 0,
                toCell: 0,
                fromRow: 0,
                toRow: 0,
            },
        ];

        // setup mocks
        vscodeWrapper.setup((x) => x.showInformationMessage(TypeMoq.It.isAnyString()));
        vscodeWrapper
            .setup((x) => x.openTextDocument(TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(undefined);
            });
        vscodeWrapper
            .setup((x) => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(undefined);
            });
        vscodeWrapper
            .setup((x) => x.showSaveDialog(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(fileUri));
        serverClient
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((type, params: SaveResultsAsCsvRequestParams) => {
                // Check if selection parameters were undefined in the request
                // When rightclicking on resultgrid to save entire result set,
                // the cell that was clicked on is sent in selection from the front end
                assert.equal(params.columnStartIndex, undefined);
                assert.equal(params.columnEndIndex, undefined);
                assert.equal(params.rowStartIndex, undefined);
                assert.equal(params.rowEndIndex, undefined);
            })
            .returns(() => {
                // This will come back as null from the service layer, but tslinter doesn't like that
                return Promise.resolve({ messages: undefined });
            });

        let saveResults = new ResultsSerializer(serverClient.object, vscodeWrapper.object);
        return saveResults.onSaveResults(testFile, 0, 0, "csv", selection);
    });

    test("canceling out of save file dialog cancels serialization", (done) => {
        // setup mock filepath prompt
        vscodeWrapper
            .setup((x) => x.showSaveDialog(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        // setup mock sql tools server client
        serverClient.setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()));

        let saveResults = new ResultsSerializer(serverClient.object, vscodeWrapper.object);

        saveResults.onSaveResults(testFile, 0, 0, "csv", undefined).then(
            () => {
                try {
                    serverClient.verify(
                        (x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                        TypeMoq.Times.never(),
                    );
                    done();
                } catch (error) {
                    done(error);
                }
            },
            (error) => done(error),
        );
    });

    test("CSV configuration options are properly applied", (done) => {
        let vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);

        vscodeWrapper.showSaveDialog = sinon
            .stub<[vscode.SaveDialogOptions], Thenable<vscode.Uri>>()
            .resolves(fileUri);

        vscodeWrapper.getConfiguration = sinon.stub<any>().returns({
            saveAsCsv: {
                delimiter: "\t",
                encoding: "utf-16le",
                includeHeaders: false,
                textIdentifier: "'",
                lineSeparator: "\r\n",
            },
        } as any);

        // setup mock sql tools server client
        serverClient
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((type, params: SaveResultsAsCsvRequestParams) => {
                try {
                    // check if configuration options were properly applied
                    assert.equal(params.delimiter, "\t");
                    assert.equal(params.encoding, "utf-16le");
                    assert.equal(params.includeHeaders, false);
                    assert.equal(params.textIdentifier, "'");
                    assert.equal(params.lineSeperator, "\r\n");
                    done();
                } catch (error) {
                    done(error);
                }
            })
            .returns(() => {
                return Promise.resolve({ messages: undefined });
            });

        let saveResults = new ResultsSerializer(serverClient.object, vscodeWrapper);
        saveResults.onSaveResults(testFile, 0, 0, "csv", undefined);
    });

    test("Save as INSERT - test if information message is displayed on success", () => {
        return testSaveSuccess("insert");
    });

    test("Save as INSERT - test if error message is displayed on failure to save", () => {
        return testSaveFailure("insert");
    });

    test("Save as INSERT - test if correct file extension is used", (done) => {
        // setup mock to verify correct file extension
        vscodeWrapper
            .setup((x) => x.showSaveDialog(TypeMoq.It.isAny()))
            .callback((options: vscode.SaveDialogOptions) => {
                try {
                    // Verify that SQL files filter is available for INSERT format
                    assert.ok(options.filters["SQL Files"], "Should have SQL Files filter");
                    assert.deepEqual(
                        options.filters["SQL Files"],
                        ["sql"],
                        "Should use .sql extension",
                    );
                    done();
                } catch (error) {
                    done(error);
                }
            })
            .returns(() => Promise.resolve(fileUri));

        serverClient
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve({ messages: undefined }));

        let saveResults = new ResultsSerializer(serverClient.object, vscodeWrapper.object);
        saveResults.onSaveResults(testFile, 0, 0, "insert", undefined);
    });

    test("Save as INSERT - test if correct request type is used", (done) => {
        // setup mock filepath prompt
        vscodeWrapper
            .setup((x) => x.showSaveDialog(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(fileUri));

        // setup mock sql tools server client to verify correct request type
        serverClient
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((type, params) => {
                try {
                    // Verify that the request type matches INSERT request
                    assert.equal(type.method, "query/saveInsert", "Should use INSERT request type");
                    assert.equal(params.ownerUri, testFile);
                    assert.equal(params.filePath, fileUri.fsPath);
                    done();
                } catch (error) {
                    done(error);
                }
            })
            .returns(() => Promise.resolve({ messages: undefined }));

        let saveResults = new ResultsSerializer(serverClient.object, vscodeWrapper.object);
        saveResults.onSaveResults(testFile, 0, 0, "insert", undefined);
    });
});
