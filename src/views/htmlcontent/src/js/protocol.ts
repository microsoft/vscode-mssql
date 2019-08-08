import { Event } from 'vscode';
import { ISlickRange, IResultsConfig, ISelectionData, ResultSetSubset } from './interfaces';

export interface IWebviewProxy {
    sendEvent(type: string, arg: any): void;
}

export interface IServerProxy {
    getRows(batchId: number, resultId: number, rowStart: number, numberOfRows: number): Promise<ResultSetSubset>;
    saveResults(batchId: number, resultId: number, format: string, selection: ISlickRange[]): void;
    openLink(content: string, columnName: string, linkType: string): void;
    copyResults(batchId: number, resultsId: number, selection: ISlickRange[], includeHeaders?: boolean): void;
    getConfig(): Promise<IResultsConfig>;
    setEditorSelection(selection: ISelectionData): void;
    showWarning(message: string): void;
    showError(message: string): void;
    getLocalizedTexts(): Promise<{ [key: string]: any }>;
}

export interface IMessageProtocol {
    sendMessage(message: string): void;
    onMessage: Event<string>;
}

class Deferred<T> {
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

class MessageProxy {
    private ready = new Deferred();

    private messageid = 0;

    private responseMap = new Map<number, Deferred<any>>();

    constructor(private protocol: IMessageProtocol, private handler: any, isClient: boolean = false) {
        if (!isClient) {
            const first = protocol.onMessage(message => {
                // first message
                if (message === 'ready') {
                    // sanity check
                    protocol.onMessage(val => this.onReceive(val));
                    first.dispose();
                    this.ready.resolve();
                }
            });
        } else {
            protocol.onMessage(val => this.onReceive(val));
            protocol.sendMessage('ready');
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
}

function isResponseMessage(val: any): val is IResponse {
    return !!val.originalMessageId;
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
        }
    };
    // tslint:disable-next-line: no-null-keyword
    return new Proxy(Object.create(null), proxy);
}
