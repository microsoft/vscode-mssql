/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as Utils from '../models/utils';

export class ExtensionWrapper {
    getActiveTextEditorUri(): string {
        return Utils.getActiveTextEditorUri();
    }
}

export class Logger {
    logDebug(message: string): void {
        Utils.logDebug(message);
    }
}
