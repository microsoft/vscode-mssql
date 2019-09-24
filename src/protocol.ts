/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Disposable } from 'vscode';
import { ISlickRange, IResultsConfig, ResultSetSubset, ISelectionData } from './models/interfaces';

export interface IWebviewProxy {
    sendEvent(type: string, arg: any): void;
}

export interface IServerProxy {
    getRows(batchId: number, resultId: number, rowStart: number, numberOfRows: number): Promise<ResultSetSubset>;
    saveResults(batchId: number, resultId: number, format: string, selection: ISlickRange[]): void;
    openLink(content: string, columnName: string, linkType: string): void;
    copyResults(batchId: number, resultsId: number, selection: ISlickRange[], includeHeaders?: boolean): void;
    getConfig(): Promise<IResultsConfig>;
    setEditorSelection(selectionData: ISelectionData): void;
    showWarning(message: string): void;
    showError(message: string): void;
    getLocalizedTexts(): Promise<{ [key: string]: any }>;
}

export interface IMessageProtocol {
    sendMessage(message: string): void;
    onMessage: Event<string>;
}

export class Deferred<T> {
   promise: Promise<T>;
   resolve: (value?: T | PromiseLike<T>) => void;
   reject: (reason?: any) => void;
   constructor() {
       this.promise = new Promise<T>((resolve, reject) => {
           this.resolve = resolve;
           this.reject = reject;
       });
   }

   then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>;
   then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult> {
       return this.promise.then(onfulfilled, onrejected);
   }
}

interface IResponse {
    originalMessageId: number;
    response: any;
}

interface IRequest {
    messageId: number;
    method: string;
    passArguments: any[];
}

class MessageProxy implements Disposable {
    private ready = new Deferred();

    private messageid = 0;

    private responseMap = new Map<number, Deferred<any>>();

    private disposables: Disposable[] = [];

    constructor(private protocol: IMessageProtocol, private handler: any, isClient: boolean = false) {
        const self = this;
        if (!isClient) {
            const first = self.protocol.onMessage(message => {
                // first message
                if (message === 'ready') {
                    // sanity check
                    this.disposables.push(self.protocol.onMessage(val => self.onReceive(val)));
                    first.dispose();
                    self.ready.resolve();
                }
            });
        } else {
            this.disposables.push(this.protocol.onMessage(val => this.onReceive(val)));
            this.ready.resolve();
            this.protocol.sendMessage('ready');
        }
    }

    public async sendRequest(methodName: string, args: any[]): Promise<any> {
        await this.ready;
        const messageId = this.messageid++;
        const deferred = new Deferred<any>();
        this.responseMap.set(messageId, deferred);
        const request: IRequest = {
            messageId: messageId,
            method: methodName,
            passArguments: args
        };
        this.protocol.sendMessage(JSON.stringify(request));
        return deferred.promise;
    }

    private onReceive(val: string): void {
        const message: IResponse | IRequest = JSON.parse(val);
        if (isResponseMessage(message)) { // is a response
            const deferred = this.responseMap.get(message.originalMessageId);
            if (deferred) {
                deferred.resolve(message.response);
            }
        } else {
            Promise.resolve(this.handler[message.method].apply(this.handler, message.passArguments)).then(r => {
                const response: IResponse = {
                    originalMessageId: message.messageId,
                    response: r
                };
                this.protocol.sendMessage(JSON.stringify(response));
            });
        }
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}

function isResponseMessage(val: any): val is IResponse {
    return typeof val.originalMessageId === 'number';
}

export function createProxy(protocol: IMessageProtocol, handler: IServerProxy, isClient: boolean): IWebviewProxy;
export function createProxy(protocol: IMessageProtocol, handler: IWebviewProxy, isClient: boolean): IServerProxy;
export function createProxy(protocol: IMessageProtocol, handler: any, isClient: boolean): any {
    const messageProxy = new MessageProxy(protocol, handler, isClient);
    let proxy = {
        get: (target: any, name: string) => {
            if (!target[name]) {
                target[name] = (...myArgs: any[]) => {
                    return messageProxy.sendRequest(name, myArgs);
                };
            }
            return target[name];
        },
        dispose: () => {
            messageProxy.dispose();
        }
    };
    // tslint:disable-next-line: no-null-keyword
    return new Proxy(Object.create(null), proxy);
}
