/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewApi } from "vscode-webview";
import {
    LoggerLevel,
    LogNotification,
    ReducerRequest,
    SendActionEventNotification,
    SendErrorEventNotification,
    WebviewTelemetryActionEvent,
    WebviewTelemetryErrorEvent,
} from "../../sharedInterfaces/webview";
import {
    AbstractMessageReader,
    AbstractMessageWriter,
    CancellationToken,
    createMessageConnection,
    DataCallback,
    Disposable,
    Emitter,
    Message,
    MessageConnection,
    MessageReader,
    MessageWriter,
    NotificationType,
    RequestHandler,
    RequestType,
} from "vscode-jsonrpc/browser";

class WebviewRpcMessageReader extends AbstractMessageReader implements MessageReader {
    private _onData: Emitter<Message>;
    constructor() {
        super();
        this._onData = new Emitter<Message>();
        window.addEventListener("message", (event) => {
            this._onData.fire(event.data as Message);
        });
    }
    listen(callback: DataCallback): Disposable {
        return this._onData.event(callback);
    }
}

class WebviewRpcMessageWriter extends AbstractMessageWriter implements MessageWriter {
    constructor(private _vscodeApi: WebviewApi<unknown>) {
        super();
    }
    write(msg: Message): Promise<void> {
        this._vscodeApi.postMessage(msg);
        return Promise.resolve();
    }
    end(): void {}
}

/**
 * RPC to communicate with the extension.
 * @template Reducers interface that contains definitions for all reducers and their payloads.
 */
export class WebviewRpc<Reducers> {
    public connection: MessageConnection;

    /**
     * Singleton instance of the WebviewRpc class.
     * @param vscodeApi The WebviewApi instance to communicate with the extension.
     * @returns The singleton instance of WebviewRpc.
     */
    private static _instance: WebviewRpc<any>;
    /**
     * Get the singleton instance of the WebviewRpc class.
     * This method ensures that only one instance of the WebviewRpc class is created.
     * @param vscodeApi The WebviewApi instance to communicate with the extension.
     * @returns The singleton instance of WebviewRpc.
     */
    public static getInstance<Reducers>(vscodeApi: WebviewApi<unknown>): WebviewRpc<Reducers> {
        if (!WebviewRpc._instance) {
            WebviewRpc._instance = new WebviewRpc<Reducers>(vscodeApi);
        }
        return WebviewRpc._instance;
    }

    private constructor(_vscodeApi: WebviewApi<unknown>) {
        //this._setupMessageListener();
        this.connection = createMessageConnection(
            new WebviewRpcMessageReader(),
            new WebviewRpcMessageWriter(_vscodeApi),
        );
        this.connection.listen();
    }

    /**
     * Call reducers defined for the webview. Use this for actions that modify the state of the webview.
     * @param method name of the method to call
     * @param payload parameters to pass to the method
     * @template MethodName name of the method to call. Must be a key of the Reducers interface.
     */
    public action<MethodName extends keyof Reducers>(
        method: MethodName,
        payload?: Reducers[MethodName],
    ) {
        void this.sendRequest(ReducerRequest.type<Reducers>(), {
            type: method,
            payload: payload,
        });
    }

    public sendActionEvent(event: WebviewTelemetryActionEvent) {
        void this.sendNotification(SendActionEventNotification.type, event);
    }

    public sendErrorEvent(event: WebviewTelemetryErrorEvent) {
        void this.sendNotification(SendErrorEventNotification.type, event);
    }

    public log(message: string, level?: LoggerLevel) {
        void this.sendNotification(LogNotification.type, { message, level });
    }

    public onRequest<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): void {
        this.connection.onRequest(type, handler);
    }

    public sendRequest<P, R, E>(
        type: RequestType<P, R, E>,
        params?: P,
        token?: CancellationToken,
    ): Promise<R> {
        return this.connection.sendRequest(type, params, token);
    }

    public async sendNotification<P>(type: NotificationType<P>, params?: P): Promise<void> {
        return this.connection.sendNotification(type, params);
    }

    public onNotification<P>(type: NotificationType<P>, handler: (params: P) => void): void {
        this.connection.onNotification(type, handler);
    }
}
