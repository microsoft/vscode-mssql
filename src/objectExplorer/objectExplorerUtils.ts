/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';

export class ObjectExplorerUtils {

    public static readonly rootPath: string = path.join(__dirname, 'objectTypes');

    public static iconPath(label: string): string {
        if (label) {
            return path.join(ObjectExplorerUtils.rootPath, `${label}.svg`);
        }
    }
}
