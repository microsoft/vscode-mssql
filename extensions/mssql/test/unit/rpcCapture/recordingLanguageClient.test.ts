/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    DataCallback,
    Disposable,
    Emitter,
    Message,
    MessageReader,
    MessageWriter,
    PartialMessageInfo,
} from "vscode-jsonrpc/node";
import { RpcCaptureService } from "../../../src/languageservice/rpcCapture/rpcCaptureService";
import { createRecordingTransportsForTests } from "../../../src/languageservice/rpcCapture/recordingLanguageClient";

class FakeMessageReader implements MessageReader {
    private readonly _onError = new Emitter<Error>();
    private readonly _onClose = new Emitter<void>();
    private readonly _onPartialMessage = new Emitter<PartialMessageInfo>();
    private _callback: DataCallback | undefined;

    public get onError() {
        return this._onError.event;
    }

    public get onClose() {
        return this._onClose.event;
    }

    public get onPartialMessage() {
        return this._onPartialMessage.event;
    }

    public listen(callback: DataCallback): Disposable {
        this._callback = callback;
        return {
            dispose: () => {
                this._callback = undefined;
            },
        };
    }

    public fire(message: Message): void {
        this._callback?.(message);
    }

    public dispose(): void {
        this._callback = undefined;
        this._onError.dispose();
        this._onClose.dispose();
        this._onPartialMessage.dispose();
    }
}

class FakeMessageWriter implements MessageWriter {
    private readonly _onError = new Emitter<[Error, Message | undefined, number | undefined]>();
    private readonly _onClose = new Emitter<void>();
    public readonly messages: Message[] = [];

    public get onError() {
        return this._onError.event;
    }

    public get onClose() {
        return this._onClose.event;
    }

    public async write(message: Message): Promise<void> {
        this.messages.push(message);
    }

    public end(): void {}

    public dispose(): void {
        this._onError.dispose();
        this._onClose.dispose();
    }
}

suite("RecordingLanguageClient transports", () => {
    test("records outbound requests and inbound responses", async () => {
        const service = new RpcCaptureService({ bufferCapacity: 10 });
        const reader = new FakeMessageReader();
        const writer = new FakeMessageWriter();
        const transports = createRecordingTransportsForTests(
            "sqlToolsService",
            service,
            reader,
            writer,
        );

        transports.reader.listen(() => {});

        await transports.writer.write({
            jsonrpc: "2.0",
            id: "42",
            method: "workspace/executeCommand",
            params: {
                query: "select * from dbo.SecretTable",
            },
        } as Message);
        reader.fire({
            jsonrpc: "2.0",
            id: "42",
            result: {
                rows: [[1, "secret"]],
            },
        } as Message);

        const events = service.getState().events;
        expect(writer.messages).to.have.length(1);
        expect(events).to.have.length(2);
        expect(events[0].direction).to.equal("extensionToService");
        expect(events[0].kind).to.equal("request");
        expect(events[1].direction).to.equal("serviceToExtension");
        expect(events[1].kind).to.equal("response");
        expect(events[1].method).to.equal("workspace/executeCommand");
        expect(events[0].relatedEventId).to.equal(events[1].eventId);
        expect(JSON.stringify(events)).not.to.contain("SecretTable");
    });

    test("records notifications and error responses", async () => {
        const service = new RpcCaptureService({ bufferCapacity: 10 });
        const reader = new FakeMessageReader();
        const writer = new FakeMessageWriter();
        const transports = createRecordingTransportsForTests(
            "resourceProvider",
            service,
            reader,
            writer,
        );

        transports.reader.listen(() => {});

        await transports.writer.write({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: {
                    uri: "file:///c:/Users/person/query.sql",
                    text: "select secret from dbo.PrivateTable",
                },
            },
        } as Message);
        reader.fire({
            jsonrpc: "2.0",
            id: "error-only",
            error: {
                code: -32000,
                message: "Failed for person@contoso.com",
            },
        } as Message);

        const events = service.getState().events;
        expect(events).to.have.length(2);
        expect(events[0].kind).to.equal("notification");
        expect(events[0].channel).to.equal("resourceProvider");
        expect(events[1].kind).to.equal("response");
        expect(events[1].status).to.equal("failed");
        expect(JSON.stringify(events)).not.to.contain("person@contoso.com");
        expect(JSON.stringify(events)).not.to.contain("PrivateTable");
    });
});
