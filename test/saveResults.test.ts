import * as TypeMoq from 'typemoq';
import assert = require('assert');
import Constants = require('../src/models/constants');
import ResultsSerializer  from './../src/models/resultsSerializer';
import { SaveResultsAsCsvRequest } from './../src/models/contracts';
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
        answers[Constants.filepathPrompt] = filePath;

        // setup mock filepath prompt
        prompter.setup(x => x.prompt(TypeMoq.It.isAny())).callback(questions => {
            filePathQuestions = questions;
            })
            .returns((questions: IQuestion[]) => Promise.resolve(answers));

        // setup mock sql tools server client
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                        .callback((type, details: SaveResultsAsCsvRequest.SaveResultsRequestParams) => {
                                                // check if filepath was set from answered prompt
                                                assert.equal(details.ownerUri, testFile);
                                                assert.equal(details.filePath, filePath);
                                        })
                                        .returns(() => {
                                            return Promise.resolve({messages: undefined});
                                        });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        saveResults.onSaveResultsAsCsv(testFile, 0, 0).then( () => {
            assert.equal(filePathQuestions[0].name, Constants.filepathPrompt );
        });

    });

    test('check if filename resolves to absolute filepath with current directory', () => {

        let answers = {};
        let params: SaveResultsAsCsvRequest.SaveResultsRequestParams;
        let filename = 'testfilename.csv';
        let resolvedFilePath = '';
        if (os.platform() === 'win32') {
            resolvedFilePath = '\\my\\test\\testfilename.csv';
        } else {
            resolvedFilePath = '/my/test/testfilename.csv';
        }
        answers['File path'] = filename;
        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                        .returns((questions: IQuestion[]) => Promise.resolve(answers));

        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                    .callback((type, details: SaveResultsAsCsvRequest.SaveResultsRequestParams) => {
                                                              params = details;
                                    })
                                    .returns(() => {
                                        return Promise.resolve({messages: undefined});
                                    });
        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResultsAsCsv(testFile, 0, 0).then( () => {
                                    // check if filename is resolved to full path
                                    // resolvedpath = current directory + filename
                                    assert.equal( params.filePath, resolvedFilePath);
                                });
    });


    test('Save as CSV - test if information message is displayed on success', () => {

        let answers = {};
        answers['File path'] = filePath;

        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                    .returns((questions: IQuestion[]) => Promise.resolve(answers));
        vscodeWrapper.setup(x => x.showInformationMessage(TypeMoq.It.isAnyString()));
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                    .returns(() => {
                                        return Promise.resolve({messages: 'Success'});
                                    });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResultsAsCsv( testFile, 0, 0).then( () => {
                    // check if information message was displayed
                    vscodeWrapper.verify(x => x.showInformationMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Save as CSV - test if error message is displayed on failure to save', () => {

        let answers = {};
        answers['File path'] = filePath;

        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                .returns((questions: IQuestion[]) => Promise.resolve(answers));
        vscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                .returns(() => {
                                    return Promise.resolve({messages: 'failure'});
                                });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResultsAsCsv( testFile, 0, 0).then( () => {
                    // check if error message was displayed
                    vscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Save as JSON - test if information message is displayed on success', () => {

        let answers = {};
        answers['File path'] = filePath;

        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                    .returns((questions: IQuestion[]) => Promise.resolve(answers));
        vscodeWrapper.setup(x => x.showInformationMessage(TypeMoq.It.isAnyString()));
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                    .returns(() => {
                                        return Promise.resolve({messages: 'Success'});
                                    });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResultsAsJson( testFile, 0, 0).then( () => {
                    // check if information message was displayed
                    vscodeWrapper.verify(x => x.showInformationMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Save as JSON - test if error message is displayed on failure to save', () => {

        let answers = {};
        answers['File path'] = filePath;

        // setup mocks
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                                .returns((questions: IQuestion[]) => Promise.resolve(answers));
        vscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
        serverClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                                .returns(() => {
                                    return Promise.resolve({messages: 'failure'});
                                });

        let saveResults = new ResultsSerializer(serverClient.object, prompter.object, vscodeWrapper.object);
        return saveResults.onSaveResultsAsJson( testFile, 0, 0).then( () => {
                    // check if error message was displayed
                    vscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });
});
