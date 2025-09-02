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
    QueryExecuteResultSetAvailableNotification,
    QueryExecuteResultSetUpdatedNotification,
    QueryExecuteResultSetCompleteNotification,
    QueryExecuteMessageNotification,
    QueryExecuteCompleteNotificationResult,
    QueryExecuteBatchNotificationParams,
    QueryExecuteResultSetAvailableNotificationParams,
    QueryExecuteResultSetUpdatedNotificationParams,
    QueryExecuteResultSetCompleteNotificationParams,
    QueryExecuteMessageParams,
} from "../models/contracts/queryExecute";
import { NotificationHandler } from "vscode-languageclient";

export class QueryNotificationHandler {
    private static _instance: QueryNotificationHandler;
    static get instance() {
        return (this._instance ??= new QueryNotificationHandler());
    }

    // public for testing only
    public _queryRunners = new Map<string, QueryRunner>();
    constructor() {
        this.initialize();
    }

    // Registers queryRunners with their uris to distribute notifications.
    // public for testing only
    public registerRunner(runner: QueryRunner, uri: string): void {
        this._queryRunners.set(uri, runner);
    }

    public unregisterRunner(uri: string): void {
        this._queryRunners.delete(uri);
    }

    // register the handler to handle notifications for queries
    private initialize(): void {
        const client = SqlToolsServiceClient.instance;
        client.onNotification(
            QueryExecuteCompleteNotification.type,
            this.handleQueryCompleteNotification(),
        );
        client.onNotification(
            QueryExecuteBatchStartNotification.type,
            this.handleBatchStartNotification(),
        );
        client.onNotification(
            QueryExecuteBatchCompleteNotification.type,
            this.handleBatchCompleteNotification(),
        );
        client.onNotification(
            QueryExecuteResultSetAvailableNotification.type,
            this.handleResultSetAvailableNotification(),
        );
        client.onNotification(
            QueryExecuteResultSetUpdatedNotification.type,
            this.handleResultSetUpdatedNotification(),
        );
        client.onNotification(
            QueryExecuteResultSetCompleteNotification.type,
            this.handleResultSetCompleteNotification(),
        );
        client.onNotification(
            QueryExecuteMessageNotification.type,
            this.handleMessageNotification(),
        );
    }

    private makeHandler<T extends { ownerUri: string }>(
        invoke: (r: QueryRunner, e: T) => void,
        onComplete = false,
    ): NotificationHandler<T> {
        return (e: T) => {
            const r = this._queryRunners.get(e.ownerUri);
            if (!r) return; // runner not registered (rare)
            invoke(r, e);
            if (onComplete) this._queryRunners.delete(e.ownerUri);
        };
    }

    // Now give each handler its precise event type:
    public handleQueryCompleteNotification(): NotificationHandler<QueryExecuteCompleteNotificationResult> {
        return this.makeHandler<QueryExecuteCompleteNotificationResult>(
            (r, e) => r.handleQueryComplete(e),
            true,
        );
    }

    public handleBatchStartNotification(): NotificationHandler<QueryExecuteBatchNotificationParams> {
        return this.makeHandler<QueryExecuteBatchNotificationParams>((r, e) =>
            r.handleBatchStart(e),
        );
    }

    public handleBatchCompleteNotification(): NotificationHandler<QueryExecuteBatchNotificationParams> {
        return this.makeHandler<QueryExecuteBatchNotificationParams>((r, e) =>
            r.handleBatchComplete(e),
        );
    }

    public handleResultSetAvailableNotification(): NotificationHandler<QueryExecuteResultSetAvailableNotificationParams> {
        return this.makeHandler<QueryExecuteResultSetAvailableNotificationParams>((r, e) =>
            r.handleResultSetAvailable(e),
        );
    }

    public handleResultSetUpdatedNotification(): NotificationHandler<QueryExecuteResultSetUpdatedNotificationParams> {
        return this.makeHandler<QueryExecuteResultSetUpdatedNotificationParams>((r, e) =>
            r.handleResultSetUpdated(e),
        );
    }

    public handleResultSetCompleteNotification(): NotificationHandler<QueryExecuteResultSetCompleteNotificationParams> {
        return this.makeHandler<QueryExecuteResultSetCompleteNotificationParams>((r, e) =>
            r.handleResultSetComplete(e),
        );
    }

    public handleMessageNotification(): NotificationHandler<QueryExecuteMessageParams> {
        return this.makeHandler<QueryExecuteMessageParams>((r, e) => r.handleMessage(e));
    }
}
