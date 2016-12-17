'use strict';
import * as TypeMoq from 'typemoq';

import vscode = require('vscode');
import MainController from '../src/controllers/mainController';
import ConnectionManager from '../src/controllers/connectionManager';
import * as Extension from '../src/extension';
import Constants = require('../src/models/constants');

// import assert = require('assert');

suite('MainController Tests', () => {
    let document: vscode.TextDocument;
    let mainController: MainController;
    let connectionManager: TypeMoq.Mock<ConnectionManager>;

    setup(() => {
        // Setup a standard document
        document = <vscode.TextDocument> {
            uri : {
                toString(skipEncoding?: boolean): string {
                    return 'testingURI.sql';
                }
            }
        };

        connectionManager = TypeMoq.Mock.ofType(ConnectionManager);

        mainController = Extension.getController();
        mainController.connectionManager = connectionManager.object;
        connectionManager.setup(x => x.onDidCloseTextDocument(TypeMoq.It.isAny()));
        connectionManager.setup(x => x.transferFileConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny()));
    });

    test('onDidCloseTextDocument should propogate onDidCloseTextDocument to connectionManager' , done => {
        mainController.onDidCloseTextDocument(document);
        try {
            connectionManager.verify(x => x.onDidCloseTextDocument(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        } catch (err) {
            done(new Error(err));
        }
    });

    test('onDidCloseTextDocument should call renamedDoc function when rename occurs' , done => {
        // A renamed doc constitutes an openDoc event directly followed by a closeDoc event
        mainController.onDidOpenTextDocument(document);
        mainController.onDidCloseTextDocument(document);

        // Verify renameDoc function was called
        try {
            connectionManager.verify(x => x.transferFileConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        } catch (err) {
            done(new Error(err));
        }
    });

    test('onDidCloseTextDocument should untitledDoc function when an untitled file is saved' , done => {
        // Scheme of older doc must be untitled
        document.uri.scheme = Constants.untitledScheme;

        // A save untitled doc constitutes an saveDoc event directly followed by a closeDoc event
        mainController.onDidSaveTextDocument(document);
        mainController.onDidCloseTextDocument(document);
        try {
            connectionManager.verify(x => x.transferFileConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        } catch (err) {
            done(new Error(err));
        }
    });

});
