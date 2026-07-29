/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from "vscode";

function createMemento(): vscode.Memento {
    const values = new Map<string, unknown>();

    return {
        get: <T>(key: string, defaultValue?: T) =>
            (values.get(key) as T | undefined) ?? defaultValue,
        keys: () => [...values.keys()],
        update: (key: string, value: unknown) => {
            values.set(key, value);
            return Promise.resolve();
        },
    };
}

export function createFakeExtensionContext(
    overrides: Partial<vscode.ExtensionContext> = {},
): vscode.ExtensionContext {
    const context = {
        subscriptions: [],
        extension: {
            id: "test.extension",
            packageJSON: {
                displayName: "Test Extension",
            },
        },
        workspaceState: createMemento(),
        globalState: createMemento(),
        asAbsolutePath: (relativePath: string) => relativePath,
        ...overrides,
    };

    return context as vscode.ExtensionContext;
}
