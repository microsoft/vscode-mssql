/*
*  Class for handler and distributing notification coming from the
*  service layer
*/
import QueryRunner from './queryRunner';
import SqlToolsServiceClient from '../languageservice/serviceclient';
import {QueryExecuteCompleteNotification} from '../models/contracts';
import {INotificationHandler} from 'vscode-languageclient';

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

    private initialize(): void {
        SqlToolsServiceClient.getInstance().getClient().onNotification(QueryExecuteCompleteNotification.type, this.handleNotification());
    }

    public registerRunner(runner: QueryRunner, uri: string): void {
        this._queryRunners.set(uri, runner);
    }

    private handleNotification(): INotificationHandler<any> {
        const self = this;
        return (event) => {
            self._queryRunners.get(event.ownerUri).handleResult(event);
            self._queryRunners.delete(event.ownerUri);
        };
    }
}
