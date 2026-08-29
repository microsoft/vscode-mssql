/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type * as vscode from "vscode";
import { DabConfigGlobalStateStore } from "../../src/dab/dabConfigGlobalStateStore";
import { Dab } from "../../src/sharedInterfaces/dab";

function createMemento(): { memento: vscode.Memento; values: Map<string, unknown> } {
    const values = new Map<string, unknown>();
    return {
        values,
        memento: {
            get: <T>(key: string, defaultValue?: T): T | undefined =>
                (values.has(key) ? values.get(key) : defaultValue) as T | undefined,
            update: async (key: string, value: unknown): Promise<void> => {
                if (value === undefined) {
                    values.delete(key);
                } else {
                    values.set(key, value);
                }
            },
            keys: (): readonly string[] => [...values.keys()],
        },
    };
}

function createConfig(): Dab.DabConfig {
    return {
        apiTypes: [Dab.ApiType.Rest],
        entities: [],
    };
}

suite("DabConfigGlobalStateStore", () => {
    test("persists and restores a config for a connection and normalized database", async () => {
        const { memento } = createMemento();
        const config = createConfig();

        await new DabConfigGlobalStateStore(memento, "connection-1", " AdventureWorks ").set(
            config,
        );

        expect(
            new DabConfigGlobalStateStore(memento, "connection-1", "adventureworks").get(),
        ).to.deep.equal(config);
    });

    test("isolates databases and does not expose identity values in the storage key", async () => {
        const { memento, values } = createMemento();
        const config = createConfig();
        const connectionId = "private-connection-id";
        const databaseName = "PrivateDatabase";

        await new DabConfigGlobalStateStore(memento, connectionId, databaseName).set(config);

        expect(
            new DabConfigGlobalStateStore(memento, connectionId, "OtherDatabase").get(),
        ).to.equal(undefined);
        const [storageKey] = [...values.keys()];
        expect(storageKey).to.not.contain(connectionId);
        expect(storageKey).to.not.contain(databaseName);
    });
});
