/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";

export class FakeSecretStorage implements vscode.SecretStorage {
    private readonly _values = new Map<string, string>();
    private readonly _onDidChange = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
    public readonly onDidChange = this._onDidChange.event;

    public get(key: string): Thenable<string | undefined> {
        return Promise.resolve(this._values.get(key));
    }

    public async store(key: string, value: string): Promise<void> {
        this._values.set(key, value);
        this._onDidChange.fire({ key });
    }

    public async delete(key: string): Promise<void> {
        this._values.delete(key);
        this._onDidChange.fire({ key });
    }
}

export class FakeMemento implements vscode.Memento {
    private readonly _values = new Map<string, unknown>();

    public get<T>(key: string): T | undefined;
    public get<T>(key: string, defaultValue: T): T;
    public get<T>(key: string, defaultValue?: T): T | undefined {
        return this._values.has(key) ? (this._values.get(key) as T) : defaultValue;
    }

    public async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this._values.delete(key);
        } else {
            this._values.set(key, value);
        }
    }

    public keys(): readonly string[] {
        return Array.from(this._values.keys());
    }
}

export function createSdkExtensionContext(): vscode.ExtensionContext {
    return {
        subscriptions: [],
        secrets: new FakeSecretStorage(),
        globalState: new FakeMemento(),
        workspaceState: new FakeMemento(),
    } as unknown as vscode.ExtensionContext;
}

export function stubWorkspaceConfiguration(
    sandbox: sinon.SinonSandbox,
    values: Record<string, unknown> = {},
): void {
    sandbox.stub(vscode.workspace, "getConfiguration").returns({
        get: <T>(key: string, defaultValue?: T): T => {
            return Object.prototype.hasOwnProperty.call(values, key)
                ? (values[key] as T)
                : (defaultValue as T);
        },
    } as vscode.WorkspaceConfiguration);
}

export function textOf(parts: vscode.LanguageModelTextPart[]): string {
    return parts.map((part) => part.value).join("");
}
