/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Subject } from "rxjs/Subject";
import { Injectable, OnDestroy } from "@angular/core";
import { ISlickRange } from "angular2-slickgrid";
import { QueryEvent, ResultSetSubset, ISelectionData } from "./../../../../../extension/models/interfaces";
import * as Constants from "./../constants";
import { createProxy, IMessageProtocol, IServerProxy } from "../../../../../extension/protocol";
import { TelemetryActions, TelemetryViews } from "../../../../../shared/telemetry";

declare function acquireVsCodeApi(): { postMessage: (message: string) => void };

export const vscodeApi = acquireVsCodeApi();

function createMessageProtocol(): IMessageProtocol {
    return {
        onMessage: (listener) => {
            const windowListener = (event: MessageEvent) => {
                const message = event.data;
                listener(message);
            };
            window.addEventListener("message", windowListener);
            return {
                dispose: () => window.removeEventListener("message", windowListener),
            };
        },
        sendMessage: (message) => vscodeApi.postMessage(message),
    };
}

/**
 * Service which performs the http requests to get the data resultsets from the server.
 */

@Injectable()
export class DataService implements OnDestroy {
    private _shortcuts;
    private _config;
    private _proxy: IServerProxy;
    public dataEventObs = new Subject<QueryEvent>();

    constructor() {
        this._proxy = createProxy(
            createMessageProtocol(),
            {
                sendEvent: (type, args) => this.sendEvent(type, args),
                dispose: () => void 0,
            },
            true,
        );

        this.getLocalizedTextsRequest().then((result) => {
            Object.keys(result).forEach((key) => {
                Constants.loadLocalizedConstant(key, result[key]);
            });
        });
    }

    ngOnDestroy(): void {
        this.dataEventObs.dispose();
        this._proxy.dispose();
    }

    private sendEvent(type: string, arg: any): void {
        this.dataEventObs.next({ type, data: arg });
    }

    /**
     * Get a specified number of rows starting at a specified row for
     * the current results set
     * @param start The starting row or the requested rows
     * @param numberOfRows The amount of rows to return
     * @param batchId The batch id of the batch you are querying
     * @param resultId The id of the result you want to get the rows for
     */
    getRows(
        start: number,
        numberOfRows: number,
        batchId: number,
        resultId: number,
    ): Promise<ResultSetSubset> {
        return this._proxy.getRows(batchId, resultId, start, numberOfRows);
    }

    /**
     * send request to save the selected result set as csv, json or excel
     * @param batchIndex The batch id of the batch with the result to save
     * @param resultSetNumber The id of the result to save
     * @param format The format to save in - csv, json, excel
     * @param selection The range inside the result set to save, or empty if all results should be saved
     */
    sendSaveRequest(
        batchIndex: number,
        resultSetNumber: number,
        format: string,
        selection: ISlickRange[],
    ): void {
        this._proxy.saveResults(batchIndex, resultSetNumber, format, selection);
    }

    sendActionEvent(
        telemetryView: TelemetryViews,
        telemetryAction: TelemetryActions,
        additionalProps: { [key: string]: string },
        additionalMeasurements: { [key: string]: number },
    ): void {
        this._proxy.sendActionEvent(
            telemetryView,
            telemetryAction,
            additionalProps,
            additionalMeasurements,
        );
    }

    /**
     * send ready event to server to show that
     * the angular app has loaded
     */
    sendReadyEvent(uri: string): void {
        this._proxy.sendReadyEvent(uri);
    }

    /**
     * send request to get all the localized texts
     */
    getLocalizedTextsRequest(): Promise<{ [key: string]: any }> {
        return this._proxy.getLocalizedTexts();
    }

    /**
     * send request to open content in new editor
     * @param content The content to be opened
     * @param columnName The column name of the content
     */
    openLink(content: string, columnName: string, linkType: string): void {
        this._proxy.openLink(content, columnName, linkType);
    }

    /**
     * Sends a copy request
     * @param selection The selection range to copy
     * @param batchId The batch id of the result to copy from
     * @param resultId The result id of the result to copy from
     * @param includeHeaders [Optional]: Should column headers be included in the copy selection
     */
    copyResults(
        selection: ISlickRange[],
        batchId: number,
        resultId: number,
        includeHeaders?: boolean,
    ): void {
        this._proxy.copyResults(batchId, resultId, selection, includeHeaders);
    }

    /**
     * Sends a request to set the selection in the VScode window
     * @param selection The selection range in the VSCode Window
     */
    setEditorSelection(selection: ISelectionData): void {
        this._proxy.setEditorSelection(selection);
    }

    showWarning(message: string): void {
        this._proxy.showWarning(message);
    }

    showError(message: string): void {
        this._proxy.showError(message);
    }

    get config(): Promise<{ [key: string]: any }> {
        const self = this;
        if (this._config) {
            return Promise.resolve(this._config);
        } else {
            return this._proxy.getConfig().then((config) => {
                self._shortcuts = config.shortcuts;
                delete config.shortcuts;
                self._config = config;
                return self._config;
            });
        }
    }

    get shortcuts(): Promise<any> {
        const self = this;
        if (this._shortcuts) {
            return Promise.resolve(this._shortcuts);
        } else {
            return this._proxy.getConfig().then((config) => {
                self._shortcuts = config.shortcuts;
                delete config.shortcuts;
                self._config = config;
                return self._shortcuts;
            });
        }
    }

    getNewColumnWidth(currentWidth: number): Promise<number | undefined> {
        return this._proxy.getNewColumnWidth(currentWidth);
    }
}
