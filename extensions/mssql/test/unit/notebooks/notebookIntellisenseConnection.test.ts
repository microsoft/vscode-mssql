/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as vscode from "vscode";
import { expect } from "chai";
import ConnectionManager from "../../../src/controllers/connectionManager";
import {
    ConnectionCompleteParams,
    ConnectionRequest,
    DisconnectRequest,
} from "../../../src/models/contracts/connection";
import { connectNotebookIntellisense } from "../../../src/notebooks/notebookIntellisenseConnection";

suite("NotebookIntellisenseConnection", () => {
    let sandbox: sinon.SinonSandbox;
    let manager: sinon.SinonStubbedInstance<ConnectionManager>;
    let cancellation: vscode.CancellationTokenSource;
    const uri = "mssql-python-notebook-sql:/test.sql";

    setup(() => {
        sandbox = sinon.createSandbox();
        manager = sandbox.createStubInstance(ConnectionManager);
        manager.sendRequest.resolves(true);
        cancellation = new vscode.CancellationTokenSource();
    });

    teardown(() => {
        cancellation.dispose();
        sandbox.restore();
    });

    test("waits for connection complete instead of accepting the acknowledgment", async () => {
        let complete!: (result: ConnectionCompleteParams) => void;
        manager.expectConnectionComplete.returns(
            new Promise((resolve) => {
                complete = resolve;
            }),
        );
        const pending = connectNotebookIntellisense(
            manager,
            uri,
            { options: {} },
            cancellation.token,
        );
        complete({ connectionId: "connected", ownerUri: uri } as ConnectionCompleteParams);
        expect((await pending)?.connectionId).to.equal("connected");
        expect(
            manager.sendRequest.calledWith(ConnectionRequest.type, sinon.match({ ownerUri: uri })),
        ).to.equal(true);
    });

    test("does not connect when already cancelled", async () => {
        cancellation.cancel();
        expect(
            await connectNotebookIntellisense(manager, uri, { options: {} }, cancellation.token),
        ).to.equal(undefined);
        expect(manager.sendRequest.called).to.equal(false);
    });

    test("disconnects a cancelled in-flight connection and removes its expectation", async () => {
        manager.expectConnectionComplete.returns(new Promise(() => undefined));
        const pending = connectNotebookIntellisense(
            manager,
            uri,
            { options: {} },
            cancellation.token,
        );
        cancellation.cancel();
        expect(await pending).to.equal(undefined);
        expect(manager.cancelConnectionCompleteExpectation.calledWith(uri)).to.equal(true);
        expect(manager.sendRequest.calledWith(DisconnectRequest.type, { ownerUri: uri })).to.equal(
            true,
        );
    });

    test("rejects a failed completion and allows caller retry", async () => {
        manager.expectConnectionComplete.resolves({
            ownerUri: uri,
            errorMessage: "synthetic",
        } as ConnectionCompleteParams);
        expect(
            await connectNotebookIntellisense(manager, uri, { options: {} }, cancellation.token),
        ).to.equal(undefined);
        expect(manager.sendRequest.calledWith(DisconnectRequest.type, { ownerUri: uri })).to.equal(
            true,
        );
    });

    test("times out and cleans up pending expectations", async () => {
        const clock = sandbox.useFakeTimers();
        manager.expectConnectionComplete.returns(new Promise(() => undefined));
        const pending = connectNotebookIntellisense(
            manager,
            uri,
            { options: {} },
            cancellation.token,
        );
        await clock.tickAsync(30_001);
        expect(await pending).to.equal(undefined);
        expect(manager.cancelConnectionCompleteExpectation.calledWith(uri)).to.equal(true);
    });
});
