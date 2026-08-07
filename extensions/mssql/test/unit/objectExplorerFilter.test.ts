/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";

import {
    ObjectExplorerFilter,
    ObjectExplorerFilterWebviewController,
} from "../../src/objectExplorer/objectExplorerFilter";
import { ObjectExplorerFilterStore } from "../../src/objectExplorer/objectExplorerFilterStore";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { stubTelemetry } from "./utils";
import { previewService } from "../../src/previews/previewService";

chai.use(sinonChai);

suite("ObjectExplorerFilter tests", () => {
    let sandbox: sinon.SinonSandbox;
    let extensionContext: vscode.ExtensionContext;
    let getPresetsStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        sandbox.stub(previewService, "isFeatureEnabled").returns(false);
        getPresetsStub = sandbox
            .stub(ObjectExplorerFilterStore.prototype, "getPresets")
            .resolves([]);
        extensionContext = {
            extensionUri: vscode.Uri.file("/tmp/test"),
            extensionPath: "/tmp/test",
            globalState: {
                get: sandbox.stub().returns([]),
                update: sandbox.stub().resolves(),
            },
        } as unknown as vscode.ExtensionContext;

        // Reset the static controller between tests
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ObjectExplorerFilter as any)._filterWebviewController = undefined;
    });

    teardown(() => {
        sandbox.restore();
    });

    function createTreeNode(
        overrides?: Partial<
            Pick<TreeNodeInfo, "filterableProperties" | "filters" | "nodePath" | "nodeType">
        >,
    ): TreeNodeInfo {
        return {
            filterableProperties: [],
            filters: [],
            nodePath: "server/db/Tables",
            nodeType: "Table",
            ...overrides,
        } as unknown as TreeNodeInfo;
    }

    function createControllerStub(): {
        stub: ObjectExplorerFilterWebviewController;
        submitEmitter: vscode.EventEmitter<import("vscode-mssql").NodeFilter[]>;
        cancelEmitter: vscode.EventEmitter<void>;
        disposeEmitter: vscode.EventEmitter<void>;
    } {
        const submitEmitter = new vscode.EventEmitter<import("vscode-mssql").NodeFilter[]>();
        const cancelEmitter = new vscode.EventEmitter<void>();
        const disposeEmitter = new vscode.EventEmitter<void>();

        const stub = {
            whenWebviewReady: sandbox.stub().resolves(),
            revealToForeground: sandbox.stub(),
            loadData: sandbox.stub(),
            isDisposed: false,
            onSubmit: submitEmitter.event,
            onCancel: cancelEmitter.event,
            onDisposed: disposeEmitter.event,
        } as unknown as ObjectExplorerFilterWebviewController;

        return { stub, submitEmitter, cancelEmitter, disposeEmitter };
    }

    /**
     * Injects a stub controller into the static field so that getFilters()
     * takes the reuse (loadData) path instead of constructing a real webview.
     */
    function injectController(stub: ObjectExplorerFilterWebviewController): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ObjectExplorerFilter as any)._filterWebviewController = stub;
    }

    test("should wait for webview ready before revealing", async () => {
        const { stub, submitEmitter } = createControllerStub();
        injectController(stub);

        const treeNode = createTreeNode();
        const filtersPromise = ObjectExplorerFilter.getFilters(extensionContext, treeNode);

        await new Promise((r) => setTimeout(r, 0));

        expect(stub.whenWebviewReady).to.have.been.calledOnce;
        expect(stub.revealToForeground).to.have.been.calledOnce;

        // Verify ordering: whenWebviewReady was called before revealToForeground
        expect(stub.whenWebviewReady).to.have.been.calledBefore(
            stub.revealToForeground as sinon.SinonStub,
        );

        submitEmitter.fire([]);
        await filtersPromise;
    });

    test("should call loadData when reusing existing controller", async () => {
        const { stub, submitEmitter } = createControllerStub();
        injectController(stub);

        const treeNode = createTreeNode({
            nodePath: "server/db/Views",
        });
        const filtersPromise = ObjectExplorerFilter.getFilters(extensionContext, treeNode);

        await new Promise((r) => setTimeout(r, 0));

        expect(stub.loadData).to.have.been.calledWithMatch({
            nodePath: "server/db/Views",
            isPreviewEnabled: false,
            filterPresets: [],
        });

        submitEmitter.fire([]);
        await filtersPromise;
    });

    test("loads reusable filters only when the preview is enabled", async () => {
        (previewService.isFeatureEnabled as sinon.SinonStub).returns(true);
        getPresetsStub.resolves([
            {
                id: "saved-filter",
                name: "Customer tables",
                filters: [{ name: "Name", operator: 8, value: "customer" }],
                isPinned: true,
                lastUsed: 1,
            },
        ]);
        const { stub, submitEmitter } = createControllerStub();
        injectController(stub);

        const filtersPromise = ObjectExplorerFilter.getFilters(extensionContext, createTreeNode());
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(getPresetsStub).to.have.been.called;
        expect(stub.loadData).to.have.been.calledWithMatch({
            isPreviewEnabled: true,
            filterPresets: sinon.match(
                (presets: unknown) =>
                    Array.isArray(presets) &&
                    presets[0]?.id === "saved-filter" &&
                    presets[0]?.isPinned === true,
            ),
        });

        submitEmitter.fire([]);
        await filtersPromise;
    });

    test("should return submitted filters on submit", async () => {
        const { stub, submitEmitter } = createControllerStub();
        injectController(stub);

        const treeNode = createTreeNode();
        const filtersPromise = ObjectExplorerFilter.getFilters(extensionContext, treeNode);

        await new Promise((r) => setTimeout(r, 0));

        const expectedFilters = [
            { name: "Schema", operator: 0, value: "dbo" },
        ] as import("vscode-mssql").NodeFilter[];
        submitEmitter.fire(expectedFilters);

        const result = await filtersPromise;
        expect(result).to.deep.equal(expectedFilters);
    });

    test("should return undefined on cancel", async () => {
        const { stub, cancelEmitter } = createControllerStub();
        injectController(stub);

        const treeNode = createTreeNode();
        const filtersPromise = ObjectExplorerFilter.getFilters(extensionContext, treeNode);

        await new Promise((r) => setTimeout(r, 0));
        cancelEmitter.fire();

        const result = await filtersPromise;
        expect(result).to.be.undefined;
    });

    test("should return undefined on dispose", async () => {
        const { stub, disposeEmitter } = createControllerStub();
        injectController(stub);

        const treeNode = createTreeNode();
        const filtersPromise = ObjectExplorerFilter.getFilters(extensionContext, treeNode);

        await new Promise((r) => setTimeout(r, 0));
        disposeEmitter.fire();

        const result = await filtersPromise;
        expect(result).to.be.undefined;
    });
});
