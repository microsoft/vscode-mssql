import assert = require('assert');

import StatusView from '../src/views/statusView';
import Constants = require('../src/models/constants');
import Telemetry from '../src/models/telemetry';

suite('Status View Tests', () => {
    setup(() => {
        // Ensure that telemetry is disabled while testing
        Telemetry.disable();
    });

    test('updateStatusMessage should not immediately update status message for definition request', (done) => {
        return new Promise((resolve, reject) => {
            let statusView = new StatusView();
            let newStatus = Constants.definitionRequestedStatus;
            let currentStatus = '';
            let getCurrentStatus = () => {
                return currentStatus;
            };
            let actualStatusMessage = '';
            let expectedStatusMessage = Constants.gettingDefinitionMessage;
            let updateMessage = (message) => {
                actualStatusMessage = message;
            };
            statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
            assert.equal(actualStatusMessage, '');
            setTimeout(() => {
                assert.equal(actualStatusMessage, expectedStatusMessage);
            }, 600);
            done();
         });
    });

    test('updateStatusMessage should not update status message for definition request if already completed', (done) => {
        return new Promise((resolve, reject) => {
            let statusView = new StatusView();
            let newStatus = Constants.definitionRequestedStatus;
            let currentStatus = Constants.definitionRequestCompletedStatus;
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
            done();
         });
    });

    test('updateStatusMessage should update status message for definition request completed', (done) => {
        return new Promise((resolve, reject) => {
            let statusView = new StatusView();
            let newStatus = Constants.definitionRequestCompletedStatus;
            let currentStatus = Constants.definitionRequestCompletedStatus;
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
            done();
         });
    });

    test('updateStatusMessage should update status message for updating intelliSense', (done) => {
        return new Promise((resolve, reject) => {
            let statusView = new StatusView();
            let newStatus = Constants.updatingIntelliSenseStatus;
            let currentStatus = '';
            let getCurrentStatus = () => {
                return currentStatus;
            };
            let actualStatusMessage = '';
            let expectedStatusMessage = Constants.updatingIntelliSenseLabel;
            let updateMessage = (message) => {
                actualStatusMessage = message;
            };
            statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
            assert.equal(actualStatusMessage, expectedStatusMessage);
            done();
         });
    });

    test('updateStatusMessage should update status message for intelliSense updated status', (done) => {
        return new Promise((resolve, reject) => {
            let statusView = new StatusView();
            let newStatus = Constants.intelliSenseUpdatedStatus;
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
            done();
         });
    });
});
