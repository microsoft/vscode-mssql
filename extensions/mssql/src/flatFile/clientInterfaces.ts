/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    ClientCapabilities,
    Disposable,
    DynamicFeature,
    LanguageClient,
    LanguageClientOptions,
    NotificationType,
    RegistrationData,
    RPCMessageType,
    ServerCapabilities,
    ServerOptions,
} from "vscode-languageclient";
import * as is from "vscode-languageclient/lib/utils/is";

export const enum Events {
    /**
     * Download start, data will be downloading url and size of the download in bytes
     */
    DOWNLOAD_START = "download_start",
    /**
     * Download progress event, data will be the current progress of the download
     */
    DOWNLOAD_PROGRESS = "download_progress",
    /**
     * Download end
     */
    DOWNLOAD_END = "download_end",
    /**
     * Install Start, data will be install directory
     */
    INSTALL_START = "install_start",
    /**
     * Entry extracted from downloaded archive.
     * Data :
     *  0 : Path to file/folder
     *  1 : Entry number
     *  2 : Total number of entries
     */
    ENTRY_EXTRACTED = "entry_extracted",
    /**
     * Install End
     */
    INSTALL_END = "install_end",
    /**
     * When log is emitted.
     * Event arguments:
     * 1. Log Level
     * 2. Message
     */
    LOG_EMITTED = "log_emitted",
}

/**
 * The severity level of a log message.
 */
export const enum LogLevel {
    Verbose = 0,
    Information = 1,
    Warning = 2,
    Error = 3,
    Critical = 4,
}

export class CustomOutputChannel implements vscode.OutputChannel {
    name: string;
    append(value: string): void {}
    appendLine(value: string): void {}
    // tslint:disable-next-line:no-empty
    clear(): void {}
    show(preserveFocus?: boolean): void;
    show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
    // tslint:disable-next-line:no-empty
    show(column?: any, preserveFocus?: any): void {}
    // tslint:disable-next-line:no-empty
    hide(): void {}
    // tslint:disable-next-line:no-empty
    dispose(): void {}
    replace(_value: string): void {}
}

/**
 *
 */
export class SqlOpsDataClient extends LanguageClient {
    private _providerId: string;

    public get providerId(): string {
        return this._providerId;
    }

    public constructor(
        name: string,
        serverOptions: ServerOptions,
        clientOptions: ClientOptions,
        forceDebug?: boolean,
    );
    public constructor(
        id: string,
        name: string,
        serverOptions: ServerOptions,
        clientOptions: ClientOptions,
        forceDebug?: boolean,
    );
    public constructor(
        arg1: string,
        arg2: ServerOptions | string,
        arg3: ClientOptions | ServerOptions,
        arg4?: boolean | ClientOptions,
        arg5?: boolean,
    ) {
        super(
            arg1,
            typeof arg2 === "string" ? <ServerOptions>arg3 : <ServerOptions>arg2,
            typeof arg2 === "string" ? <ClientOptions>arg4 : <ClientOptions>arg3,
            typeof arg2 === "string" ? <boolean>arg5 : <boolean>arg4,
        );
        this._providerId = typeof arg2 === "string" ? arg1 : "";
    }
}

export interface ISqlOpsFeature {
    new (client: SqlOpsDataClient);
}

export interface ClientOptions extends LanguageClientOptions {
    providerId: string;
    features?: Array<ISqlOpsFeature>;
}

export abstract class SqlOpsFeature<T> implements DynamicFeature<T> {
    protected _providers: Map<string, Disposable> = new Map<string, Disposable>();
    protected _disposables: Disposable[] = [];

    constructor(
        protected _client: SqlOpsDataClient,
        private _message: RPCMessageType | RPCMessageType[],
    ) {}

    public get messages(): RPCMessageType | RPCMessageType[] {
        return this._message;
    }

    public abstract fillClientCapabilities(capabilities: ClientCapabilities): void;

    public abstract initialize(capabilities: ServerCapabilities): void;

    public register(messages: RPCMessageType | RPCMessageType[], data: RegistrationData<T>): void {
        // Error catching
        if (is.array<RPCMessageType>(this.messages) && is.array<RPCMessageType>(messages)) {
            let valid = messages.every(
                (v) => !!(this.messages as RPCMessageType[]).find((i) => i.method === v.method),
            );
            if (!valid) {
                throw new Error(`Register called on wrong feature.`);
            }
        } else if (is.array<RPCMessageType>(this.messages) && !is.array<RPCMessageType>(messages)) {
            if (!this.messages.find((i) => i.method === messages.method)) {
                throw new Error(`Register called on wrong feature.`);
            }
        } else if (
            !is.array<RPCMessageType>(this.messages) &&
            !is.array<RPCMessageType>(messages)
        ) {
            if (this.messages.method !== messages.method) {
                throw new Error(
                    `Register called on wrong feature. Requested ${messages.method} but reached feature ${this.messages.method}`,
                );
            }
        }

        let provider = this.registerProvider(data.registerOptions);
        if (provider) {
            this._providers.set(data.id, provider);
        }
    }

    protected abstract registerProvider(options: T): Disposable;

    public unregister(id: string): void {
        let provider = this._providers.get(id);
        if (provider) {
            provider.dispose();
            // TODO Should remove it from list
        }
    }

    public dispose(): void {
        this._providers.forEach((value) => {
            value.dispose();
        });
        this._disposables.forEach((d) => d.dispose());
        this._providers.clear();
        this._disposables = [];
    }

    /**
     * Registers an EventEmitter for the specified notification, which will fire an event whenever that notification is received.
     */
    protected registerNotificationEmitter<P, RO>(
        notificationType: NotificationType<P, RO>,
    ): vscode.EventEmitter<P> {
        const eventEmitter = new vscode.EventEmitter<P>();
        this._disposables.push(eventEmitter);
        this._client.onNotification(notificationType, (params) => {
            eventEmitter.fire(params);
        });
        return eventEmitter;
    }
}
