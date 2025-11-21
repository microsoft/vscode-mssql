/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import QueryRunner from "../../src/controllers/queryRunner";
import { QueryNotificationHandler } from "../../src/controllers/queryNotificationHandler";
import { NotificationHandler } from "vscode-languageclient";

chai.use(sinonChai);

suite("QueryNotificationHandler tests", () => {
  let sandbox: sinon.SinonSandbox;
  let notificationHandler: QueryNotificationHandler;
  let eventData: { ownerUri: string };
  let runnerMock: sinon.SinonStubbedInstance<QueryRunner>;
  let runner: QueryRunner;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let batchStartHandler: NotificationHandler<any>;
  let messageHandler: NotificationHandler<any>;
  let resultSetCompleteHandler: NotificationHandler<any>;
  let batchCompleteHandler: NotificationHandler<any>;
  let queryCompleteHandler: NotificationHandler<any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  setup(() => {
    sandbox = sinon.createSandbox();
    notificationHandler = new QueryNotificationHandler();
    eventData = { ownerUri: "testUri" };

    runnerMock = sandbox.createStubInstance(QueryRunner);
    runnerMock.handleQueryComplete.callsFake(() => {
      runnerMock.setHasCompleted();
    });

    runner = runnerMock;

    batchStartHandler = notificationHandler.handleBatchStartNotification();
    messageHandler = notificationHandler.handleMessageNotification();
    resultSetCompleteHandler =
      notificationHandler.handleResultSetCompleteNotification();
    batchCompleteHandler =
      notificationHandler.handleBatchCompleteNotification();
    queryCompleteHandler =
      notificationHandler.handleQueryCompleteNotification();
  });

  teardown(() => {
    sandbox.restore();
  });

  test("QueryNotificationHandler handles registerRunner at the beginning of the event flow", () => {
    notificationHandler.registerRunner(runner, eventData.ownerUri);
    expect(notificationHandler._queryRunners.size).to.equal(1);

    batchStartHandler(eventData);
    expect(runnerMock.handleBatchStart).to.have.been.calledOnceWithExactly(
      eventData,
    );

    messageHandler(eventData);
    expect(runnerMock.handleMessage).to.have.been.calledOnceWithExactly(
      eventData,
    );

    resultSetCompleteHandler(eventData);
    expect(
      runnerMock.handleResultSetComplete,
    ).to.have.been.calledOnceWithExactly(eventData);

    batchCompleteHandler(eventData);
    expect(runnerMock.handleBatchComplete).to.have.been.calledOnceWithExactly(
      eventData,
    );

    queryCompleteHandler(eventData);
    expect(runnerMock.handleQueryComplete).to.have.been.calledOnceWithExactly(
      eventData,
    );
    expect(runnerMock.setHasCompleted).to.have.been.calledOnce;

    expect(notificationHandler._queryRunners.size).to.equal(0);
  });

  test("QueryNotificationHandler ignores notifications when no runner is registered", () => {
    // If notifications are fired before registerRunner, they should be ignored (not queued)
    batchStartHandler(eventData);
    messageHandler(eventData);

    expect(runnerMock.handleBatchStart).to.not.have.been.called;
    expect(runnerMock.handleMessage).to.not.have.been.called;

    // If register runner is then called, the query runner map should be populated
    notificationHandler.registerRunner(runner, eventData.ownerUri);
    expect(notificationHandler._queryRunners.size).to.equal(1);
    // Previous notifications were ignored, so handlers still not called
    expect(runnerMock.handleBatchStart).to.not.have.been.called;
    expect(runnerMock.handleMessage).to.not.have.been.called;

    // If new notifications are fired, the callbacks should be immediately fired
    resultSetCompleteHandler(eventData);
    expect(
      runnerMock.handleResultSetComplete,
    ).to.have.been.calledOnceWithExactly(eventData);

    batchCompleteHandler(eventData);
    expect(runnerMock.handleBatchComplete).to.have.been.calledOnceWithExactly(
      eventData,
    );

    queryCompleteHandler(eventData);
    expect(runnerMock.handleQueryComplete).to.have.been.calledOnceWithExactly(
      eventData,
    );
    expect(runnerMock.setHasCompleted).to.have.been.calledOnce;

    expect(notificationHandler._queryRunners.size).to.equal(0);
  });

  test("QueryNotificationHandler properly unregisters runner after query completion", () => {
    notificationHandler.registerRunner(runner, eventData.ownerUri);
    expect(notificationHandler._queryRunners.size).to.equal(1);

    batchStartHandler(eventData);
    expect(runnerMock.handleBatchStart).to.have.been.calledOnceWithExactly(
      eventData,
    );

    messageHandler(eventData);
    expect(runnerMock.handleMessage).to.have.been.calledOnceWithExactly(
      eventData,
    );

    resultSetCompleteHandler(eventData);
    expect(
      runnerMock.handleResultSetComplete,
    ).to.have.been.calledOnceWithExactly(eventData);

    batchCompleteHandler(eventData);
    expect(runnerMock.handleBatchComplete).to.have.been.calledOnceWithExactly(
      eventData,
    );

    queryCompleteHandler(eventData);
    expect(runnerMock.handleQueryComplete).to.have.been.calledOnceWithExactly(
      eventData,
    );
    expect(runnerMock.setHasCompleted).to.have.been.calledOnce;

    expect(notificationHandler._queryRunners.size).to.equal(0);
  });

  test("QueryNotificationHandler handles manual unregister", () => {
    notificationHandler.registerRunner(runner, eventData.ownerUri);
    expect(notificationHandler._queryRunners.size).to.equal(1);

    notificationHandler.unregisterRunner(eventData.ownerUri);
    expect(notificationHandler._queryRunners.size).to.equal(0);

    batchStartHandler(eventData);
    expect(runnerMock.handleBatchStart).to.not.have.been.called;

    messageHandler(eventData);
    expect(runnerMock.handleMessage).to.not.have.been.called;
  });
});
