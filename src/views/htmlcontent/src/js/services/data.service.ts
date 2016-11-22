/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {Injectable, Inject, forwardRef} from '@angular/core';
import {Http, Headers} from '@angular/http';
import { Observable, Subject, Observer } from 'rxjs/Rx';

import { ISlickRange } from 'angular2-slickgrid';

import * as Utils from './../utils';

import { ResultSetSubset, ISelectionData,
    IResultsConfig, WebSocketEvent } from './../interfaces';

const WS_URL = 'ws://localhost:' + window.location.port + '/';

/**
 * Service which performs the http requests to get the data resultsets from the server.
 */

@Injectable()
export class DataService {
    private uri: string;
    public ws: WebSocket;
    public dataEventObs: Subject<WebSocketEvent>;
    private _shortcuts;
    private _config;

    /* for testing purposes only */
    public get webSocket(): WebSocket {
        return this.ws;
    }

    constructor(@Inject(forwardRef(() => Http)) private http) {
        const self = this;
        // grab the uri from the document for requests
        this.uri = encodeURI(document.getElementById('uri') ? document.getElementById('uri').innerText.trim() : '');
        this.ws = new WebSocket(WS_URL + '?uri=' + this.uri);
        let observable = Observable.create(
            (obs: Observer<MessageEvent>) => {
                self.ws.onmessage = obs.next.bind(obs);
                self.ws.onerror = obs.error.bind(obs);
                self.ws.onclose = obs.complete.bind(obs);

                return self.ws.close.bind(self.ws);
            }
        );

        let observer = {
            next: (data: Object) => {
                if (self.ws.readyState === WebSocket.OPEN) {
                    self.ws.send(JSON.stringify(data));
                }
            }
        };

        this.dataEventObs = Subject.create(observer, observable).map((response: MessageEvent): WebSocketEvent => {
            let data = JSON.parse(response.data);
            return data;
        });
    }

    /**
     * Get a specified number of rows starting at a specified row for
     * the current results set
     * @param start The starting row or the requested rows
     * @param numberOfRows The amount of rows to return
     * @param batchId The batch id of the batch you are querying
     * @param resultId The id of the result you want to get the rows for
     */
    getRows(start: number, numberOfRows: number, batchId: number, resultId: number): Observable<ResultSetSubset> {
        let uriFormat = '/{0}?batchId={1}&resultId={2}&uri={3}';
        let uri = Utils.formatString(uriFormat, 'rows', batchId, resultId, this.uri);
        return this.http.get(uri + '&rowStart=' + start
                                 + '&numberOfRows=' + numberOfRows)
                            .map(res => {
                                return res.json();
                            });
    }

    /**
     * send request to save the selected result set as csv
     * @param uri of the calling document
     * @param batchId The batch id of the batch with the result to save
     * @param resultId The id of the result to save as csv
     */
    sendSaveRequest(batchIndex: number, resultSetNumber: number, format: string, selection: ISlickRange[]): void {
        const self = this;
        let headers = new Headers();
        let url = '/saveResults?'
                        + '&uri=' + self.uri
                        + '&format=' + format
                        + '&batchIndex=' + batchIndex
                        + '&resultSetNo=' + resultSetNumber ;
        self.http.post(url, selection, { headers: headers })
            .subscribe(undefined, err => {
                self.showError(err.statusText);
            });
    }

    /**
     * send request to open content in new editor
     * @param content The content to be opened
     * @param columnName The column name of the content
     */
    openLink(content: string, columnName: string, linkType: string): void {
        const self = this;
        let headers = new Headers();
        headers.append('Content-Type', 'application/json');
        self.http.post('/openLink', JSON.stringify({ 'content': content , 'columnName': columnName, 'type': linkType}), { headers : headers })
            .subscribe(undefined, err => {
                self.showError(err.statusText);
            });
    }

    /**
     * Sends a copy request
     * @param selection The selection range to copy
     * @param batchId The batch id of the result to copy from
     * @param resultId The result id of the result to copy from
     * @param includeHeaders [Optional]: Should column headers be included in the copy selection
     */
    copyResults(selection: ISlickRange[], batchId: number, resultId: number, includeHeaders?: boolean): void {
        const self = this;
        let headers = new Headers();
        let url = '/copyResults?' + '&uri=' + self.uri + '&batchId=' + batchId + '&resultId=' + resultId;
        if (includeHeaders !== undefined) {
            url += '&includeHeaders=' + includeHeaders;
        }
        self.http.post(url, selection, { headers: headers }).subscribe();
    }

    /**
     * Sends a request to set the selection in the VScode window
     * @param selection The selection range in the VSCode window
     */
    set editorSelection(selection: ISelectionData) {
        const self = this;
        let headers = new Headers();
        let url = '/setEditorSelection?' + '&uri=' + self.uri;
        self.http.post(url, selection, { headers: headers }).subscribe();
    }

    showWarning(message: string): void {
        const self = this;
        let url = '/showWarning?' + '&uri=' + self.uri;
        let headers = new Headers();
        headers.append('Content-Type', 'application/json');
        self.http.post(url, JSON.stringify({ 'message': message }), { headers: headers }).subscribe();
    }

    showError(message: string): void {
        const self = this;
        let url = '/showError?' + '&uri=' + self.uri;
        let headers = new Headers();
        headers.append('Content-Type', 'application/json');
        self.http.post(url, JSON.stringify({ 'message': message }), { headers: headers }).subscribe();
    }

    get config(): Promise<{[key: string]: any}> {
        const self = this;
        if (this._config) {
            return Promise.resolve(this._config);
        } else {
            return new Promise<{[key: string]: string}>((resolve, reject) => {
                self.http.get('/config').map((res): IResultsConfig => {
                    return res.json();
                }).subscribe((result: IResultsConfig) => {
                    self._shortcuts = result.shortcuts;
                    delete result.shortcuts;
                    self._config = result;
                    resolve(self._config);
                });
            });
        }
    }

    get shortcuts(): Promise<any> {
        const self = this;
        if (this._shortcuts) {
            return Promise.resolve(this._shortcuts);
        } else {
            return new Promise<any>((resolve, reject) => {
                self.http.get('/config').map((res): IResultsConfig => {
                    return res.json();
                }).subscribe((result) => {
                    self._shortcuts = result.shortcuts;
                    delete result.resultShortcuts;
                    self._config = result;
                    resolve(self._shortcuts);
                });
            });
        }
    }
}
