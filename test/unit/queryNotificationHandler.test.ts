/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as assert from "assert";
import QueryRunner from "../../src/extension/controllers/queryRunner";
import { QueryNotificationHandler } from "../../src/extension/controllers/queryNotificationHandler";
import { NotificationHandler } from "vscode-languageclient";

// TESTS //////////////////////////////////////////////////////////////////////////////////////////
suite("QueryNotificationHandler tests", () => {
    let notificationHandler: QueryNotificationHandler;
    let eventData: any;
    let runnerMock: TypeMoq.IMock<QueryRunner>;

    let batchStartHandlerCalled: boolean;
    let messageHandlerCalled: boolean;
    let resultSetCompleteHandlerCalled: boolean;
    let batchCompleteHandlerCalled: boolean;
    let queryCompleteHandlerCalled: boolean;

    let batchStartHandler: NotificationHandler<any>;
    let messageHandler: NotificationHandler<any>;
    let resultSetCompleteHandler: NotificationHandler<any>;
    let batchCompleteHandler: NotificationHandler<any>;
    let queryCompleteHandler: NotificationHandler<any>;

    setup(() => {
        notificationHandler = new QueryNotificationHandler();
        eventData = { ownerUri: "testUri" };

        // Setup mock - Use the same QueryRunner for the whole test - this tests if it can be reused
        runnerMock = TypeMoq.Mock.ofType(QueryRunner, TypeMoq.MockBehavior.Loose);
        runnerMock.callBase = true;
        runnerMock
            .setup((x) => x.handleBatchStart(TypeMoq.It.isAny()))
            .callback((event) => {
                batchStartHandlerCalled = true;
            });
        runnerMock
            .setup((x) => x.handleMessage(TypeMoq.It.isAny()))
            .callback((event) => {
                messageHandlerCalled = true;
            });
        runnerMock
            .setup((x) => x.handleResultSetComplete(TypeMoq.It.isAny()))
            .callback((event) => {
                resultSetCompleteHandlerCalled = true;
            });
        runnerMock
            .setup((x) => x.handleBatchComplete(TypeMoq.It.isAny()))
            .callback((event) => {
                batchCompleteHandlerCalled = true;
            });
        runnerMock
            .setup((x) => x.handleQueryComplete(TypeMoq.It.isAny()))
            .callback((event) => {
                queryCompleteHandlerCalled = true;
                runnerMock.object.setHasCompleted();
            });

        // Get handlers
        batchStartHandler = notificationHandler.handleBatchStartNotification();
        messageHandler = notificationHandler.handleMessageNotification();
        resultSetCompleteHandler = notificationHandler.handleResultSetCompleteNotification();
        batchCompleteHandler = notificationHandler.handleBatchCompleteNotification();
        queryCompleteHandler = notificationHandler.handleQueryCompleteNotification();
    });

    // Setup booleans to track if handlers were called
    function resetBools(): void {
        batchStartHandlerCalled = false;
        messageHandlerCalled = false;
        resultSetCompleteHandlerCalled = false;
        batchCompleteHandlerCalled = false;
        queryCompleteHandlerCalled = false;
        runnerMock.object.resetHasCompleted();
    }

    test("QueryNotificationHandler handles registerRunner at the beginning of the event flow", (done) => {
        resetBools();

        // If registerRunner is called, the query runner map should be populated
        notificationHandler.registerRunner(runnerMock.object, eventData.ownerUri);
        assert.equal(notificationHandler._queryRunners.size, 1);

        // If the notifications are fired, the callbacks should be immediately fired too
        batchStartHandler(eventData);
        assert.equal(batchStartHandlerCalled, true);
        messageHandler(eventData);
        assert.equal(messageHandlerCalled, true);
        resultSetCompleteHandler(eventData);
        assert.equal(resultSetCompleteHandlerCalled, true);
        batchCompleteHandler(eventData);
        assert.equal(batchCompleteHandlerCalled, true);
        queryCompleteHandler(eventData);
        assert.equal(queryCompleteHandlerCalled, true);

        // And cleanup should happen after queryCompleteHandlerCalled
        assert.equal(
            notificationHandler._queryRunners.size,
            0,
            "Query runner map not cleared after call to handleQueryCompleteNotification()",
        );
        assert.equal(
            notificationHandler._handlerCallbackQueue.length,
            0,
            "Handler queue populated despite QueryRunner being present",
        );

        done();
    });

    test("QueryNotificationHandler handles registerRunner in the middle of the event flow", (done) => {
        resetBools();

        // If some notifications are fired before registerRunner
        batchStartHandler(eventData);
        messageHandler(eventData);

        // The queue should be populated with the run notifications, and the callbacks should not be fired
        assert.equal(notificationHandler._handlerCallbackQueue.length, 2);
        assert.equal(batchStartHandlerCalled, false);
        assert.equal(messageHandlerCalled, false);

        // If register runner is then called, the query runner map should be populated and the callbacks should occur
        notificationHandler.registerRunner(runnerMock.object, eventData.ownerUri);
        assert.equal(notificationHandler._queryRunners.size, 1);
        assert.equal(batchStartHandlerCalled, true);
        assert.equal(messageHandlerCalled, true);

        // If the rest of the notifications are fired, the callbacks should be immediately fired too
        resultSetCompleteHandler(eventData);
        assert.equal(resultSetCompleteHandlerCalled, true);
        batchCompleteHandler(eventData);
        assert.equal(batchCompleteHandlerCalled, true);
        queryCompleteHandler(eventData);
        assert.equal(queryCompleteHandlerCalled, true);

        // And cleanup should happen after queryCompleteHandlerCalled
        assert.equal(
            notificationHandler._queryRunners.size,
            0,
            "Query runner map not cleared after call to handleQueryCompleteNotification()",
        );
        assert.equal(
            notificationHandler._handlerCallbackQueue.length,
            0,
            "Handler queue populated despite QueryRunner being present",
        );

        done();
    });

    test("QueryNotificationHandler handles registerRunner at the end of the event flow", (done) => {
        resetBools();

        // If all notifications are fired before registerRunner
        batchStartHandler(eventData);
        messageHandler(eventData);
        resultSetCompleteHandler(eventData);
        batchCompleteHandler(eventData);
        queryCompleteHandler(eventData);

        // The queue should be populated with the run notifications, and the callbacks should not be fired
        assert.equal(notificationHandler._handlerCallbackQueue.length, 5);
        assert.equal(batchStartHandlerCalled, false);
        assert.equal(messageHandlerCalled, false);
        assert.equal(resultSetCompleteHandlerCalled, false);
        assert.equal(batchCompleteHandlerCalled, false);
        assert.equal(queryCompleteHandlerCalled, false);

        // If register runner is then called, the callbacks should occur and the map should not be populated
        notificationHandler.registerRunner(runnerMock.object, eventData.ownerUri);
        assert.equal(batchStartHandlerCalled, true);
        assert.equal(messageHandlerCalled, true);
        assert.equal(resultSetCompleteHandlerCalled, true);
        assert.equal(batchCompleteHandlerCalled, true);
        assert.equal(queryCompleteHandlerCalled, true);
        assert.equal(notificationHandler._queryRunners.size, 0);

        done();
    });
});
