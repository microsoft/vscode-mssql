/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Client interfaces and base classes for SQL Ops features.
 * These are taken from https://github.com/microsoft/sqlops-dataprotocolclient/
 * We can't directly import from there, because it relies on the package "azdata"
 * which we don't want to have as a dependency in this extension. Instead, we copy the necessary
 * code here and modify it to remove the azdata dependency.
 */

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
} from "vscode-languageclient";
import * as is from "vscode-languageclient/lib/utils/is";

export interface IFeature {
    new (client: LanguageClient);
}

export interface FlatFileClientOptions extends LanguageClientOptions {
    providerId: string;
    features?: Array<IFeature>;
}

export abstract class Feature<T> implements DynamicFeature<T> {
    protected _providers: Map<string, Disposable> = new Map<string, Disposable>();
    protected _disposables: Disposable[] = [];

    constructor(
        protected _client: LanguageClient,
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
