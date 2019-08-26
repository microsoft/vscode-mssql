/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
export class ObjectExplorerUtils {

    public static readonly rootPath: string = __dirname + '\\objectTypes\\';

    public static iconPath(label: string): string {
        if (label) {
            return ObjectExplorerUtils.rootPath + `${label}.svg`;
        }
    }
}
