/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import { StartViewNode, StartViewProvider } from "../../src/overview/startViewProvider";
import { IconUtils } from "../../src/utils/iconUtils";

const { expect } = chai;

suite("Start View Provider", () => {
    let provider: StartViewProvider;

    setup(() => {
        IconUtils.initialize(vscode.Uri.file("/extension"));
        provider = new StartViewProvider();
    });

    test("exposes the Overview, deployment and shortcuts entries, in that order", () => {
        const children = provider.getChildren();

        expect(children).to.have.lengthOf(3);
        expect(children.every((child) => child instanceof StartViewNode)).to.equal(true);
        expect(children.map((child) => child.command?.command)).to.deep.equal([
            Constants.cmdOpenOverview,
            Constants.cmdDeployNewDatabase,
            Constants.cmdOpenShortcutsConfiguration,
        ]);
    });

    test("every entry has a label and a description", () => {
        for (const child of provider.getChildren()) {
            expect(child.label, "label").to.be.a("string").and.not.empty;
            expect(child.description, "description").to.be.a("string").and.not.empty;
        }
    });

    test("entries are leaves with no children of their own", () => {
        const children = provider.getChildren();

        for (const child of children) {
            expect(child.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.None);
            expect(provider.getChildren(child)).to.be.empty;
        }
    });

    test("entries carry distinct context values for menu contributions", () => {
        const contextValues = provider.getChildren().map((child) => child.contextValue);

        expect(new Set(contextValues).size).to.equal(contextValues.length);
    });

    test("getTreeItem returns the node unchanged", () => {
        const [root] = provider.getChildren();

        expect(provider.getTreeItem(root)).to.equal(root);
    });

    test("entries are roots, so reveal stops there", () => {
        expect(provider.getParent()).to.equal(undefined);
    });
});
