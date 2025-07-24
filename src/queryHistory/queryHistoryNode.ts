/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as LocalizedConstants from "../constants/locConstants";
import { extensionUri } from "../extension";

/**
 * Empty Node shown when no queries are available
 */
export class EmptyHistoryNode extends vscode.TreeItem {
    private static readonly contextValue = "emptyHistoryNode";

    constructor() {
        super(LocalizedConstants.msgNoQueriesAvailable, vscode.TreeItemCollapsibleState.None);
        this.contextValue = EmptyHistoryNode.contextValue;
    }
}

/**
 * Query history node
 */
export class QueryHistoryNode extends vscode.TreeItem {
    private static readonly contextValue = "queryHistoryNode";
    private successIcon: string;
    private failureIcon: string;
    private _ownerUri: string;
    private _timeStamp: Date;
    private _isSuccess: boolean;
    private _queryString: string;
    private _connectionLabel: string;

    constructor(
        label: string,
        tooltip: string,
        queryString: string,
        ownerUri: string,
        timeStamp: Date,
        connectionLabel: string,
        isSuccess: boolean,
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this._queryString = queryString;
        this._ownerUri = ownerUri;
        this._timeStamp = timeStamp;
        this._isSuccess = isSuccess;
        this._connectionLabel = connectionLabel;
        this.iconPath = this._isSuccess ? this.successIcon : this.failureIcon;
        const queryStatusLabel = this._isSuccess
            ? LocalizedConstants.querySuccess
            : LocalizedConstants.queryFailed;
        this.tooltip = `${tooltip}${os.EOL}${os.EOL}${queryStatusLabel}`;
        this.contextValue = QueryHistoryNode.contextValue;
        this.initializeIcons();
    }

    private initializeIcons(): void {
        const iconsPath: string = path.join(extensionUri.fsPath, "media", "queryHistory");
        this.successIcon = path.join(iconsPath, "status_success.svg");
        this.failureIcon = path.join(iconsPath, "status_error.svg");
    }

    /** Getters */
    public get historyNodeLabel(): string {
        const label = typeof this.label === "string" ? this.label : this.label.label;
        return label;
    }

    public get ownerUri(): string {
        return this._ownerUri;
    }

    public get timeStamp(): Date {
        return this._timeStamp;
    }

    public get queryString(): string {
        return this._queryString;
    }

    public get connectionLabel(): string {
        return this._connectionLabel;
    }
}
