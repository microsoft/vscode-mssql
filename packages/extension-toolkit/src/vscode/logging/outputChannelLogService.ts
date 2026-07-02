/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ILogService } from "../../base";
import { IExtensionContextService } from "../context/extensionContextService";

export class OutputChannelLogService implements ILogService {
    declare readonly _serviceBrand: undefined;

    private readonly _outputChannel: vscode.LogOutputChannel;

    constructor(
        @IExtensionContextService private readonly _contextService: IExtensionContextService,
    ) {
        const extension = this._contextService.context.extension;
        const packageJson = extension.packageJSON as { displayName?: string };
        const channelName = packageJson.displayName ?? extension.id;

        this._outputChannel = vscode.window.createOutputChannel(channelName, { log: true });
        this._contextService.context.subscriptions.push(this._outputChannel);
    }

    trace(message: string): void {
        this._outputChannel.trace(message);
    }

    debug(message: string): void {
        this._outputChannel.debug(message);
    }

    info(message: string): void {
        this._outputChannel.info(message);
    }

    warn(message: string): void {
        this._outputChannel.warn(message);
    }

    error(message: string, error?: unknown): void {
        this._outputChannel.error(error ? `${message}: ${String(error)}` : message);
    }
}
