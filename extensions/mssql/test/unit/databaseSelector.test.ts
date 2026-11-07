/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as sinon from "sinon";
import { DatabaseSelector } from "../../src/webviews/common/databaseSelector";
import { locConstants } from "../../src/webviews/common/locConstants";

suite("Shared database selector", () => {
    let sandbox: sinon.SinonSandbox;
    let props: ComponentProps<typeof DatabaseSelector>;

    setup(() => {
        sandbox = sinon.createSandbox();
        props = {
            connections: [{ value: "connection-id", text: "Local SQL Server" }],
            selectedConnection: { value: "connection-id", text: "Local SQL Server" },
            databases: [{ value: "Inventory", displayName: "Inventory" }],
            selectedDatabase: "Inventory",
            isDatabaseListLoading: false,
            databaseListError: "",
            onConnectionSelected: sandbox.stub(),
            onDatabaseSelected: sandbox.stub(),
        };
    });

    teardown(() => sandbox.restore());

    const render = () => renderToStaticMarkup(createElement(DatabaseSelector, props));
    const databaseButton = (markup: string) =>
        markup.match(/<button\b[^>]*role="combobox"[^>]*>[\s\S]*?<\/button>/)?.[0];
    const connectionButton = (markup: string) =>
        markup.match(/<button\b[^>]*aria-label="Connection"[^>]*>[\s\S]*?<\/button>/)?.[0];

    test("shows the selected connection and database with selection enabled", () => {
        const markup = render();
        expect(markup).to.include("Local SQL Server");
        expect(markup).to.include("Inventory");
        expect(databaseButton(markup)).not.to.be.undefined;
        expect(databaseButton(markup)).not.to.include('disabled=""');
    });

    test("prompts to select a connection and database when neither is selected", () => {
        props.selectedConnection = { value: "", text: "" };
        props.selectedDatabase = "";
        const markup = render();
        expect(connectionButton(markup)).to.include(locConstants.schemaCompare.selectConnection);
        expect(databaseButton(markup)).to.include(locConstants.dacpacDialog.selectDatabase);
    });

    for (const failure of [false, true]) {
        test(`shows no connections found rather than stale selection when listing ${failure ? "fails" : "is empty"}`, () => {
            if (failure) {
                props.connectionListError = "Unable to read saved connections.";
            } else {
                props.connections = [];
            }
            const markup = render();
            expect(connectionButton(markup)).to.include(
                locConstants.schemaCompare.noConnectionsFound,
            );
            expect(connectionButton(markup)).to.include('disabled=""');
            expect(connectionButton(markup)).not.to.include("Local SQL Server");
            expect(databaseButton(markup)).to.include('disabled=""');
            expect(databaseButton(markup)).to.include(locConstants.dacpacDialog.selectDatabase);
        });
    }

    test("replaces both dropdowns and Refresh with a labeled spinner while loading connections", () => {
        props.isConnectionListLoading = true;
        props.connectionListLoadingMessage = locConstants.azureSqlDatabase.loadingLocalConnections;
        props.connectionAction = createElement("button", {}, "Refresh");
        const markup = render();
        expect(markup).to.include('role="progressbar"');
        expect(markup).to.include(locConstants.azureSqlDatabase.loadingLocalConnections);
        expect(markup).not.to.include('role="combobox"');
        expect(markup).not.to.include("Local SQL Server");
        expect(markup).not.to.include("Inventory");
        expect(markup).not.to.include(">Refresh<");
    });

    test("blocks database changes while loading and exposes loading status", () => {
        props.isDatabaseListLoading = true;
        props.selectedDatabase = "";
        props.databaseListError = "Previous listing failure.";
        const markup = render();
        expect(databaseButton(markup)).to.include('disabled=""');
        expect(databaseButton(markup)).to.include(locConstants.common.loadingWithEllipsis);
        expect(databaseButton(markup)).not.to.include(locConstants.schemaCompare.noDatabasesFound);
    });

    test("blocks database changes after a listing failure and exposes the error", () => {
        props.databaseListError = "Login failed for user sa.";
        const markup = render();
        expect(databaseButton(markup)).to.include('disabled=""');
        expect(databaseButton(markup)).to.include(locConstants.schemaCompare.noDatabasesFound);
        expect(databaseButton(markup)).not.to.include("Inventory");
        expect(markup).to.include('role="alert"');
        expect(markup).to.include(">Login failed for user sa.</div>");
        expect(markup.indexOf('role="alert"')).to.be.greaterThan(
            markup.indexOf(databaseButton(markup)!),
        );
    });

    test("shows no databases found after a listing failure without a selected database", () => {
        props.databases = [];
        props.selectedDatabase = "";
        props.databaseListError = "Database access denied.";
        const markup = render();
        expect(databaseButton(markup)).to.include(locConstants.schemaCompare.noDatabasesFound);
        expect(markup).to.include(">Database access denied.</div>");
    });

    test("blocks database changes when the server has no databases", () => {
        props.databases = [];
        props.selectedDatabase = "";
        expect(databaseButton(render())).to.include('disabled=""');
    });
});
