/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { Logger } from "../models/logger";
import VscodeWrapper from "../controllers/vscodeWrapper";

import { QueryTool } from "./query/queryTool";
import { Tool } from "./tool";
import { IToolResultHandler, ToolResultNotification } from "../models/contracts/copilot";

export class ToolService implements IToolResultHandler {
    private _logger: Logger;
    // store both resolve and reject handlers for each pending response
    private _pending = new Map<
        string,
        { resolve: (value: any) => void; reject: (error: any) => void }
    >();

    constructor(
        private _client: SqlToolsServiceClient,
        private _vscodeWrapper: VscodeWrapper,
    ) {
        this._logger = Logger.create(this._vscodeWrapper.outputChannel, "ToolsService");
        this._client.onNotification(ToolResultNotification.type, this.onToolResult);
    }

    public waitForResult<T>(responseId: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this._pending.set(responseId, { resolve, reject });
        });
    }

    private onToolResult = <T>(payload: ToolResultNotification<T>) => {
        const entry = this._pending.get(payload.responseId);
        if (!entry) {
            return;
        }
        this._pending.delete(payload.responseId);
        if (payload.error) {
            entry.reject(new Error(payload.error));
        } else {
            entry.resolve(payload.result as T);
        }
    };

    public registerTools(context: vscode.ExtensionContext): void {
        this._logger.info("ToolsService: registerTools called");

        const tools: Tool<unknown>[] = [
            // sqltoolsservice implemented tools
            new QueryTool(this._client, this),
        ];

        tools.forEach((tool) => {
            this._logger.info(`Registering tool: ${tool.toolName}`);
            context.subscriptions.push(vscode.lm.registerTool(tool.toolName, tool));
        });
    }
}
