/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewApi } from "vscode-webview";
import {
    LoggerMethod,
    ILogger,
    LogEvent,
    LoggerMessageMethod,
} from "../../sharedInterfaces/logger";
import {
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
    type RequestParam,
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

class WebviewLogger implements ILogger {
    constructor(
        private readonly _sendLogEvent: (event: LogEvent) => void,
        private readonly _prefix?: string,
    ) {}

    public trace(message: string, ...args: unknown[]): void {
        this.log(LoggerMethod.Trace, message, ...args);
    }

    public debug(message: string, ...args: unknown[]): void {
        this.log(LoggerMethod.Debug, message, ...args);
    }

    public info(message: string, ...args: unknown[]): void {
        this.log(LoggerMethod.Info, message, ...args);
    }

    public warn(message: string, ...args: unknown[]): void {
        this.log(LoggerMethod.Warn, message, ...args);
    }

    public error(message: string, ...args: unknown[]): void {
        this.log(LoggerMethod.Error, message, ...args);
    }

    public piiSanitized(
        msg: unknown,
        objsToSanitize: { name: string; objOrArray: unknown | unknown[] }[],
        stringsToShorten: { name: string; value: string }[],
        ...vals: unknown[]
    ): void {
        this._sendLogEvent({
            method: LoggerMethod.PiiSanitized,
            msg,
            objsToSanitize,
            stringsToShorten,
            vals,
            prefix: this._prefix,
        });
    }

    public show(preserveFocus?: boolean): void {
        this._sendLogEvent({ method: LoggerMethod.Show, preserveFocus, prefix: this._prefix });
    }

    public withPrefix(prefix: string): ILogger {
        return new WebviewLogger(
            this._sendLogEvent,
            this._prefix ? `${this._prefix}.${prefix}` : prefix,
        );
    }

    public dispose(): void {
        this._sendLogEvent({ method: LoggerMethod.Dispose, prefix: this._prefix });
    }

    private log(method: LoggerMessageMethod, message: string, ...args: unknown[]): void {
        this._sendLogEvent({ method, message, args, prefix: this._prefix });
    }
}

/**
 * RPC to communicate with the extension.
 * @template Reducers interface that contains definitions for all reducers and their payloads.
 */
export class WebviewRpc<Reducers> {
    public connection: MessageConnection;
    public readonly log: ILogger;

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
    public static getInstance<Reducers>(
        vscodeApi: WebviewApi<unknown> | undefined,
    ): WebviewRpc<Reducers> {
        if (!WebviewRpc._instance && vscodeApi) {
            WebviewRpc._instance = new WebviewRpc<Reducers>(vscodeApi);
        }
        return WebviewRpc._instance;
    }

    private constructor(_vscodeApi: WebviewApi<unknown>) {
        this.connection = createMessageConnection(
            new WebviewRpcMessageReader(),
            new WebviewRpcMessageWriter(_vscodeApi),
        );

        this.log = new WebviewLogger((event) => {
            void this.sendNotification(LogNotification.type, event);
        });

        this.connection.onError((error) => {
            this.log.error("WebviewRpc connection error", error);
        });

        this.connection.onClose(() => {
            this.log.warn("WebviewRpc connection closed");
        });

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

    public onRequest<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): void {
        this.connection.onRequest(type, handler);
    }

    public sendRequest<P, R, E>(
        type: RequestType<P, R, E>,
        params?: P,
        token?: CancellationToken,
    ): Promise<R> {
        return this.connection.sendRequest(type, params as RequestParam<P>, token);
    }

    public async sendNotification<P>(type: NotificationType<P>, params?: P): Promise<void> {
        return this.connection.sendNotification(type, params as RequestParam<P>);
    }

    public onNotification<P>(type: NotificationType<P>, handler: (params: P) => void): void {
        this.connection.onNotification(type, handler);
    }
}
