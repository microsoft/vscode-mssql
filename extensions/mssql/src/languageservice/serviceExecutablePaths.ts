/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import { Runtime } from "../models/platform";

/**
 * The service executables required for a SQL Tools Service installation to be considered runnable.
 */
export enum ServiceExecutable {
    MicrosoftSqlToolsServiceLayer = "MicrosoftSqlToolsServiceLayer",
    SqlToolsResourceProviderService = "SqlToolsResourceProviderService",
}

/**
 * Returns the expected service executable file name for a runtime.
 */
export function getServiceExecutableFileName(
    runtime: Runtime,
    filePrefix: ServiceExecutable,
): string {
    if (runtime === Runtime.Portable) {
        return `${filePrefix}.dll`;
    }

    if (runtime === Runtime.Windows_64 || runtime === Runtime.Windows_ARM64) {
        return `${filePrefix}.exe`;
    }

    return filePrefix;
}

/**
 * Returns the full path to a runtime-specific service executable in an install folder.
 */
export function getServiceExecutablePath(
    folderPath: string,
    runtime: Runtime,
    filePrefix: ServiceExecutable,
): string {
    return path.join(folderPath, getServiceExecutableFileName(runtime, filePrefix));
}
