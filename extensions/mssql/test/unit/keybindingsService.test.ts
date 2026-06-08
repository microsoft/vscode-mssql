/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import {
    parseKeybindingsText,
    updateKeybindingsText,
} from "../../src/keybindings/keybindingsService";

suite("Keybindings Service", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

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
                when: "editorTextFocus",
            },
        ]);
    });

    test("removes duplicate Quick Query keybindings when updating", () => {
        const text = `[
    {
        "key": "ctrl+alt+0",
        "command": "mssql.quickQueries.run1"
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
                key: "ctrl+alt+shift+1",
                command: "mssql.quickQueries.run1",
                when: "editorTextFocus",
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

    test("updates the current platform key when an existing rule uses platform-specific keys", () => {
        sandbox.stub(process, "platform").value("darwin");
        const text = `[
    {
        "key": "ctrl+alt+1",
        "mac": "cmd+alt+1",
        "win": "ctrl+alt+1",
        "linux": "ctrl+alt+1",
        "command": "mssql.quickQueries.run1"
    }
]`;

        const updated = updateKeybindingsText(text, [
            { command: "mssql.quickQueries.run1", key: "cmd+alt+shift+1" },
        ]);
        const rules = parseKeybindingsText(updated);

        expect(rules).to.deep.equal([
            {
                key: "ctrl+alt+1",
                mac: "cmd+alt+shift+1",
                win: "ctrl+alt+1",
                linux: "ctrl+alt+1",
                command: "mssql.quickQueries.run1",
            },
        ]);
    });

    test("preserves platform-specific keys when updating a generic rule", () => {
        sandbox.stub(process, "platform").value("win32");
        const text = `[
    {
        "key": "ctrl+alt+1",
        "mac": "cmd+alt+1",
        "command": "mssql.quickQueries.run1"
    }
]`;

        const updated = updateKeybindingsText(text, [
            { command: "mssql.quickQueries.run1", key: "ctrl+alt+shift+1" },
        ]);
        const rules = parseKeybindingsText(updated);

        expect(rules).to.deep.equal([
            {
                key: "ctrl+alt+shift+1",
                mac: "cmd+alt+1",
                command: "mssql.quickQueries.run1",
            },
        ]);
    });
});
