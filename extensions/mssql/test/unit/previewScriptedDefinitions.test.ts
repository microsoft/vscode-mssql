/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ObjectDefinitionRequest } from "@vscode-mssql/tsql-language-service";
import { expect } from "chai";
import {
    ScriptOperation,
    type IScriptingParams,
} from "../../src/models/contracts/scripting/scriptingRequest";
import {
    createStatementOffset,
    ScriptingObjectDefinitionProvider,
    scriptingTypeOf,
    type ScriptObjectRunner,
} from "../../src/languageservice/preview/previewScriptedDefinitions";
import {
    definitionUri,
    positionOfOffset,
} from "../../src/languageservice/preview/previewLanguageService";

const request: ObjectDefinitionRequest = {
    connectionId: "file:///editor.sql",
    schema: "dbo",
    name: "Customers",
    kind: "table",
};

/** Records what the scripting service was asked for, and answers with fixed text. */
function runner(script: string | Error = "CREATE TABLE [dbo].[Customers] (...)") {
    const calls: {
        params: IScriptingParams;
        options?: { quiet?: boolean; token?: { isCancellationRequested: boolean } };
    }[] = [];
    const service: ScriptObjectRunner = {
        createScriptingRequestParams: ((_serverInfo, scriptingObject, uri, operation) =>
            ({
                scriptingObjects: [scriptingObject],
                ownerURI: uri,
                operation,
            }) as unknown as IScriptingParams) as ScriptObjectRunner["createScriptingRequestParams"],
        script: (async (params, options) => {
            calls.push({ params, options });
            if (script instanceof Error) throw script;
            return script;
        }) as ScriptObjectRunner["script"],
    };
    return { calls, service };
}

suite("Preview scripted definitions", () => {
    test("maps catalog kinds onto the SMO types the service understands", () => {
        expect(scriptingTypeOf({ ...request, kind: "table" })).to.equal("Table");
        expect(scriptingTypeOf({ ...request, kind: "view" })).to.equal("View");
        expect(scriptingTypeOf({ ...request, kind: "procedure" })).to.equal("StoredProcedure");
        expect(scriptingTypeOf({ ...request, kind: "scalarFunction" })).to.equal(
            "UserDefinedFunction",
        );
        expect(scriptingTypeOf({ ...request, kind: "tableFunction" })).to.equal(
            "UserDefinedFunction",
        );
        expect(scriptingTypeOf({ ...request, kind: "synonym" })).to.equal("Synonym");
        expect(scriptingTypeOf({ ...request, kind: "type", typeCategory: "alias" })).to.equal(
            "UserDefinedDataType",
        );
        expect(scriptingTypeOf({ ...request, kind: "type", typeCategory: "table" })).to.equal(
            "UserDefinedTableType",
        );
        expect(scriptingTypeOf({ ...request, kind: "type", typeCategory: "clr" })).to.be.undefined;
        expect(scriptingTypeOf({ ...request, kind: "sequence" })).to.be.undefined;
    });

    test("scripts an object quietly, so navigation raises no progress notification", async () => {
        const { calls, service } = runner();
        const provider = new ScriptingObjectDefinitionProvider(service, () => undefined);

        const result = await provider.getDefinition(request);

        expect(result?.text).to.equal("CREATE TABLE [dbo].[Customers] (...)");
        expect(calls).to.have.lengthOf(1);
        expect(calls[0].options?.quiet).to.be.true;
        expect(calls[0].params.scriptingObjects[0]).to.deep.equal({
            type: "Table",
            schema: "dbo",
            name: "Customers",
        });
        expect(calls[0].params.operation).to.equal(ScriptOperation.Create);
        expect(calls[0].params.ownerURI).to.equal("file:///editor.sql");
    });

    test("names the owning database for a cross-database object", async () => {
        const { calls, service } = runner();
        const provider = new ScriptingObjectDefinitionProvider(service, () => undefined);

        await provider.getDefinition({ ...request, database: "archive", schema: "history" });

        expect(calls[0].params.scriptingObjects[0]).to.deep.equal({
            type: "Table",
            schema: "history",
            name: "Customers",
            databaseName: "archive",
        });
    });

    test("asks for nothing when the kind cannot be scripted", async () => {
        const { calls, service } = runner();
        const provider = new ScriptingObjectDefinitionProvider(service, () => undefined);
        expect(await provider.getDefinition({ ...request, kind: "sequence" })).to.be.undefined;
        expect(calls).to.be.empty;
    });

    test("a cancelled request never reaches the service", async () => {
        const { calls, service } = runner();
        const provider = new ScriptingObjectDefinitionProvider(service, () => undefined);
        const controller = new AbortController();
        controller.abort();

        expect(await provider.getDefinition(request, controller.signal)).to.be.undefined;
        expect(calls).to.be.empty;
    });

    test("cancelling in flight cancels the scripting operation", async () => {
        const { calls, service } = runner();
        const provider = new ScriptingObjectDefinitionProvider(service, () => undefined);
        const controller = new AbortController();

        const pending = provider.getDefinition(request, controller.signal);
        controller.abort();
        await pending;

        expect(calls[0].options?.token?.isCancellationRequested).to.be.true;
    });

    test("lands on the CREATE statement below the banner a module carries", () => {
        const text = "-- Author: someone\n-- Reviewed\nCREATE PROCEDURE dbo.p AS SELECT 1;";
        expect(createStatementOffset(text)).to.equal(text.indexOf("CREATE"));
        expect(createStatementOffset("CREATE TABLE t (a int);")).to.equal(0);
        expect(createStatementOffset("no definition here")).to.equal(0);
    });

    test("a generated document is addressed per connection and object", () => {
        const first = definitionUri("file:///a.sql", {
            schema: "dbo",
            name: "Customers",
            kind: "table",
        });
        const second = definitionUri("file:///b.sql", {
            schema: "dbo",
            name: "Customers",
            kind: "table",
        });
        const scoped = definitionUri("file:///a.sql", {
            database: "archive",
            schema: "dbo",
            name: "Customers",
            kind: "table",
        });
        const refreshed = definitionUri(
            "file:///a.sql",
            { schema: "dbo", name: "Customers", kind: "table" },
            2,
        );
        const differentKind = definitionUri("file:///a.sql", {
            schema: "dbo",
            name: "Customers",
            kind: "view",
        });

        expect(first.scheme).to.equal("mssql-definition");
        expect(first.path.endsWith(".sql")).to.be.true;
        expect(first.toString()).to.not.equal(second.toString());
        expect(first.toString()).to.not.equal(scoped.toString());
        expect(first.toString()).to.not.equal(refreshed.toString());
        expect(first.toString()).to.not.equal(differentKind.toString());
        expect(scoped.path).to.contain("archive");
        expect(refreshed.query).to.contain("generation=2");
    });

    test("an offset inside generated text becomes the line and character to reveal", () => {
        const text = "-- header\nCREATE PROCEDURE dbo.p\nAS SELECT 1;";
        const position = positionOfOffset(text, text.indexOf("CREATE"));
        expect(position.line).to.equal(1);
        expect(position.character).to.equal(0);
        expect(positionOfOffset(text, 0).line).to.equal(0);
        expect(positionOfOffset(text, 10_000).line).to.equal(2);
    });
});
