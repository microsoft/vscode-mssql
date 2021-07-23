/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Subject } from 'rxjs/Subject';
import { Injectable, OnDestroy } from '@angular/core';
import { QueryEvent, ResultSetSubset, ISelectionData } from './../../../../../models/interfaces';
import { createProxy, IMessageProtocol, IServerProxy } from '../../../../modelViewProtocol';
import { AppComponent } from '../components/app.component';

declare function acquireVsCodeApi(): { postMessage: (message: string) => void; };

export const vscodeApi = acquireVsCodeApi();

function createMessageProtocol(): IMessageProtocol {
    return {
        onMessage: listener => {
            const windowListener = (event: MessageEvent) => {
                const message = event.data;
                listener(message);
            };
            window.addEventListener('message', windowListener);
            return {
                dispose: () => window.removeEventListener('message', windowListener)
            };
        },
        sendMessage: message => vscodeApi.postMessage(message)
    };
}

/**
 * Service which performs the http requests to get the data resultsets from the server.
 */

@Injectable()
export class DataService implements OnDestroy {
    private _config;
    private _proxy: IServerProxy;
    public dataEventObs = new Subject<QueryEvent>();

    constructor() {
        this._proxy = createProxy(createMessageProtocol(), {
            sendEvent: (type, args) => this.sendEvent(type, args),
            dispose: () => void(0)
        }, true);
    }

    ngOnDestroy(): void {
        (<any>this.dataEventObs).dispose();
        this._proxy.dispose();
    }

    private sendEvent(type: string, arg: any): void {
        this.dataEventObs.next({ type, data: arg });
    }

    /**
     * send ready event to server to show that
     * the angular app has loaded
     */
    sendReadyEvent(uri: string): void {
        this._proxy.sendReadyEvent(uri);
    }


    showWarning(message: string): void {
        this._proxy.showWarning(message);
    }

    showError(message: string): void {
        this._proxy.showError(message);
    }

    sendButtonClickEvent(controlId: string) {
        this._proxy.sendButtonClickEvent(controlId);
    }

    sendControlProperyValue(controlId: string, propertyName: string, propertyValue: string): void {
        this._proxy.sendControlProperyValue(controlId, propertyName, propertyValue);
    }

    get config(): Promise<{[key: string]: any}> {
        const self = this;
        if (this._config) {
            return Promise.resolve(this._config);
        } else {
            return this._proxy.getConfig().then(config => {
                self._config = config;
                return self._config;
            });
        }
    }
}
