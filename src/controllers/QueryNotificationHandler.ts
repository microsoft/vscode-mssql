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
    QueryExecuteResultSetCompleteNotification
} from '../models/contracts/queryExecute';
import { NotificationHandler } from 'vscode-languageclient';

export class QueryNotificationHandler {
    private static _instance: QueryNotificationHandler;
    private _queryRunners = new Map<string, QueryRunner>();

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
        SqlToolsServiceClient.instance.onNotification(QueryExecuteCompleteNotification.type, this.handleCompleteNotification());
        SqlToolsServiceClient.instance.onNotification(QueryExecuteBatchStartNotification.type, this.handleBatchStartNotification());
        SqlToolsServiceClient.instance.onNotification(QueryExecuteBatchCompleteNotification.type, this.handleBatchCompleteNotification());
        SqlToolsServiceClient.instance.onNotification(QueryExecuteResultSetCompleteNotification.type, this.handleResultSetCompleteNotification());
    }

    // registers queryRunners with their uris to distribute notifications
    public registerRunner(runner: QueryRunner, uri: string): void {
        this._queryRunners.set(uri, runner);
    }

    // Distributes result completion notification to appropriate methods
    private handleCompleteNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            self._queryRunners.get(event.ownerUri).handleResult(event);

            // There should be no more notifications for this query, so unbind it
            self._queryRunners.delete(event.ownerUri);
        };
    }

    // Distributes batch start notification to appropriate methods
    private handleBatchStartNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            self._queryRunners.get(event.ownerUri).handleBatchStart(event);
        };
    }

    // Distributes batch completion notification to appropriate methods
    private handleBatchCompleteNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            self._queryRunners.get(event.ownerUri).handleBatchComplete(event);
        };
    }

    // Distributes result set completion notification to appropriate methods
    private handleResultSetCompleteNotification(): NotificationHandler<any> {
        const self = this;
        return (event) => {
            self._queryRunners.get(event.ownerUri).handleResultSetComplete(event);
        };
    }
}
