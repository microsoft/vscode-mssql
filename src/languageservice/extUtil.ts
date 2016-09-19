/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as Utils from '../models/utils';

/*
* ExtensionWrapper class handles the functions which requires the vscode modules.
* Note: If the class is used from a gulp script, it cannot find the vs code module
*/
export class ExtensionWrapper {
    getActiveTextEditorUri(): string {
        return Utils.getActiveTextEditorUri();
    }
}

/*
* Logger class handles logging messages using the Util functions.
*/
export class Logger {
    logDebug(message: string): void {
        Utils.logDebug(message);
    }
}
