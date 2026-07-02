/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from "./lifecycle";

export interface Event<T> {
    (
        listener: (e: T) => unknown,
        thisArgs?: unknown,
        disposables?: IDisposable[] | { add(disposable: IDisposable): unknown },
    ): IDisposable;
}
