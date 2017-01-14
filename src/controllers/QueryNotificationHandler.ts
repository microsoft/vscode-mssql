/*
*  Class for handler and distributing notification coming from the
*  service layer
*/
import QueryRunner from './QueryRunner';
import SqlToolsServiceClient from '../languageservice/serviceclient';
import {
    QueryExecuteCompleteNotification,
    QueryExecuteBatchStartNotification,
    QueryExecuteBatchCompleteNotification,
    QueryExecuteResultSetCompleteNotification,
    QueryExecuteMessageNotification
} from '../models/contracts/queryExecute';
import { NotificationHandler } from 'vscode-languageclient';

export class QueryNotificationHandler {
    private static _instance: QueryNotificationHandler;
    private _queryRunners = new Map<string, QueryRunner>();
    private _handlerCallbackQueue: ((run: QueryRunner) => void)[];

    static get instance(): QueryNotificationHandler {
        if (QueryNotificationHandler._instance) {
            return this._instance;
        } else {
            this._instance = new QueryNotificationHandler();
            this._instance.initialize();
            return this._instance;
        }
    }

    // register the handler to handle notifications for queries
    private initialize(): void {
        SqlToolsServiceClient.instance.onNotification(QueryExecuteCompleteNotification.type, this.handleQueryCompleteNotification());
        SqlToolsServiceClient.instance.onNotification(QueryExecuteBatchStartNotification.type, this.handleBatchStartNotification());
        SqlToolsServiceClient.instance.onNotification(QueryExecuteBatchCompleteNotification.type, this.handleBatchCompleteNotification());
        SqlToolsServiceClient.instance.onNotification(QueryExecuteResultSetCompleteNotification.type, this.handleResultSetCompleteNotification());
        SqlToolsServiceClient.instance.onNotification(QueryExecuteMessageNotification.type, this.handleMessageNotification());
        this._handlerCallbackQueue = [];
    }

    // Registers queryRunners with their uris to distribute notifications.
    // Ensures that notifications are handled in the correct order by handling
    // enqueued handlers first.
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
    private enqueueOrRun(handlerCallback: (runnerParam: QueryRunner) => void, runner: QueryRunner): void {
        if (runner === undefined) {
            this._handlerCallbackQueue.push(handlerCallback);
        } else {
            handlerCallback(runner);
        }
    }

    // Distributes result completion notification to appropriate methods
    private handleQueryCompleteNotification(): NotificationHandler<any> {
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
    private handleBatchStartNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            let handlerCallback = (runner: QueryRunner) => {
                runner.handleBatchStart(event);
            };
            self.enqueueOrRun(handlerCallback, self._queryRunners.get(event.ownerUri));
        };
    }

    // Distributes batch completion notification to appropriate methods
    private handleBatchCompleteNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            let handlerCallback = (runner: QueryRunner) => {
                runner.handleBatchComplete(event);
            };
            self.enqueueOrRun(handlerCallback, self._queryRunners.get(event.ownerUri));
        };
    }

    // Distributes result set completion notification to appropriate methods
    private handleResultSetCompleteNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            let handlerCallback = (runner: QueryRunner) => {
                runner.handleResultSetComplete(event);
            };
            self.enqueueOrRun(handlerCallback, self._queryRunners.get(event.ownerUri));
        };
    }

    private handleMessageNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            let handlerCallback = (runner: QueryRunner) => {
                runner.handleMessage(event);
            };
            self.enqueueOrRun(handlerCallback, self._queryRunners.get(event.ownerUri));
        };
    }
}
