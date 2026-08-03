/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type * as vscodeMssql from "vscode-mssql";
import { ObjectExplorerFilterStore } from "../../src/objectExplorer/objectExplorerFilterStore";
import {
    NodeFilterOperator,
    NodeFilterPropertyDataType,
} from "../../src/sharedInterfaces/objectExplorerFilter";

suite("ObjectExplorerFilterStore tests", () => {
    let sandbox: sinon.SinonSandbox;
    let storedValue: unknown;
    let storage: vscode.Memento;
    let store: ObjectExplorerFilterStore;
    let scopeId: string;

    const nameProperty: vscodeMssql.NodeFilterProperty = {
        name: "Name",
        displayName: "Name",
        description: "Object name",
        type: NodeFilterPropertyDataType.String,
    };

    const createFilter = (value: string): vscodeMssql.NodeFilter => ({
        name: "Name",
        operator: NodeFilterOperator.Contains,
        value,
    });

    setup(() => {
        sandbox = sinon.createSandbox();
        storedValue = [];
        storage = {
            get: sandbox.stub().callsFake((_key: string, defaultValue: unknown) => {
                return storedValue ?? defaultValue;
            }),
            update: sandbox.stub().callsFake(async (_key: string, value: unknown) => {
                storedValue = value;
            }),
            keys: sandbox.stub().returns([]),
        } as unknown as vscode.Memento;
        store = new ObjectExplorerFilterStore(storage);
        scopeId = ObjectExplorerFilterStore.getScopeId("Folder", [nameProperty]);
        let currentTime = 1_000;
        sandbox.stub(Date, "now").callsFake(() => currentTime++);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("creates stable scope IDs from compatible property schemas", () => {
        const schemaProperty: vscodeMssql.NodeFilterProperty = {
            ...nameProperty,
            name: "Schema",
            displayName: "Localized schema",
        };

        const firstScope = ObjectExplorerFilterStore.getScopeId("Folder", [
            nameProperty,
            schemaProperty,
        ]);
        const reorderedScope = ObjectExplorerFilterStore.getScopeId("Folder", [
            { ...schemaProperty, displayName: "Schema translated another way" },
            { ...nameProperty, displayName: "Name translated another way" },
        ]);
        const otherNodeScope = ObjectExplorerFilterStore.getScopeId("Table", [
            nameProperty,
            schemaProperty,
        ]);

        expect(firstScope).to.equal(reorderedScope);
        expect(firstScope).not.to.equal(otherNodeScope);
    });

    test("deduplicates recent filters and upgrades a saved filter to pinned", async () => {
        const filters = [createFilter("customer")];
        await store.recordUsage(scopeId, filters);
        await store.recordUsage(scopeId, filters, "Customer tables");

        const presets = store.getPresets(scopeId);
        expect(presets).to.have.length(1);
        expect(presets[0]).to.include({
            name: "Customer tables",
            isPinned: true,
        });
        expect(presets[0].filters).to.deep.equal(filters);
    });

    test("replaces a named filter without creating a duplicate", async () => {
        await store.recordUsage(scopeId, [createFilter("customer")], "My tables");
        const originalId = store.getPresets(scopeId)[0].id;
        await store.recordUsage(scopeId, [createFilter("orders")], "my tables");

        const presets = store.getPresets(scopeId);
        expect(presets).to.have.length(1);
        expect(presets[0].id).to.equal(originalId);
        expect(presets[0].filters).to.deep.equal([createFilter("orders")]);
        expect(presets[0].isPinned).to.be.true;
    });

    test("bounds recent filters while retaining pinned filters", async () => {
        await store.recordUsage(scopeId, [createFilter("keep")], "Keep me");

        for (let index = 0; index < 12; index++) {
            await store.recordUsage(scopeId, [createFilter(`recent-${index}`)]);
        }

        const presets = store.getPresets(scopeId);
        expect(presets).to.have.length(11);
        expect(presets[0]).to.include({ name: "Keep me", isPinned: true });
        expect(presets.filter((preset) => !preset.isPinned)).to.have.length(10);
        expect(presets.some((preset) => preset.filters[0].value === "recent-0")).to.be.false;
        expect(presets.some((preset) => preset.filters[0].value === "recent-11")).to.be.true;
    });

    test("keeps Saved filters in the order they were saved", async () => {
        await store.recordUsage(scopeId, [createFilter("first")], "First");
        await store.recordUsage(scopeId, [createFilter("second")], "Second");

        let presets = store.getPresets(scopeId);
        expect(presets.map((preset) => preset.name)).to.deep.equal(["First", "Second"]);

        await store.recordUsage(scopeId, [createFilter("first")]);
        presets = store.getPresets(scopeId);
        expect(presets.map((preset) => preset.name)).to.deep.equal(["First", "Second"]);
    });

    test("preserves persisted Saved order when a filter is used", async () => {
        storedValue = [
            {
                id: "legacy-first",
                scopeId,
                name: "Legacy first",
                filters: [createFilter("first")],
                isPinned: true,
                lastUsed: 1,
            },
            {
                id: "legacy-second",
                scopeId,
                name: "Legacy second",
                filters: [createFilter("second")],
                isPinned: true,
                lastUsed: 2,
            },
        ];

        await store.recordUsage(scopeId, [createFilter("first")]);

        expect(store.getPresets(scopeId).map((preset) => preset.id)).to.deep.equal([
            "legacy-first",
            "legacy-second",
        ]);
    });

    test("renames and deletes a Saved filter", async () => {
        await store.recordUsage(scopeId, [createFilter("customer")]);
        const recentPreset = store.getPresets(scopeId)[0];
        await store.setPinned(scopeId, recentPreset.id, true);

        let presets = await store.renamePreset(scopeId, recentPreset.id, "Customer tables");
        expect(presets[0].name).to.equal("Customer tables");
        presets = await store.deletePreset(scopeId, presets[0].id);
        expect(presets).to.be.empty;
    });

    test("pins, unpins, and deletes only presets in the requested scope", async () => {
        await store.recordUsage(scopeId, [createFilter("customer")]);
        const presetId = store.getPresets(scopeId)[0].id;

        let presets = await store.setPinned(scopeId, presetId, true);
        expect(presets[0].isPinned).to.be.true;

        presets = await store.setPinned(scopeId, presetId, false);
        expect(presets[0].isPinned).to.be.false;

        presets = await store.deletePreset(scopeId, presetId);
        expect(presets).to.be.empty;
    });

    test("ignores invalid persisted data", () => {
        storedValue = [{ id: "invalid" }, undefined, "not a preset"];

        expect(store.getPresets(scopeId)).to.be.empty;
    });
});
