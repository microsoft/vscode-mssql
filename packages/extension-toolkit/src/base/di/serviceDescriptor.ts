/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Constructor } from "./serviceIdentifier";

export class ServiceDescriptor<T> {
    constructor(
        readonly ctor: Constructor<T>,
        readonly staticArguments: readonly unknown[] = [],
    ) {}
}
