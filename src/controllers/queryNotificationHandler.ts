/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  Class for handler and distributing notification coming from the
 *  service layer
 */
import QueryRunner from "./queryRunner";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    QueryExecuteCompleteNotification,
    QueryExecuteBatchStartNotification,
    QueryExecuteBatchCompleteNotification,
    QueryExecuteResultSetCompleteNotification,
    QueryExecuteMessageNotification,
} from "../models/contracts/queryExecute";
import { NotificationHandler } from "vscode-languageclient";

export class QueryNotificationHandler {
    private static _instance: QueryNotificationHandler;

    // public for testing only
    public _queryRunners = new Map<string, QueryRunner>();

    // public for testing only
    public _handlerCallbackQueue: ((run: QueryRunner) => void)[] = [];

    static get instance(): QueryNotificationHandler {
        if (QueryNotificationHandler._instance) {
            return QueryNotificationHandler._instance;
        } else {
            QueryNotificationHandler._instance = new QueryNotificationHandler();
            QueryNotificationHandler._instance.initialize();
            return QueryNotificationHandler._instance;
        }
    }

    // register the handler to handle notifications for queries
    private initialize(): void {
        SqlToolsServiceClient.instance.onNotification(
            QueryExecuteCompleteNotification.type,
            this.handleQueryCompleteNotification(),
        );
        SqlToolsServiceClient.instance.onNotification(
            QueryExecuteBatchStartNotification.type,
            this.handleBatchStartNotification(),
        );
        SqlToolsServiceClient.instance.onNotification(
            QueryExecuteBatchCompleteNotification.type,
            this.handleBatchCompleteNotification(),
        );
        SqlToolsServiceClient.instance.onNotification(
            QueryExecuteResultSetCompleteNotification.type,
            this.handleResultSetCompleteNotification(),
        );
        SqlToolsServiceClient.instance.onNotification(
            QueryExecuteMessageNotification.type,
            this.handleMessageNotification(),
        );
    }

    // Registers queryRunners with their uris to distribute notifications.
    // Ensures that notifications are handled in the correct order by handling
    // enqueued handlers first.
    // public for testing only
    public registerRunner(runner: QueryRunner, uri: string): void {
        // If enqueueOrRun was called before registerRunner for the current query,
        // _handlerCallbackQueue will be non-empty. Run all handlers in the queue first
        // so that notifications are handled in order they arrived
        while (this._handlerCallbackQueue.length > 0) {
            let handler: NotificationHandler<any> = this._handlerCallbackQueue.shift();
            handler(runner);
        }

        // Set the runner for any other handlers if the runner is in use by the
        // current query or a subsequent query
        if (!runner.hasCompleted) {
            this._queryRunners.set(uri, runner);
        }
    }

    // Handles logic to run the given handlerCallback at the appropriate time. If the given runner is
    // undefined, the handlerCallback is put on the _handlerCallbackQueue to be run once the runner is set
    // public for testing only
    private enqueueOrRun(
        handlerCallback: (runnerParam: QueryRunner) => void,
        runner: QueryRunner,
    ): void {
        if (runner === undefined) {
            this._handlerCallbackQueue.push(handlerCallback);
        } else {
            handlerCallback(runner);
        }
    }

    // Distributes result completion notification to appropriate methods
    // public for testing only
    public handleQueryCompleteNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            let handlerCallback = (runner: QueryRunner) => {
                runner.handleQueryComplete(event);

                // There should be no more notifications for this query, so unbind the QueryRunner if it
                // is present in the map. If it is not present, handleQueryCompleteNotification must have been
                // called before registerRunner
                if (self._queryRunners.get(event.ownerUri) !== undefined) {
                    self._queryRunners.delete(event.ownerUri);
                }
            };

            self.enqueueOrRun(handlerCallback, self._queryRunners.get(event.ownerUri));
        };
    }

    // Distributes batch start notification to appropriate methods
    // public for testing only
    public handleBatchStartNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            let handlerCallback = (runner: QueryRunner) => {
                runner.handleBatchStart(event);
            };
            self.enqueueOrRun(handlerCallback, self._queryRunners.get(event.ownerUri));
        };
    }

    // Distributes batch completion notification to appropriate methods
    // public for testing only
    public handleBatchCompleteNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            let handlerCallback = (runner: QueryRunner) => {
                runner.handleBatchComplete(event);
            };
            self.enqueueOrRun(handlerCallback, self._queryRunners.get(event.ownerUri));
        };
    }

    // Distributes result set completion notification to appropriate methods
    // public for testing only
    public handleResultSetCompleteNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            let handlerCallback = (runner: QueryRunner) => {
                runner.handleResultSetComplete(event);
            };
            self.enqueueOrRun(handlerCallback, self._queryRunners.get(event.ownerUri));
        };
    }

    // Distributes message notifications
    // public for testing only
    public handleMessageNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            let handlerCallback = (runner: QueryRunner) => {
                runner.handleMessage(event);
            };
            self.enqueueOrRun(handlerCallback, self._queryRunners.get(event.ownerUri));
        };
    }
}
