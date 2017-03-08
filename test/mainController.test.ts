'use strict';
import * as TypeMoq from 'typemoq';

import vscode = require('vscode');
import MainController from '../src/controllers/mainController';
import ConnectionManager from '../src/controllers/connectionManager';
import UntitledSqlDocumentService from '../src/controllers/untitledSqlDocumentService';
import * as Extension from '../src/extension';
import Constants = require('../src/constants/constants');
import LocalizedConstants = require('../src/constants/localizedConstants');
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import { TestExtensionContext } from './stubs';
import assert = require('assert');

suite('MainController Tests', () => {
    let document: vscode.TextDocument;
    let newDocument: vscode.TextDocument;
    let mainController: MainController;
    let connectionManager: TypeMoq.Mock<ConnectionManager>;
    let untitledSqlDocumentService: TypeMoq.Mock<UntitledSqlDocumentService>;
    let docUri: string;
    let newDocUri: string;
    let docUriCallback: string;
    let newDocUriCallback: string;

    setup(() => {
        // Setup a standard document and a new document
        docUri = 'docURI.sql';
        newDocUri = 'newDocURI.sql';

        document = <vscode.TextDocument> {
            uri : {
                toString(skipEncoding?: boolean): string {
                    return docUri;
                }
            },
            languageId : 'sql'
        };

        newDocument = <vscode.TextDocument> {
            uri : {
                toString(skipEncoding?: boolean): string {
                    return newDocUri;
                }
            },
            languageId : 'sql'
        };

        // Resetting call back variables
        docUriCallback = '';
        newDocUriCallback = '';


        // Using the mainController that was instantiated with the extension
        mainController = Extension.getController();

        // Setting up a mocked connectionManager
        connectionManager = TypeMoq.Mock.ofType(ConnectionManager);
        mainController.connectionManager = connectionManager.object;

        untitledSqlDocumentService = TypeMoq.Mock.ofType(UntitledSqlDocumentService);
        mainController.untitledSqlDocumentService = untitledSqlDocumentService.object;

        // Watching these functions and input paramters
        connectionManager.setup(x => x.onDidOpenTextDocument(TypeMoq.It.isAny())).callback((doc) => {
            docUriCallback = doc.uri.toString();
        });

        connectionManager.setup(x => x.onDidCloseTextDocument(TypeMoq.It.isAny())).callback((doc) => {
            docUriCallback = doc.uri.toString();
        });

        connectionManager.setup(x => x.transferFileConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny())).callback((doc, newDoc) => {
            docUriCallback = doc;
            newDocUriCallback = newDoc;
        });
    });



    // Standard closed document event test
    test('onDidCloseTextDocument should propogate onDidCloseTextDocument to connectionManager' , done => {
        mainController.onDidCloseTextDocument(document);
        try {
            connectionManager.verify(x => x.onDidCloseTextDocument(TypeMoq.It.isAny()), TypeMoq.Times.once());
            assert.equal(docUriCallback, document.uri.toString());
            docUriCallback = '';
            done();
        } catch (err) {
            done(new Error(err));
        }
    });

    // Renamed file event test
    test('onDidCloseTextDocument should call renamedDoc function when rename occurs' , done => {
        // A renamed doc constitutes an openDoc event directly followed by a closeDoc event
        mainController.onDidOpenTextDocument(newDocument);
        mainController.onDidCloseTextDocument(document);

        // Verify renameDoc function was called
        try {
            connectionManager.verify(x => x.transferFileConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
            assert.equal(docUriCallback, document.uri.toString());
            assert.equal(newDocUriCallback, newDocument.uri.toString());
            done();
        } catch (err) {
            done(new Error(err));
        }
    });


    // Saved Untitled file event test
    test('onDidCloseTextDocument should call untitledDoc function when an untitled file is saved' , done => {
        // Scheme of older doc must be untitled
        let document2 = <vscode.TextDocument> {
            uri : vscode.Uri.parse(`${LocalizedConstants.untitledScheme}:${docUri}`),
            languageId : 'sql'
        };

        // A save untitled doc constitutes an saveDoc event directly followed by a closeDoc event
        mainController.onDidSaveTextDocument(newDocument);
        mainController.onDidCloseTextDocument(document2);
        try {
            connectionManager.verify(x => x.transferFileConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
            assert.equal(docUriCallback, document2.uri.toString());
            assert.equal(newDocUriCallback, newDocument.uri.toString());
            done();
        } catch (err) {
            done(new Error(err));
        }
    });


    // Closed document event called to test rename and untitled save file event timeouts
    test('onDidCloseTextDocument should propogate to the connectionManager even if a special event occured before it' , done => {
        // Call both special cases
        mainController.onDidSaveTextDocument(newDocument);
        mainController.onDidOpenTextDocument(newDocument);

        // Cause event time out (above 10 ms should work)
        setTimeout(() => {
            mainController.onDidCloseTextDocument(document);
            try {
                connectionManager.verify(x => x.transferFileConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.never());
                connectionManager.verify(x => x.onDidCloseTextDocument(TypeMoq.It.isAny()), TypeMoq.Times.once());
                assert.equal(docUriCallback, document.uri.toString());
                done();
            } catch (err) {
                done(new Error(err));
            }
        // Timeout set to the max threshold + 1
        }, Constants.renamedOpenTimeThreshold + 1);
    });


    // Open document event test
    test('onDidOpenTextDocument should propogate the function to the connectionManager' , done => {

        // Call onDidOpenTextDocument to test it side effects
        mainController.onDidOpenTextDocument(document);
        try {
            connectionManager.verify(x => x.onDidOpenTextDocument(TypeMoq.It.isAny()), TypeMoq.Times.once());
            assert.equal(docUriCallback, document.uri.toString());
            done();
        } catch (err) {
            done(new Error(err));
        }
    });


    // Save document event test
    test('onDidSaveTextDocument should propogate the function to the connectionManager' , done => {

        // Call onDidOpenTextDocument to test it side effects
        mainController.onDidSaveTextDocument(newDocument);
        try {
            // Ensure no extraneous function is called
            connectionManager.verify(x => x.onDidOpenTextDocument(TypeMoq.It.isAny()), TypeMoq.Times.never());
            connectionManager.verify(x => x.transferFileConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.never());
            done();
        } catch (err) {
            done(new Error(err));
        }
    });

    test('TextDocument Events should handle non-initialized connection manager' , done => {
        let contextMock: TypeMoq.Mock<vscode.ExtensionContext> = TypeMoq.Mock.ofType(TestExtensionContext);
        let vscodeWrapperMock: TypeMoq.Mock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);
        let controller: MainController = new MainController(contextMock.object,
            undefined,  // ConnectionManager
            vscodeWrapperMock.object);

        // None of the TextDocument events should throw exceptions, they should cleanly exit instead.
        controller.onDidOpenTextDocument(document);
        controller.onDidSaveTextDocument(document);
        controller.onDidCloseTextDocument(document);
        done();
    });

    test('onNewQuery should call the new query and new connection' , () => {

        untitledSqlDocumentService.setup(x => x.newQuery()).returns(() => Promise.resolve(true));
        connectionManager.setup(x => x.onNewConnection()).returns(() => Promise.resolve(true));

        return mainController.onNewQuery().then(result => {
            untitledSqlDocumentService.verify(x => x.newQuery(), TypeMoq.Times.once());
            connectionManager.verify(x => x.onNewConnection(), TypeMoq.Times.once());
        });
    });

    test('onNewQuery should not call the new connection if new query fails' , done => {

        untitledSqlDocumentService.setup(x => x.newQuery()).returns(() => { return Promise.reject<boolean>('error'); } );
        connectionManager.setup(x => x.onNewConnection()).returns(() => { return Promise.resolve(true); } );

        mainController.onNewQuery().catch(error => {
            untitledSqlDocumentService.verify(x => x.newQuery(), TypeMoq.Times.once());
            connectionManager.verify(x => x.onNewConnection(), TypeMoq.Times.never());
            done();
        });
    });
});
