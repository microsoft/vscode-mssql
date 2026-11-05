/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { QueryStudioController } from "../../src/queryStudio/queryStudioController";
import { QueryStudioDocumentModel } from "../../src/queryStudio/queryStudioDocumentModel";
import { stubTelemetry } from "./utils";

suite("Query Studio Vector session binding", () => {
    const sandbox = sinon.createSandbox();
    teardown(() => sandbox.restore());

    test("preserves Vector resources on metadata updates and invalidates them on connection changes", () => {
        stubTelemetry(sandbox);
        const changes = new vscode.EventEmitter<void>();
        let session:
            | {
                  connectionId: string;
                  info: { database: string; backendKind: string; version?: string };
              }
            | undefined = {
            connectionId: "first",
            info: { database: "db", backendKind: "sts" },
        };
        const model = sandbox.createStubInstance(QueryStudioDocumentModel);
        Object.defineProperty(model, "sessionBinding", {
            value: {
                onDidChange: changes.event,
                get activeSession() {
                    return session;
                },
            },
        });
        const controller = sandbox.createStubInstance(QueryStudioController);
        Object.defineProperty(controller, "model", { value: model });
        (controller["vectorContextKey"] as sinon.SinonStub).callsFake(() =>
            QueryStudioController.prototype["vectorContextKey"].call(controller),
        );
        const listener = QueryStudioController.prototype["listenToSessionBinding"].call(controller);
        const reset = controller["resetVectorServices"] as sinon.SinonStub;
        try {
            // Capability probes and pending/executing/idle transitions all emit
            // onDidChange without changing the identity of the active session.
            session.info.version = "17.0";
            changes.fire();
            changes.fire();
            expect(reset).not.to.have.been.called;
            expect(controller["queueStatePush"]).to.have.been.called;

            for (const next of [
                { connectionId: "first", info: { database: "other", backendKind: "sts" } },
                { connectionId: "second", info: { database: "other", backendKind: "sts" } },
                { connectionId: "second", info: { database: "other", backendKind: "tedious" } },
                undefined,
            ]) {
                reset.resetHistory();
                session = next;
                changes.fire();
                expect(reset).to.have.been.called;
                reset.resetHistory();
                changes.fire();
                expect(reset).not.to.have.been.called;
            }
        } finally {
            listener.dispose();
            changes.dispose();
        }
    });
});
