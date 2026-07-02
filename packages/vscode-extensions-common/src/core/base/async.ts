/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class GlobalIdleValue<T> {
    private _didRun: boolean = false;
    private _value?: T;

    constructor(private readonly _executor: () => T) {}

    get isInitialized(): boolean {
        return this._didRun;
    }

    get value(): T {
        if (!this._didRun) {
            this._didRun = true;
            this._value = this._executor();
        }

        return this._value as T;
    }
}
