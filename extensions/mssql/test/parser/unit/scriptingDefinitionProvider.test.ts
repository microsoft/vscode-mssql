/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import type { IServerInfo } from "vscode-mssql";
import {
    ScriptOperation,
    type IScriptingParams,
} from "../../../src/models/contracts/scripting/scriptingRequest";
import {
    catalogObjectFromMultipart,
    ScriptingDefinitionProvider,
    type ScriptingDefinitionConnectionResolver,
    type ScriptingDefinitionObject,
    type ScriptingDefinitionScriptingApi,
    toScriptingObjectType,
} from "../../../src/languageservice/scriptingDefinitionProvider";

chai.use(sinonChai);

const ownerUri = vscode.Uri.parse("file:///definition-source.sql");
const serverInfo = { serverMajorVersion: 16, serverMinorVersion: 0 } as IServerInfo;
const orders: ScriptingDefinitionObject = {
    database: "SalesDb",
    schema: "sales",
    name: "Orders",
    kind: "table",
};

suite("ScriptingDefinitionProvider", () => {
    let sandbox: sinon.SinonSandbox;
    let scripting: {
        createScriptingRequestParams: sinon.SinonStub;
        script: sinon.SinonStub;
    };
    let connections: ScriptingDefinitionConnectionResolver;
    let provider: ScriptingDefinitionProvider;

    setup(() => {
        sandbox = sinon.createSandbox();
        scripting = {
            createScriptingRequestParams: sandbox.stub().callsFake(
                (_serverInfo, scriptingObject, requestOwnerUri, operation) =>
                    ({
                        scriptingObjects: [scriptingObject],
                        ownerURI: requestOwnerUri,
                        operation,
                    }) as IScriptingParams,
            ),
            script: sandbox.stub(),
        };
        connections = {
            getConnectionInfo: sandbox.stub().returns({
                connectionId: "connection-1",
                serverInfo,
                credentials: { database: "SalesDb" },
            }),
        };
        provider = new ScriptingDefinitionProvider(
            connections,
            scripting as unknown as ScriptingDefinitionScriptingApi,
        );
    });

    teardown(() => {
        provider.dispose();
        sandbox.restore();
    });

    test("deduplicates concurrent Script As Create requests and exposes cached virtual content", async () => {
        const script = deferred<string>();
        scripting.script.returns(script.promise);

        const first = provider.resolveDefinition(ownerUri, orders, "catalog-7");
        const second = provider.resolveDefinition(ownerUri, orders, "catalog-7");

        expect(scripting.createScriptingRequestParams).to.have.been.calledOnce;
        expect(scripting.script).to.have.been.calledOnce;
        script.resolve("CREATE TABLE [sales].[Orders] (Id int);");

        const [firstLocation, secondLocation] = await Promise.all([first, second]);
        expect(firstLocation).to.be.instanceOf(vscode.Location);
        expect(secondLocation?.uri.toString()).to.equal(firstLocation?.uri.toString());
        expect(firstLocation?.uri.scheme).to.equal(ScriptingDefinitionProvider.scheme);
        expect(firstLocation?.range).to.deep.equal(new vscode.Range(0, 21, 0, 29));
        expect(await provider.provideTextDocumentContent(firstLocation!.uri)).to.equal(
            "CREATE TABLE [sales].[Orders] (Id int);",
        );
        expect(scripting.script).to.have.been.calledOnce;

        expect(scripting.createScriptingRequestParams).to.have.been.calledWithMatch(
            serverInfo,
            { type: "Table", schema: "sales", name: "Orders" },
            ownerUri.toString(),
            ScriptOperation.Create,
        );
    });

    test("scopes the cache by catalog revision and database", async () => {
        scripting.script.onCall(0).resolves("CREATE TABLE [sales].[Orders] (Id int);");
        scripting.script.onCall(1).resolves("CREATE TABLE [sales].[Orders] (Id bigint);");
        scripting.script.onCall(2).resolves("CREATE TABLE [sales].[Orders] (Id uniqueidentifier);");

        await provider.resolveDefinition(ownerUri, orders, "1");
        await provider.resolveDefinition(ownerUri, orders, "1");
        await provider.resolveDefinition(ownerUri, orders, "2");
        await provider.resolveDefinition(ownerUri, { ...orders, database: "ArchiveDb" }, "2");

        expect(scripting.script).to.have.been.calledThrice;
    });

    test("does not cache scripting failures and permits a later retry", async () => {
        scripting.script.onCall(0).rejects(new Error("object no longer exists"));
        scripting.script.onCall(1).resolves("CREATE VIEW [sales].[Orders] AS SELECT 1 AS Id;");

        expect(await provider.resolveDefinition(ownerUri, { ...orders, kind: "view" }, "1")).to.be
            .undefined;
        const retry = await provider.resolveDefinition(ownerUri, { ...orders, kind: "view" }, "1");

        expect(retry).to.be.instanceOf(vscode.Location);
        expect(scripting.script).to.have.been.calledTwice;
    });

    test("honors caller cancellation without cancelling a shared script request", async () => {
        const script = deferred<string>();
        const cancellation = new vscode.CancellationTokenSource();
        scripting.script.returns(script.promise);

        const pending = provider.resolveDefinition(ownerUri, orders, "1", cancellation.token);
        await Promise.resolve();
        cancellation.cancel();

        expect(await pending).to.be.undefined;
        expect(scripting.script).to.have.been.calledOnce;

        script.resolve("CREATE TABLE [sales].[Orders] (Id int);");
        const nonCancelled = await provider.resolveDefinition(ownerUri, orders, "1");
        expect(nonCancelled).to.be.instanceOf(vscode.Location);
        expect(scripting.script).to.have.been.calledOnce;
        cancellation.dispose();
    });

    test("suppresses stale results after a newer catalog revision starts loading", async () => {
        const oldScript = deferred<string>();
        const newScript = deferred<string>();
        scripting.script.onCall(0).returns(oldScript.promise);
        scripting.script.onCall(1).returns(newScript.promise);

        const oldDefinition = provider.resolveDefinition(ownerUri, orders, "old");
        const newDefinition = provider.resolveDefinition(ownerUri, orders, "new");
        newScript.resolve("CREATE TABLE [sales].[Orders] (Id bigint);");
        expect(await newDefinition).to.be.instanceOf(vscode.Location);

        oldScript.resolve("CREATE TABLE [sales].[Orders] (Id int);");
        expect(await oldDefinition).to.be.undefined;
    });

    test("maps supported catalog kinds and multipart identifiers independently of scripting", () => {
        expect(toScriptingObjectType("table")).to.equal("Table");
        expect(toScriptingObjectType("view")).to.equal("View");
        expect(toScriptingObjectType("storedProcedure")).to.equal("StoredProcedure");
        expect(toScriptingObjectType("scalarFunction")).to.equal("UserDefinedFunction");
        expect(toScriptingObjectType("tableValuedFunction")).to.equal("UserDefinedFunction");

        expect(
            catalogObjectFromMultipart(
                ["[Server]]One]", '"Sales""Db"', "[sales]", '"Order""Lines"'],
                "view",
            ),
        ).to.deep.equal({
            server: "Server]One",
            database: 'Sales"Db',
            schema: "sales",
            name: 'Order"Lines',
            kind: "view",
        });
        expect(catalogObjectFromMultipart(["dbo", "Orders"], "table")).to.deep.equal({
            schema: "dbo",
            name: "Orders",
            kind: "table",
        });
    });
});

function deferred<T>(): {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(reason: unknown): void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((accept, decline) => {
        resolve = accept;
        reject = decline;
    });
    return { promise, resolve, reject };
}
