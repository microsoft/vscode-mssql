/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    LanguageClient,
    LanguageClientOptions,
    MessageTransports,
    ServerOptions,
} from "vscode-languageclient/node";
import {
    DataCallback,
    Disposable,
    Message,
    MessageReader,
    MessageWriter,
} from "vscode-jsonrpc/node";
import { RpcCaptureChannel } from "../../sharedInterfaces/rpcInspector";
import { RpcCaptureService, rpcCaptureService } from "./rpcCaptureService";

class RecordingMessageReader implements MessageReader {
    public constructor(
        private readonly _inner: MessageReader,
        private readonly _channel: RpcCaptureChannel,
        private readonly _captureService: RpcCaptureService,
    ) {}

    public get onError() {
        return this._inner.onError;
    }

    public get onClose() {
        return this._inner.onClose;
    }

    public get onPartialMessage() {
        return this._inner.onPartialMessage;
    }

    public listen(callback: DataCallback): Disposable {
        return this._inner.listen((message: Message) => {
            this._captureService.recordMessage(this._channel, "serviceToExtension", message);
            callback(message);
        });
    }

    public dispose(): void {
        this._inner.dispose();
    }
}

class RecordingMessageWriter implements MessageWriter {
    public constructor(
        private readonly _inner: MessageWriter,
        private readonly _channel: RpcCaptureChannel,
        private readonly _captureService: RpcCaptureService,
    ) {}

    public get onError() {
        return this._inner.onError;
    }

    public get onClose() {
        return this._inner.onClose;
    }

    public write(message: Message): Promise<void> {
        this._captureService.recordMessage(this._channel, "extensionToService", message);
        return this._inner.write(message);
    }

    public end(): void {
        this._inner.end();
    }

    public dispose(): void {
        this._inner.dispose();
    }
}

export class RecordingLanguageClient extends LanguageClient {
    public constructor(
        name: string,
        serverOptions: ServerOptions,
        clientOptions: LanguageClientOptions,
        private readonly _channel: RpcCaptureChannel,
        private readonly _captureService: RpcCaptureService = rpcCaptureService,
    ) {
        super(name, serverOptions, clientOptions);
    }

    protected override async createMessageTransports(encoding: string): Promise<MessageTransports> {
        const transports = await super.createMessageTransports(encoding);
        return {
            ...transports,
            reader: new RecordingMessageReader(
                transports.reader,
                this._channel,
                this._captureService,
            ),
            writer: new RecordingMessageWriter(
                transports.writer,
                this._channel,
                this._captureService,
            ),
        };
    }
}

export function createRecordingTransportsForTests(
    channel: RpcCaptureChannel,
    captureService: RpcCaptureService,
    reader: MessageReader,
    writer: MessageWriter,
): MessageTransports {
    return {
        reader: new RecordingMessageReader(reader, channel, captureService),
        writer: new RecordingMessageWriter(writer, channel, captureService),
    };
}
