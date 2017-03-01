import * as TypeMoq from 'typemoq';
import assert = require('assert');
import LocalizedConstants = require('../src/constants/localizedConstants');
import Interfaces = require('../src/models/interfaces');
import ResultsSerializer  from './../src/models/resultsSerializer';
import { SaveResultsAsCsvRequestParams } from './../src/models/contracts';
import SqlToolsServerClient from './../src/languageservice/serviceclient';
import { IQuestion, IPrompter } from '../src/prompts/question';
import { TestPrompter } from './stubs';
import VscodeWrapper from './../src/controllers/vscodeWrapper';
import os = require('os');

suite('save results tests', () => {

    const testFile = 'file:///my/test/file.sql';
    let filePath = '';
    let serverClient: TypeMoq.Mock<SqlToolsServerClient>;
    let prompter: TypeMoq.Mock<IPrompter>;
    let vscodeWrapper: TypeMoq.Mock<VscodeWrapper>;

    setup(() => {

        serverClient = TypeMoq.Mock.ofType(SqlToolsServerClient, TypeMoq.MockBehavior.Strict);
        prompter = TypeMoq.Mock.ofType(TestPrompter);
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        if (os.platform() === 'win32') {
            filePath = 'c:\\test.csv';
        } else {
            filePath = '/test.csv';
        }
    });


    test('check if filepath prompt displays and right value is set', () => {

        let filePathQuestions: IQuestion[];
        let answers = {};
        answers[LocalizedConstants.filepathPrompt] = filePath;

        // setup mock filepath prompt
        prompter.setup(x => x.prompt(TypeMoq.It.isAny())).callback(questions => {
            filePathQuestions = questions;
            })
            .returns((questions: IQuestion[]) => Promise.resolve(answers));
        // setup mock sql tools server client
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                        .callback((type, details: SaveResultsAsCsvRequestParams) => {
                                                // check if filepath was set from answered prompt
                                                assert.equal(details.ownerUri, testFile);
                                                assert.equal(details.filePath, filePath);
                                        })
                                        .returns(() => {
                                            // This will come back as null from the service layer, but tslinter doesn't like that
                                            return Promise.resolve({messages: 'failure'});
                                        });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);

        saveResults.onSaveResults(testFile, 0, 0, 'csv', undefined).then( () => {
            assert.equal(filePathQuestions[0].name, LocalizedConstants.filepathPrompt );
        });

    });

    test('check if overwrite prompt displays and right value is set', () => {

        let filePathQuestions: IQuestion[];
        let answers = {};
        answers[LocalizedConstants.filepathPrompt] = filePath;
        answers[LocalizedConstants.overwritePrompt] = true;

        // setup mock filepath prompt
        prompter.setup(x => x.prompt(TypeMoq.It.isAny())).callback(questions => {
            filePathQuestions = questions;
            })
            .returns((questions: IQuestion[]) => Promise.resolve(answers));

        // setup mock sql tools server client
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                        .callback((type, details: SaveResultsAsCsvRequestParams) => {
                                                // check if filepath was set from answered prompt
                                                assert.equal(details.ownerUri, testFile);
                                                assert.equal(details.filePath, filePath);
                                        })
                                        .returns(() => {
                                            // This will come back as null from the service layer, but tslinter doesn't like that
                                            return Promise.resolve({messages: 'failure'});
                                        });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);

        saveResults.onSaveResults(testFile, 0, 0, 'csv', undefined).then( () => {
            assert.equal(filePathQuestions[0].name, LocalizedConstants.filepathPrompt );
        });

    });

    test('check if filename resolves to absolute filepath with current directory', () => {

        let answers = {};
        let params: SaveResultsAsCsvRequestParams;
        let filename = 'testfilename.csv';
        let resolvedFilePath = '';
        if (os.platform() === 'win32') {
            resolvedFilePath = '\\my\\test\\testfilename.csv';
        } else {
            resolvedFilePath = '/my/test/testfilename.csv';
        }
        answers[LocalizedConstants.filepathPrompt] = filename;
        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                        .returns((questions: IQuestion[]) => Promise.resolve(answers));

        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                    .callback((type, details: SaveResultsAsCsvRequestParams) => {
                                                              params = details;
                                    })
                                    .returns(() => {
                                        // This will come back as null from the service layer, but tslinter doesn't like that
                                        return Promise.resolve({messages: 'failure'});
                                    });
        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResults(testFile, 0, 0, 'csv', undefined).then( () => {
                                    // check if filename is resolved to full path
                                    // resolvedpath = current directory + filename
                                    assert.equal( params.filePath, resolvedFilePath);
                                });
    });


    test('Save as CSV - test if information message is displayed on success', () => {

        let answers = {};
        answers[LocalizedConstants.filepathPrompt] = filePath;

        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                    .returns((questions: IQuestion[]) => Promise.resolve(answers));
        vscodeWrapper.setup(x => x.showInformationMessage(TypeMoq.It.isAnyString()));
        vscodeWrapper.setup(x => x.openTextDocument(TypeMoq.It.isAny())).returns(() => {
                                            return Promise.resolve(undefined);
                                        });
        vscodeWrapper.setup(x => x.showTextDocument(TypeMoq.It.isAny())).returns(() => {
                                            return Promise.resolve(undefined);
                                        });
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                    .returns(() => {
                                        // This will come back as null from the service layer, but tslinter doesn't like that
                                        return Promise.resolve({messages: undefined});
                                    });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResults( testFile, 0, 0, 'csv', undefined).then( () => {
                    // check if information message was displayed
                    vscodeWrapper.verify(x => x.showInformationMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Save as CSV - test if error message is displayed on failure to save', () => {

        let answers = {};
        answers[LocalizedConstants.filepathPrompt] = filePath;

        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                .returns((questions: IQuestion[]) => Promise.resolve(answers));
        vscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                .returns(() => {
                                    return Promise.resolve({messages: 'failure'});
                                });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResults( testFile, 0, 0, 'csv', undefined).then( () => {
                    // check if error message was displayed
                    vscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Save as JSON - test if information message is displayed on success', () => {

        let answers = {};
        answers[LocalizedConstants.filepathPrompt] = filePath;

        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                    .returns((questions: IQuestion[]) => Promise.resolve(answers));
        vscodeWrapper.setup(x => x.showInformationMessage(TypeMoq.It.isAnyString()));
        vscodeWrapper.setup(x => x.openTextDocument(TypeMoq.It.isAny())).returns(() => {
                                            return Promise.resolve(undefined);
                                        });
        vscodeWrapper.setup(x => x.showTextDocument(TypeMoq.It.isAny())).returns(() => {
                                            return Promise.resolve(undefined);
                                        });
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                    .returns(() => {
                                        // This will come back as null from the service layer, but tslinter doesn't like that
                                        return Promise.resolve({messages: undefined});
                                    });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResults( testFile, 0, 0, 'json', undefined).then( () => {
                    // check if information message was displayed
                    vscodeWrapper.verify(x => x.showInformationMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Save as JSON - test if error message is displayed on failure to save', () => {

        let answers = {};
        answers[LocalizedConstants.filepathPrompt] = filePath;

        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                .returns((questions: IQuestion[]) => Promise.resolve(answers));
        vscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                .returns(() => {
                                    return Promise.resolve({messages: 'failure'});
                                });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResults( testFile, 0, 0, 'json', undefined).then( () => {
                    // check if error message was displayed
                    vscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Save as with selection - test if selected range is passed in parameters', () => {

        let answers = {};
        answers[LocalizedConstants.filepathPrompt] = filePath;
        let selection: Interfaces.ISlickRange[] = [{
            fromCell: 0,
            toCell: 1,
            fromRow: 0,
            toRow: 1
        }];

        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                    .returns((questions: IQuestion[]) => Promise.resolve(answers));
        vscodeWrapper.setup(x => x.showInformationMessage(TypeMoq.It.isAnyString()));
        vscodeWrapper.setup(x => x.openTextDocument(TypeMoq.It.isAny())).returns(() => {
                                            return Promise.resolve(undefined);
                                        });
        vscodeWrapper.setup(x => x.showTextDocument(TypeMoq.It.isAny())).returns(() => {
                                            return Promise.resolve(undefined);
                                        });
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                    .callback((type, params: SaveResultsAsCsvRequestParams) => {
                                                            // check if right parameters were set from the selection
                                                            assert.equal( params.columnStartIndex, selection[0].fromCell);
                                                            assert.equal( params.columnEndIndex, selection[0].toCell);
                                                            assert.equal( params.rowStartIndex, selection[0].fromRow);
                                                            assert.equal( params.rowEndIndex, selection[0].toRow);

                                    })
                                    .returns(() => {
                                        // This will come back as null from the service layer, but tslinter doesn't like that
                                        return Promise.resolve({messages: 'failure'});
                                    });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResults( testFile, 0, 0, 'csv', selection);
    });

    test('Save as with selection - test case when right click on single cell - no selection is set in parameters', () => {

        let answers = {};
        answers[LocalizedConstants.filepathPrompt] = filePath;
        let selection: Interfaces.ISlickRange[] = [{
            fromCell: 0,
            toCell: 0,
            fromRow: 0,
            toRow: 0
        }];

        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                    .returns((questions: IQuestion[]) => Promise.resolve(answers));
        vscodeWrapper.setup(x => x.showInformationMessage(TypeMoq.It.isAnyString()));
        vscodeWrapper.setup(x => x.openTextDocument(TypeMoq.It.isAny())).returns(() => {
                                            return Promise.resolve(undefined);
                                        });
        vscodeWrapper.setup(x => x.showTextDocument(TypeMoq.It.isAny())).returns(() => {
                                            return Promise.resolve(undefined);
                                        });
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                    .callback((type, params: SaveResultsAsCsvRequestParams) => {
                                                            // Check if selection parameters were undefined in the request
                                                            // When rightclicking on resultgrid to save entire result set,
                                                            // the cell that was clicked on is sent in selection from the front end
                                                            assert.equal( params.columnStartIndex, undefined);
                                                            assert.equal( params.columnEndIndex, undefined);
                                                            assert.equal( params.rowStartIndex, undefined);
                                                            assert.equal( params.rowEndIndex, undefined);

                                    })
                                    .returns(() => {
                                        // This will come back as null from the service layer, but tslinter doesn't like that
                                        return Promise.resolve({messages: 'failure'});
                                    });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResults( testFile, 0, 0, 'csv', selection);
    });
});
