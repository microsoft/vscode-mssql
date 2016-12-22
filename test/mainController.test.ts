'use strict';
import * as TypeMoq from 'typemoq';

import vscode = require('vscode');
import MainController from '../src/controllers/mainController';
import ConnectionManager from '../src/controllers/connectionManager';
import * as Extension from '../src/extension';
import Constants = require('../src/models/constants');
import assert = require('assert');

suite('MainController Tests', () => {
    let document: vscode.TextDocument;
    let newDocument: vscode.TextDocument;
    let mainController: MainController;
    let connectionManager: TypeMoq.Mock<ConnectionManager>;
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
        document.uri.scheme = Constants.untitledScheme;

        // A save untitled doc constitutes an saveDoc event directly followed by a closeDoc event
        mainController.onDidSaveTextDocument(newDocument);
        mainController.onDidCloseTextDocument(document);
        try {
            connectionManager.verify(x => x.transferFileConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
            assert.equal(docUriCallback, document.uri.toString());
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

});
