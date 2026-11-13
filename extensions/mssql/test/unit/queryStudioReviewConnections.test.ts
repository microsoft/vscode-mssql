/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as provider from "../../src/queryStudio/queryStudioEditorProvider";
import { QueryStudioDocumentModel } from "../../src/queryStudio/queryStudioDocumentModel";
import { DocumentSessionBinding } from "../../src/queryStudio/documentSessionBinding";
import { QueryStudioCompletionMetadataResolver } from "../../src/queryStudio/queryStudioCompletionMetadataResolver";
import { DatabaseCatalogLease } from "../../src/services/metadata/metadataStore";
import { CatalogBuilder } from "../../src/services/metadata/catalogModel";
import * as authAdapter from "../../src/services/metadata/profileAuthAdapter";
import { QueryStudioCore } from "../../src/constants/locConstants";

suite("Query Studio reviewed connection behavior", () => {
    const sandbox = sinon.createSandbox();
    teardown(() => sandbox.restore());

    test("completion identity uses canonical catalog identity, independent of ambiguous display labels", async () => {
        const binding = sandbox.createStubInstance(DocumentSessionBinding);
        const model = sandbox.createStubInstance(QueryStudioDocumentModel);
        Object.defineProperty(model, "sessionBinding", { value: binding });
        sandbox.stub(provider, "findQueryStudioModel").returns(model);
        const state = {
            kind: "connected",
            serverDisplayName: "server",
            database: "a|b",
            loginName: "c",
        };
        sandbox.stub(binding, "connectionState").get(() => state);
        let key = { serverFingerprint: "profile-a", database: "a|b" };
        const snapshot = new CatalogBuilder().build(1, {}, "full");
        sandbox
            .stub(binding, "metadataHandleForConsumers")
            .get(() => ({ key, current: () => snapshot }) as DatabaseCatalogLease);
        const resolver = new QueryStudioCompletionMetadataResolver();
        const document = { uri: vscode.Uri.parse("untitled:review.mssql") } as vscode.TextDocument;
        const first = await resolver.resolve(document);
        key = { serverFingerprint: "profile-b", database: "a" };
        state.database = "a";
        state.loginName = "b|c";
        const second = await resolver.resolve(document);
        expect(first?.generation).to.equal(second?.generation);
        expect(first?.fingerprint).not.to.equal(second?.fingerprint);
        state.serverDisplayName = "renamed label";
        expect((await resolver.resolve(document))?.fingerprint).to.equal(second?.fingerprint);
    });

    for (const action of ["retry", "openInClassicEditor"] as const) {
        test(`connection error honors a translated ${action} action`, async () => {
            const binding = new DocumentSessionBinding();
            const prepare = sandbox
                .stub(authAdapter, "prepareConnection")
                .throws(new Error("test failure"));
            sandbox.stub(QueryStudioCore, action).value("Translated action");
            const dialog = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
            dialog.onFirstCall().resolves("Translated action" as never);
            const execute = sandbox.stub(vscode.commands, "executeCommand").resolves(undefined);
            try {
                await binding["open"](
                    { server: "test" },
                    {
                        readAllConnections: async () => [],
                        lookupPassword: async () => "",
                    },
                );
                if (action === "retry") {
                    sinon.assert.calledTwice(prepare);
                } else {
                    sinon.assert.calledWith(execute, "mssql.queryStudio.openInClassicEditor");
                }
            } finally {
                binding.dispose();
            }
        });
    }
});
