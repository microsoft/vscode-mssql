/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';

import StatusView from '../src/views/statusView';
import * as LocalizedConstants from '../src/constants/localizedConstants';

suite('Status View Tests', () => {

	test('updateStatusMessage should not immediately update status message for definition request', (done) => {
		return new Promise((resolve, reject) => {
			let statusView = new StatusView();
			let newStatus = LocalizedConstants.definitionRequestedStatus;
			let currentStatus = '';
			let getCurrentStatus = () => {
				return currentStatus;
			};
			let actualStatusMessage = '';
			let expectedStatusMessage = LocalizedConstants.gettingDefinitionMessage;
			let updateMessage = (message) => {
				actualStatusMessage = message;
			};
			statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
			assert.equal(actualStatusMessage, '');
			setTimeout(() => {
				assert.equal(actualStatusMessage, expectedStatusMessage);
			}, 600);
			statusView.dispose();
			done();
		});
	});

	test('updateStatusMessage should not update status message for definition request if already completed', (done) => {
		return new Promise((resolve, reject) => {
			let statusView = new StatusView();
			let newStatus = LocalizedConstants.definitionRequestedStatus;
			let currentStatus = LocalizedConstants.definitionRequestCompletedStatus;
			let getCurrentStatus = () => {
				return currentStatus;
			};
			let actualStatusMessage = '';
			let expectedStatusMessage = '';
			let updateMessage = (message) => {
				actualStatusMessage = message;
			};
			statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
			assert.equal(actualStatusMessage, '');
			setTimeout(() => {
				assert.equal(actualStatusMessage, expectedStatusMessage);
			}, 600);
			statusView.dispose();
			done();
		});
	});

	test('updateStatusMessage should update status message for definition request completed', (done) => {
		return new Promise((resolve, reject) => {
			let statusView = new StatusView();
			let newStatus = LocalizedConstants.definitionRequestCompletedStatus;
			let currentStatus = LocalizedConstants.definitionRequestCompletedStatus;
			let getCurrentStatus = () => {
				return currentStatus;
			};
			let actualStatusMessage = '';
			let expectedStatusMessage = '';
			let updateMessage = (message) => {
				actualStatusMessage = message;
			};
			statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
			assert.equal(actualStatusMessage, expectedStatusMessage);
			statusView.dispose();
			done();
		});
	});

	test('updateStatusMessage should update status message for updating intelliSense', (done) => {
		return new Promise((resolve, reject) => {
			let statusView = new StatusView();
			let newStatus = LocalizedConstants.updatingIntelliSenseStatus;
			let currentStatus = '';
			let getCurrentStatus = () => {
				return currentStatus;
			};
			let actualStatusMessage = '';
			let expectedStatusMessage = LocalizedConstants.updatingIntelliSenseLabel;
			let updateMessage = (message) => {
				actualStatusMessage = message;
			};
			statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
			assert.equal(actualStatusMessage, expectedStatusMessage);
			statusView.dispose();
			done();
		});
	});

	test('updateStatusMessage should update status message for intelliSense updated status', (done) => {
		return new Promise((resolve, reject) => {
			let statusView = new StatusView();
			let newStatus = LocalizedConstants.intelliSenseUpdatedStatus;
			let currentStatus = '';
			let getCurrentStatus = () => {
				return currentStatus;
			};
			let actualStatusMessage = '';
			let expectedStatusMessage = '';
			let updateMessage = (message) => {
				actualStatusMessage = message;
			};
			statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
			assert.equal(actualStatusMessage, expectedStatusMessage);
			statusView.dispose();
			done();
		});
	});
});
