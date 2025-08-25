/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class VscodeApiSingleton {
    private static instance: VscodeApiSingleton;
    public vscodeApiInstance: unknown;

    public static getInstance(): VscodeApiSingleton {
        if (!VscodeApiSingleton.instance) {
            VscodeApiSingleton.instance = new VscodeApiSingleton();
        }
        return VscodeApiSingleton.instance;
    }

    constructor() {
        this.vscodeApiInstance = acquireVsCodeApi<unknown>();
    }
}
