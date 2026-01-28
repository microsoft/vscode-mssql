/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as ff from "../models/contracts/flatFile";
import {
    ClientCapabilities,
    RequestType,
    RPCMessageType,
    ServerCapabilities,
} from "vscode-languageclient";
import * as UUID from "vscode-languageclient/lib/utils/uuid";
import { ApiType, managerInstance } from "./serviceApiManager";
import { SqlOpsDataClient, SqlOpsFeature } from "./clientInterfaces";

export class FlatFileFeature extends SqlOpsFeature<undefined> {
    private static readonly messagesTypes: RPCMessageType[] = [ff.ProseDiscoveryRequest.type];

    constructor(_sqlOpsDataClient: SqlOpsDataClient) {
        super(_sqlOpsDataClient, FlatFileFeature.messagesTypes);
    }

    public fillClientCapabilities(_capabilities: ClientCapabilities): void {}

    public initialize(_capabilities: ServerCapabilities): void {
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: undefined,
        });
    }

    protected registerProvider(_options: undefined): vscode.Disposable {
        const client = this._client;

        let requestSender = (requestType: RequestType<any, any, void, void>, params: any) => {
            return client.sendRequest(requestType, params).then(
                (r) => {
                    return r as any;
                },
                (e) => {
                    client.logFailedRequest(requestType, e);
                    return Promise.reject(e);
                },
            );
        };

        let sendProseDiscoveryRequest = (
            params: ff.ProseDiscoveryParams,
        ): Thenable<ff.ProseDiscoveryResponse> => {
            return requestSender(ff.ProseDiscoveryRequest.type, params);
        };

        let sendGetColumnInfoRequest = (
            params: ff.GetColumnInfoParams,
        ): Thenable<ff.GetColumnInfoResponse> => {
            return requestSender(ff.GetColumnInfoRequest.type, params);
        };

        let sendChangeColumnSettingsRequest = (
            params: ff.ChangeColumnSettingsParams,
        ): Thenable<ff.ChangeColumnSettingsResponse> => {
            return requestSender(ff.ChangeColumnSettingsRequest.type, params);
        };

        let sendInsertDataRequest = (
            params: ff.InsertDataParams,
        ): Thenable<ff.InsertDataResponse> => {
            return requestSender(ff.InsertDataRequest.type, params);
        };

        return managerInstance.registerApi<ff.FlatFileProvider>(ApiType.FlatFileProvider, {
            providerId: client.providerId,
            sendProseDiscoveryRequest: sendProseDiscoveryRequest,
            sendChangeColumnSettingsRequest,
            sendGetColumnInfoRequest,
            sendInsertDataRequest,
        });
    }
}
