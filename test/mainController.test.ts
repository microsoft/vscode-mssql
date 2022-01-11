/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as TypeMoq from 'typemoq';
import * as vscode from 'vscode';
import MainController from '../src/controllers/mainController';
import ConnectionManager from '../src/controllers/connectionManager';
import UntitledSqlDocumentService from '../src/controllers/untitledSqlDocumentService';
import * as Extension from '../src/extension';
import * as Constants from '../src/constants/constants';
import * as LocalizedConstants from '../src/constants/localizedConstants';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import { TestExtensionContext } from './stubs';
import * as assert from 'assert';

suite('MainController Tests', () => {
	let document: vscode.TextDocument;
	let newDocument: vscode.TextDocument;
	let mainController: MainController;
	let connectionManager: TypeMoq.IMock<ConnectionManager>;
	let untitledSqlDocumentService: TypeMoq.IMock<UntitledSqlDocumentService>;
	let docUri: string;
	let newDocUri: string;
	let docUriCallback: string;
	let newDocUriCallback: string;

	setup(async () => {
		// Setup a standard document and a new document
		docUri = 'docURI.sql';
		newDocUri = 'newDocURI.sql';

		document = <vscode.TextDocument>{
			uri: {
				toString(skipEncoding?: boolean): string {
					return docUri;
				}
			},
			languageId: 'sql'
		};

		newDocument = <vscode.TextDocument>{
			uri: {
				toString(skipEncoding?: boolean): string {
					return newDocUri;
				}
			},
			languageId: 'sql'
		};

		// Resetting call back variables
		docUriCallback = '';
		newDocUriCallback = '';


		// Using the mainController that was instantiated with the extension
		mainController = await Extension.getController();

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
	test('onDidCloseTextDocument should propogate onDidCloseTextDocument to connectionManager', () => {
		mainController.onDidCloseTextDocument(document);
		try {
			connectionManager.verify(x => x.onDidCloseTextDocument(TypeMoq.It.isAny()), TypeMoq.Times.once());
			assert.equal(docUriCallback, document.uri.toString());
			docUriCallback = '';
		} catch (err) {
			throw (err);
		}
	});

	// Saved Untitled file event test
	test('onDidCloseTextDocument should call untitledDoc function when an untitled file is saved', done => {
		// Scheme of older doc must be untitled
		let document2 = <vscode.TextDocument>{
			uri: vscode.Uri.parse(`${LocalizedConstants.untitledScheme}:${docUri}`),
			languageId: 'sql'
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

	// Renamed file event test
	test('onDidCloseTextDocument should call renamedDoc function when rename occurs', done => {
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


	// Closed document event called to test rename and untitled save file event timeouts
	test('onDidCloseTextDocument should propogate to the connectionManager even if a special event occured before it', done => {
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
	test('onDidOpenTextDocument should propogate the function to the connectionManager', done => {

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
	test('onDidSaveTextDocument should propogate the function to the connectionManager', done => {

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

	test('TextDocument Events should handle non-initialized connection manager', done => {
		let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);
		let controller: MainController = new MainController(TestExtensionContext.object,
			undefined,  // ConnectionManager
			vscodeWrapperMock.object);

		// None of the TextDocument events should throw exceptions, they should cleanly exit instead.
		controller.onDidOpenTextDocument(document);
		controller.onDidSaveTextDocument(document);
		controller.onDidCloseTextDocument(document);
		done();
	});

	test('onNewQuery should call the new query and new connection', async () => {
		let editor: vscode.TextEditor = {
			document: {
				uri: 'test_uri'
			},
			viewColumn: vscode.ViewColumn.One,
			selection: undefined
		} as any;
		untitledSqlDocumentService.setup(x => x.newQuery(undefined)).returns(() => { return Promise.resolve(editor); });
		connectionManager.setup(x => x.onNewConnection()).returns(() => { return Promise.resolve(undefined); });

		await mainController.onNewQuery(undefined, undefined);
		untitledSqlDocumentService.verify(x => x.newQuery(undefined), TypeMoq.Times.once());
		connectionManager.verify(x => x.onNewConnection(), TypeMoq.Times.atLeastOnce());
	});

	test('onNewQuery should not call the new connection if new query fails', done => {

		untitledSqlDocumentService.setup(x => x.newQuery()).returns(() => { return Promise.reject<vscode.TextEditor>('error'); });
		connectionManager.setup(x => x.onNewConnection()).returns(() => { return Promise.resolve(TypeMoq.It.isAny()); });

		mainController.onNewQuery(undefined, undefined).catch(error => {
			untitledSqlDocumentService.verify(x => x.newQuery(undefined), TypeMoq.Times.once());
			connectionManager.verify(x => x.onNewConnection(), TypeMoq.Times.never());
			done();
		});
	});

	test('validateTextDocumentHasFocus returns false if there is no active text document', () => {
		let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);
		vscodeWrapperMock.setup(x => x.activeTextEditorUri).returns(() => undefined);
		let controller: MainController = new MainController(TestExtensionContext.object,
			undefined,  // ConnectionManager
			vscodeWrapperMock.object);

		let result = (controller as any).validateTextDocumentHasFocus();
		assert.equal(result, false, 'Expected validateTextDocumentHasFocus to return false when the active document URI is undefined');
		vscodeWrapperMock.verify(x => x.activeTextEditorUri, TypeMoq.Times.once());
	});

	test('validateTextDocumentHasFocus returns true if there is an active text document', () => {
		let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);
		vscodeWrapperMock.setup(x => x.activeTextEditorUri).returns(() => 'test_uri');
		let controller: MainController = new MainController(TestExtensionContext.object,
			undefined,  // ConnectionManager
			vscodeWrapperMock.object);

		let result = (controller as any).validateTextDocumentHasFocus();
		assert.equal(result, true, 'Expected validateTextDocumentHasFocus to return true when the active document URI is not undefined');
	});

	test('onManageProfiles should call the connetion manager to manage profiles', async () => {
		let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);
		connectionManager.setup(c => c.onManageProfiles());
		let controller: MainController = new MainController(TestExtensionContext.object,
			connectionManager.object,
			vscodeWrapperMock.object);
		await controller.onManageProfiles();
		connectionManager.verify(c => c.onManageProfiles(), TypeMoq.Times.once());
	});
});
