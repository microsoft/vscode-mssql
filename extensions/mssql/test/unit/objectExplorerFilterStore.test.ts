/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import type * as vscodeMssql from "vscode-mssql";
import * as Constants from "../../src/constants/constants";
import { ObjectExplorerFilterStore } from "../../src/objectExplorer/objectExplorerFilterStore";
import {
    NodeFilterOperator,
    NodeFilterPropertyDataType,
} from "../../src/sharedInterfaces/objectExplorerFilter";
import {
    decryptData,
    type EncryptedData,
    encryptData,
    generateEncryptionKey,
} from "../../src/utils/encryptionUtils";

chai.use(sinonChai);

suite("ObjectExplorerFilterStore tests", () => {
    let sandbox: sinon.SinonSandbox;
    let context: vscode.ExtensionContext;
    let persistedFileContents: Uint8Array | undefined;
    let secretStorage: {
        get: sinon.SinonStub<[string], Promise<string | undefined>>;
        store: sinon.SinonStub<[string, string], Promise<void>>;
        delete: sinon.SinonStub<[string], Promise<void>>;
    };
    let secretValues: Map<string, string>;
    let store: ObjectExplorerFilterStore;
    let scopeId: string;
    let deleteFileStub: sinon.SinonStub;

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

    async function setPersistedPresets(presets: unknown[], version = 1): Promise<void> {
        const encryptionKey = generateEncryptionKey();
        secretValues.set(
            Constants.objectExplorerFilterEncryptionKeySecretStorageKey,
            encryptionKey,
        );
        persistedFileContents = new TextEncoder().encode(
            JSON.stringify(encryptData(JSON.stringify({ version, presets }), encryptionKey)),
        );
    }

    function getPersistedPayload(): { version: number; presets: unknown[] } {
        expect(persistedFileContents).not.to.be.undefined;
        const encryptionKey = secretValues.get(
            Constants.objectExplorerFilterEncryptionKeySecretStorageKey,
        );
        expect(encryptionKey).not.to.be.undefined;

        const encryptedData = JSON.parse(
            new TextDecoder().decode(persistedFileContents),
        ) as EncryptedData;
        return JSON.parse(decryptData(encryptedData, encryptionKey!)) as {
            version: number;
            presets: unknown[];
        };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        persistedFileContents = undefined;
        secretValues = new Map<string, string>();

        secretStorage = {
            get: sandbox
                .stub<[string], Promise<string | undefined>>()
                .callsFake(async (key) => secretValues.get(key)),
            store: sandbox.stub<[string, string], Promise<void>>().callsFake(async (key, value) => {
                secretValues.set(key, value);
            }),
            delete: sandbox.stub<[string], Promise<void>>().callsFake(async (key) => {
                secretValues.delete(key);
            }),
        };

        deleteFileStub = sandbox.stub().callsFake(async () => {
            persistedFileContents = undefined;
        });
        const workspaceFs = {
            stat: sandbox.stub().callsFake(async () => {
                if (!persistedFileContents) {
                    throw vscode.FileSystemError.FileNotFound();
                }
                return {} as vscode.FileStat;
            }),
            readFile: sandbox.stub().callsFake(async () => persistedFileContents!),
            createDirectory: sandbox.stub().resolves(),
            writeFile: sandbox.stub().callsFake(async (_uri: vscode.Uri, content: Uint8Array) => {
                persistedFileContents = content;
            }),
            delete: deleteFileStub,
        } as unknown as vscode.FileSystem;
        sandbox.stub(vscode.workspace, "fs").value(workspaceFs);

        context = {
            secrets: secretStorage as unknown as vscode.SecretStorage,
            globalStorageUri: vscode.Uri.file("/object-explorer-filter-tests"),
        } as unknown as vscode.ExtensionContext;
        store = new ObjectExplorerFilterStore(context);
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

    test("stores filters in encrypted global storage", async () => {
        await store.recordUsage(scopeId, [createFilter("customer")], "Customer tables");

        expect(secretStorage.store).to.have.been.calledWith(
            Constants.objectExplorerFilterEncryptionKeySecretStorageKey,
            sinon.match.string,
        );
        expect(new TextDecoder().decode(persistedFileContents)).not.to.contain("customer");

        const payload = getPersistedPayload();
        expect(payload.version).to.equal(1);
        expect(payload.presets).to.have.length(1);
        expect(payload.presets[0]).to.deep.include({
            name: "Customer tables",
            filters: [createFilter("customer")],
            isPinned: true,
        });
    });

    test("restores recent and saved filters in a new store", async () => {
        await store.recordUsage(scopeId, [createFilter("customer")]);
        await store.recordUsage(scopeId, [createFilter("orders")], "Order tables");

        const restoredPresets = await new ObjectExplorerFilterStore(context).getPresets(scopeId);

        expect(restoredPresets).to.have.length(2);
        expect(restoredPresets[0]).to.include({ name: "Order tables", isPinned: true });
        expect(restoredPresets[1]).to.include({ isPinned: false });
        expect(restoredPresets[1].filters).to.deep.equal([createFilter("customer")]);
    });

    test("deduplicates recent filters and upgrades a saved filter to pinned", async () => {
        const filters = [createFilter("customer")];
        await store.recordUsage(scopeId, filters);
        await store.recordUsage(scopeId, filters, "Customer tables");

        const presets = await store.getPresets(scopeId);
        expect(presets).to.have.length(1);
        expect(presets[0]).to.include({
            name: "Customer tables",
            isPinned: true,
        });
        expect(presets[0].filters).to.deep.equal(filters);
    });

    test("replaces a named filter without creating a duplicate", async () => {
        await store.recordUsage(scopeId, [createFilter("customer")], "My tables");
        const originalId = (await store.getPresets(scopeId))[0].id;
        await store.recordUsage(scopeId, [createFilter("orders")], "my tables");

        const presets = await store.getPresets(scopeId);
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

        const presets = await store.getPresets(scopeId);
        expect(presets).to.have.length(11);
        expect(presets[0]).to.include({ name: "Keep me", isPinned: true });
        expect(presets.filter((preset) => !preset.isPinned)).to.have.length(10);
        expect(presets.some((preset) => preset.filters[0].value === "recent-0")).to.be.false;
        expect(presets.some((preset) => preset.filters[0].value === "recent-11")).to.be.true;
    });

    test("keeps Saved filters in the order they were saved", async () => {
        await store.recordUsage(scopeId, [createFilter("first")], "First");
        await store.recordUsage(scopeId, [createFilter("second")], "Second");

        let presets = await store.getPresets(scopeId);
        expect(presets.map((preset) => preset.name)).to.deep.equal(["First", "Second"]);

        await store.recordUsage(scopeId, [createFilter("first")]);
        presets = await store.getPresets(scopeId);
        expect(presets.map((preset) => preset.name)).to.deep.equal(["First", "Second"]);
    });

    test("preserves persisted Saved order when a filter is used", async () => {
        await setPersistedPresets([
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
        ]);

        await store.recordUsage(scopeId, [createFilter("first")]);

        expect((await store.getPresets(scopeId)).map((preset) => preset.id)).to.deep.equal([
            "legacy-first",
            "legacy-second",
        ]);
    });

    test("renames and deletes a Saved filter", async () => {
        await store.recordUsage(scopeId, [createFilter("customer")]);
        const recentPreset = (await store.getPresets(scopeId))[0];
        await store.setPinned(scopeId, recentPreset.id, true);

        let presets = await store.renamePreset(scopeId, recentPreset.id, "Customer tables");
        expect(presets[0].name).to.equal("Customer tables");
        presets = await store.deletePreset(scopeId, presets[0].id);
        expect(presets).to.be.empty;
        expect(deleteFileStub).to.have.been.calledWith(
            vscode.Uri.joinPath(
                context.globalStorageUri,
                Constants.objectExplorerFilterGlobalStorageFileName,
            ),
            { useTrash: false },
        );
    });

    test("pins, unpins, and deletes only presets in the requested scope", async () => {
        await store.recordUsage(scopeId, [createFilter("customer")]);
        const presetId = (await store.getPresets(scopeId))[0].id;

        let presets = await store.setPinned(scopeId, presetId, true);
        expect(presets[0].isPinned).to.be.true;

        presets = await store.setPinned(scopeId, presetId, false);
        expect(presets[0].isPinned).to.be.false;

        presets = await store.deletePreset(scopeId, presetId);
        expect(presets).to.be.empty;
    });

    test("ignores invalid persisted data", async () => {
        await setPersistedPresets([{ id: "invalid" }, undefined, "not a preset"]);

        expect(await store.getPresets(scopeId)).to.be.empty;
    });

    test("ignores unsupported and corrupt persisted data", async () => {
        await setPersistedPresets([], 2);
        expect(await store.getPresets(scopeId)).to.be.empty;

        persistedFileContents = new TextEncoder().encode("not encrypted data");
        expect(await store.getPresets(scopeId)).to.be.empty;
    });
});
