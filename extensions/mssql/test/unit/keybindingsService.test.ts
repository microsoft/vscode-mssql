/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    parseKeybindingsText,
    updateKeybindingsText,
} from "../../src/keybindings/keybindingsService";

suite("Keybindings Service", () => {
    test("adds Quick Query keybindings to an empty file", () => {
        const updated = updateKeybindingsText("", [
            { command: "mssql.quickQueries.run1", key: "ctrl+alt+1" },
        ]);
        const rules = parseKeybindingsText(updated);

        expect(rules).to.deep.equal([
            {
                key: "ctrl+alt+1",
                command: "mssql.quickQueries.run1",
            },
        ]);
    });

    test("updates existing Quick Query keybindings and preserves unrelated rules", () => {
        const text = `[
    // Keep this unrelated binding.
    {
        "key": "ctrl+k",
        "command": "workbench.action.keep"
    },
    {
        "key": "ctrl+alt+1",
        "command": "mssql.quickQueries.run1",
        "when": "editorTextFocus"
    }
]`;

        const updated = updateKeybindingsText(text, [
            { command: "mssql.quickQueries.run1", key: "ctrl+alt+shift+1" },
        ]);
        const rules = parseKeybindingsText(updated);

        expect(rules).to.deep.equal([
            {
                key: "ctrl+k",
                command: "workbench.action.keep",
            },
            {
                key: "ctrl+alt+shift+1",
                command: "mssql.quickQueries.run1",
            },
        ]);
    });

    test("removes Quick Query keybindings when shortcut is cleared", () => {
        const text = `[
    {
        "key": "ctrl+alt+1",
        "command": "mssql.quickQueries.run1"
    },
    {
        "key": "ctrl+alt+2",
        "command": "mssql.quickQueries.run2"
    }
]`;

        const updated = updateKeybindingsText(text, [
            { command: "mssql.quickQueries.run1", key: "" },
        ]);
        const rules = parseKeybindingsText(updated);

        expect(rules).to.deep.equal([
            {
                key: "ctrl+alt+2",
                command: "mssql.quickQueries.run2",
            },
        ]);
    });

    test("throws when keybindings root is not an array", () => {
        expect(() => parseKeybindingsText("{}")).to.throw("root value must be an array");
    });
});
