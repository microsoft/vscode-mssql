'use strict';
import vscode = require('vscode');
import Constants = require('./constants');

// interfaces
export enum ContentType {
    Root = 0,
    Messages = 1,
    ResultsetsMeta = 2,
    Columns = 3,
    Rows = 4
};

export const ContentTypes = [Constants.gOutputContentTypeRoot, Constants.gOutputContentTypeMessages, Constants.gOutputContentTypeResultsetMeta,
Constants.gOutputContentTypeColumns, Constants.gOutputContentTypeRows];

// mssql.config wrapped into an interface for us to use more easily
// Provided by the user when creating a new database connection
// See this for more info: http://pekim.github.io/tedious/api-connection.html
export interface IConnectionCredentials {
    server: string;
    database: string;
    user: string;
    password: string;
    connectionTimeout: number;
    requestTimeout: number;
    options: { encrypt: boolean, appName: string };
};

export interface IConnectionCredentialsQuickPickItem extends vscode.QuickPickItem {
    connectionCreds: IConnectionCredentials;
};

// Obtained from an active connection to show in the status bar
export interface IConnectionProperties {
    serverVersion: string;
    currentUser: string;
    currentDatabase: string;
};

export interface IBackgridColumnMetadata {
    name: string;
    label: string;
    cell: string;
}

export interface ISqlResultsetMeta {
    columnsUri: string;
    rowsUri: string;
};

export interface ISqlMessage {
    messageText: string;
};

export interface ISqlResultset {
    columns: any[];
    rows: any[];
    executionPlanXml: string;
};
