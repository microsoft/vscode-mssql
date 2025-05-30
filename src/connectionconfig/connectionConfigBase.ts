/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import VscodeWrapper from "../controllers/vscodeWrapper";
import { Logger } from "../models/logger";
import { Deferred } from "../protocol";
import * as Constants from "../constants/constants";

export abstract class ConnectionConfigBase {
    protected _logger: Logger;
    public initialized: Deferred<void> = new Deferred<void>();

    constructor(
        loggerPrefix: string,
        protected _vscodeWrapper?: VscodeWrapper,
    ) {
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }
        this._logger = Logger.create(this._vscodeWrapper.outputChannel, loggerPrefix);

        // void this.assignMissingIds();
    }

    // protected abstract assignMissingIds(): Promise<void>;

    protected getArrayFromSettings<T>(configSection: string, global: boolean = true): T[] {
        let configuration = this._vscodeWrapper.getConfiguration(
            Constants.extensionName,
            this._vscodeWrapper.activeTextEditorUri,
        );

        let configValue = configuration.inspect<T[]>(configSection);
        if (global) {
            // only return the global values if that's what's requested
            return configValue.globalValue || [];
        } else {
            // otherwise, return the combination of the workspace and workspace folder values
            return (configValue.workspaceValue || []).concat(
                configValue.workspaceFolderValue || [],
            );
        }
    }
}
