/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from "./descriptors";
import * as insta from "./instantiation";
import { ServiceIdentifier, createDecorator } from "./instantiation";
import { InstantiationService } from "./instantiationService";
import { ServiceCollection } from "./serviceCollection";
export { ServiceIdentifier, createDecorator as createServiceIdentifier };

export interface IInstantiationServiceBuilder {
    define<T>(
        id: insta.ServiceIdentifier<T>,
        instance: (T & insta.BrandedService) | SyncDescriptor<T>,
    ): void;

    seal(): insta.IInstantiationService;
}

export class InstantiationServiceBuilder implements IInstantiationServiceBuilder {
    private _isSealed: boolean = false;
    private readonly _collection: ServiceCollection;

    constructor(entries?: ServiceCollection | [insta.ServiceIdentifier<unknown>, unknown][]) {
        this._collection = Array.isArray(entries)
            ? new ServiceCollection(...entries)
            : (entries ?? new ServiceCollection());
    }

    define<T>(
        id: insta.ServiceIdentifier<T>,
        instance: (T & insta.BrandedService) | SyncDescriptor<T>,
    ): void {
        if (this._isSealed) {
            throw new Error("This accessor is sealed and cannot be modified anymore.");
        }
        this._collection.set(id, instance);
    }

    seal(): insta.IInstantiationService {
        if (this._isSealed) {
            throw new Error("This accessor is sealed and cannot be sealed again.");
        }
        this._isSealed = true;
        return new InstantiationService(this._collection, true);
    }
}
