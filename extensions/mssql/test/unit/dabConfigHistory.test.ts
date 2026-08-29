/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Dab } from "../../src/sharedInterfaces/dab";
import {
    DabConfigHistory,
    DAB_CONFIG_HISTORY_MAX_ACTIONS,
    DAB_CONFIG_HISTORY_MAX_BYTES,
} from "../../src/webviews/pages/SchemaDesigner/dab/dabConfigHistory";

function createConfig(description?: string): Dab.DabConfig {
    return {
        apiTypes: [Dab.ApiType.Rest],
        entities: [
            {
                id: "entity-1",
                tableName: "Products",
                schemaName: "dbo",
                isEnabled: true,
                isSupported: true,
                enabledActions: [Dab.EntityAction.Read],
                columns: [],
                advancedSettings: {
                    entityName: "Products",
                    authorizationRole: Dab.AuthorizationRole.Anonymous,
                    ...(description === undefined ? {} : { description }),
                },
            },
        ],
    };
}

suite("DabConfigHistory", () => {
    test("undoes and redoes nested config changes", () => {
        const history = new DabConfigHistory();
        const initial = createConfig();
        const changed = createConfig("Product catalog");

        expect(history.push(initial, changed)).to.equal(true);
        expect(history.canUndo).to.equal(true);
        expect(history.undo(changed)).to.deep.equal(initial);
        expect(history.canRedo).to.equal(true);
        expect(history.redo(initial)).to.deep.equal(changed);
    });

    test("does not record unchanged configs", () => {
        const history = new DabConfigHistory();
        const config = createConfig();

        expect(history.push(config, config)).to.equal(false);
        expect(history.canUndo).to.equal(false);
    });

    test("clears redo entries when a new change is recorded", () => {
        const history = new DabConfigHistory();
        const initial = createConfig();
        const first = createConfig("First");
        const replacement = createConfig("Replacement");

        history.push(initial, first);
        const undone = history.undo(first)!;
        history.push(undone, replacement);

        expect(history.canRedo).to.equal(false);
        expect(history.undo(replacement)).to.deep.equal(initial);
    });

    test("keeps at most the established action limit", () => {
        const history = new DabConfigHistory();
        let current = createConfig("0");

        for (let index = 1; index <= DAB_CONFIG_HISTORY_MAX_ACTIONS + 5; index++) {
            const next = createConfig(index.toString());
            history.push(current, next);
            current = next;
        }

        let undoCount = 0;
        while (history.canUndo) {
            current = history.undo(current)!;
            undoCount++;
        }
        expect(undoCount).to.equal(DAB_CONFIG_HISTORY_MAX_ACTIONS);
    });

    test("does not retain an action that exceeds the memory limit", () => {
        const history = new DabConfigHistory();
        const initial = createConfig();
        const oversized = createConfig("x".repeat(DAB_CONFIG_HISTORY_MAX_BYTES / 2 + 1));

        expect(history.push(initial, oversized)).to.equal(true);
        expect(history.canUndo).to.equal(false);
    });
});
