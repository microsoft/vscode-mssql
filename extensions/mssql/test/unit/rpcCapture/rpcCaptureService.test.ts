/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { RpcCaptureService } from "../../../src/languageservice/rpcCapture/rpcCaptureService";

suite("RpcCaptureService", () => {
    test("captures and correlates requests and responses with sanitized payloads", () => {
        const service = new RpcCaptureService({ bufferCapacity: 10 });

        service.recordMessage("sqlToolsService", "extensionToService", {
            jsonrpc: "2.0",
            id: 1,
            method: "connection/connect",
            params: {
                ownerUri: "file:///c:/Users/person/private.sql",
                connection: {
                    server: "prod-sql.contoso.com",
                    database: "CustomerDb",
                    password: "secret",
                },
            },
        });
        service.recordMessage("sqlToolsService", "serviceToExtension", {
            jsonrpc: "2.0",
            id: 1,
            result: {
                ownerUri: "file:///c:/Users/person/private.sql",
                connected: true,
            },
        });

        const events = service.getState().events;
        expect(events).to.have.length(2);
        expect(events[0].kind).to.equal("request");
        expect(events[0].status).to.equal("succeeded");
        expect(events[0].relatedEventId).to.equal(events[1].eventId);
        expect(events[1].kind).to.equal("response");
        expect(events[1].method).to.equal("connection/connect");
        expect(events[1].relatedEventId).to.equal(events[0].eventId);
        expect(events[1].durationMs).to.be.at.least(0);

        const serialized = JSON.stringify(events);
        expect(serialized).not.to.contain("prod-sql");
        expect(serialized).not.to.contain("CustomerDb");
        expect(serialized).not.to.contain('"password":"secret"');
        expect(serialized).to.contain("<server:1>");
        expect(serialized).to.contain("<database:1>");
        expect(serialized).to.contain("<ownerUri:1>");
    });

    test("captures notifications, error responses, filters, and visible exports", () => {
        const service = new RpcCaptureService({ bufferCapacity: 10 });

        service.recordMessage("sqlToolsService", "extensionToService", {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: {
                    uri: "file:///c:/Users/person/query.sql",
                    text: "select secret from dbo.PrivateTable",
                },
            },
        });
        service.recordMessage("resourceProvider", "serviceToExtension", {
            jsonrpc: "2.0",
            id: "missing",
            error: {
                code: -1,
                message: "Failure for person@contoso.com on prod-sql.contoso.com",
            },
        });

        let state = service.setFilter({ method: "textDocument" });
        expect(state.events).to.have.length(1);
        expect(state.events[0].kind).to.equal("notification");
        expect(JSON.stringify(state.events[0])).not.to.contain("secret");

        state = service.setFilter({ statuses: ["failed"] });
        expect(state.events).to.have.length(1);
        expect(state.events[0].status).to.equal("failed");
        expect(JSON.stringify(state.events[0])).not.to.contain("person@contoso.com");

        const captureExport = service.exportVisibleEvents();
        expect(captureExport.schemaVersion).to.equal(1);
        expect(captureExport.source).to.equal("visible");
        expect(captureExport.events).to.have.length(1);
        expect(captureExport.summary.failedCount).to.equal(1);
    });

    test("tracks sessions and caps session exports", () => {
        const service = new RpcCaptureService({ bufferCapacity: 10, sessionCapacity: 2 });
        const startedState = service.startSession("Focused capture");
        const sessionId = startedState.activeSessionId!;

        service.recordMessage("sqlToolsService", "extensionToService", {
            jsonrpc: "2.0",
            method: "one",
        });
        service.recordMessage("sqlToolsService", "extensionToService", {
            jsonrpc: "2.0",
            method: "two",
        });
        service.recordMessage("sqlToolsService", "extensionToService", {
            jsonrpc: "2.0",
            method: "three",
        });
        service.stopSession(sessionId);

        const captureExport = service.exportSession(sessionId)!;
        expect(captureExport.source).to.equal("session");
        expect(captureExport.session?.name).to.equal("Focused capture");
        expect(captureExport.session?.isActive).to.equal(false);
        expect(captureExport.session?.eventCount).to.equal(3);
        expect(captureExport.session?.droppedEventCount).to.equal(1);
        expect(captureExport.events.map((event) => event.method)).to.deep.equal(["two", "three"]);
    });

    test("enforces the live ring buffer cap", () => {
        const service = new RpcCaptureService({ bufferCapacity: 2 });

        service.recordMessage("sqlToolsService", "extensionToService", {
            jsonrpc: "2.0",
            method: "one",
        });
        service.recordMessage("sqlToolsService", "extensionToService", {
            jsonrpc: "2.0",
            method: "two",
        });
        service.recordMessage("sqlToolsService", "extensionToService", {
            jsonrpc: "2.0",
            method: "three",
        });

        const events = service.getState().events;
        expect(events).to.have.length(2);
        expect(events.map((event) => event.method)).to.deep.equal(["two", "three"]);
    });
});
