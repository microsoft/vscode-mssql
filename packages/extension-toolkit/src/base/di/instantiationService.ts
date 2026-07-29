/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//!!! DO NOT modify directly. This file contains stable DI primitives copied from microsoft/vscode.
// Source: https://github.com/microsoft/vscode/blob/1f01c15f70c50c8a6f6e9e17acca9d7cae9bbd5c/src/vs/platform/instantiation/common/instantiation.ts
// Reference: https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/util/vs/platform/instantiation/common/instantiation.ts
// Extension-specific behavior should live outside src/base/di.

import { isDisposable, type IDisposable } from "../lifecycle";
import { ServiceCollection } from "./serviceCollection";
import { ServiceDescriptor } from "./serviceDescriptor";
import {
    BrandedService,
    Constructor,
    createServiceIdentifier,
    getServiceDependencies,
    ServiceIdentifier,
} from "./serviceIdentifier";

export interface ServicesAccessor {
    get<T>(id: ServiceIdentifier<T>): T;
}

export const IInstantiationService =
    createServiceIdentifier<IInstantiationService>("instantiationService");

export interface IInstantiationService extends IDisposable, BrandedService {
    createInstance<T>(ctor: Constructor<T>, ...args: unknown[]): T;
    invokeFunction<R, TArgs extends readonly unknown[]>(
        fn: (accessor: ServicesAccessor, ...args: TArgs) => R,
        ...args: TArgs
    ): R;
}

export interface IInstantiationServiceBuilder {
    define<T>(
        id: ServiceIdentifier<T>,
        instance: (T & BrandedService) | ServiceDescriptor<T>,
    ): void;
    seal(): IInstantiationService;
}

export class InstantiationServiceBuilder implements IInstantiationServiceBuilder {
    private _isSealed = false;
    private readonly _collection: ServiceCollection;

    constructor(entries?: readonly [ServiceIdentifier<unknown>, unknown][]) {
        this._collection = new ServiceCollection(entries);
    }

    get serviceCollection(): ServiceCollection {
        if (this._isSealed) {
            throw new Error("This service builder has already been sealed.");
        }

        return this._collection;
    }

    define<T>(
        id: ServiceIdentifier<T>,
        instance: (T & BrandedService) | ServiceDescriptor<T>,
    ): void {
        if (this._isSealed) {
            throw new Error("This service builder has already been sealed.");
        }

        this._collection.set(id, instance);
    }

    seal(): IInstantiationService {
        if (this._isSealed) {
            throw new Error("This service builder has already been sealed.");
        }

        this._isSealed = true;
        return new InstantiationService(this._collection);
    }
}

export class InstantiationService implements IInstantiationService {
    declare readonly _serviceBrand: undefined;

    private readonly _activeInstantiations = new Set<ServiceIdentifier<unknown>>();
    private readonly _createdServices = new Set<unknown>();
    private _isDisposed = false;

    constructor(private readonly _services: ServiceCollection) {
        this._services.set(IInstantiationService, this);
    }

    createInstance<T>(ctor: Constructor<T>, ...args: unknown[]): T {
        this._throwIfDisposed();
        return this._createInstance(ctor, args);
    }

    invokeFunction<R, TArgs extends readonly unknown[]>(
        fn: (accessor: ServicesAccessor, ...args: TArgs) => R,
        ...args: TArgs
    ): R {
        this._throwIfDisposed();

        const accessor: ServicesAccessor = {
            get: <T>(id: ServiceIdentifier<T>) => this._getOrCreateService(id),
        };

        return fn(accessor, ...args);
    }

    dispose(): void {
        if (!this._isDisposed) {
            this._isDisposed = true;

            for (const service of this._createdServices) {
                if (isDisposable(service)) {
                    service.dispose();
                }
            }

            this._createdServices.clear();
        }
    }

    private _createInstance<T>(ctor: Constructor<T>, args: readonly unknown[]): T {
        const serviceDependencies = getServiceDependencies(ctor);
        const constructorArgs = [...args];

        for (const dependency of serviceDependencies) {
            constructorArgs[dependency.index] = this._getOrCreateService(dependency.id);
        }

        return new ctor(...constructorArgs);
    }

    private _getOrCreateService<T>(id: ServiceIdentifier<T>): T {
        this._throwIfDisposed();

        const serviceOrDescriptor = this._services.get(id);
        if (!serviceOrDescriptor) {
            throw new Error(`Service '${id.id}' is not registered.`);
        }

        if (!(serviceOrDescriptor instanceof ServiceDescriptor)) {
            return serviceOrDescriptor;
        }

        if (this._activeInstantiations.has(id)) {
            throw new Error(`Cyclic dependency while creating service '${id.id}'.`);
        }

        this._activeInstantiations.add(id);
        try {
            const service = this._createInstance(
                serviceOrDescriptor.ctor,
                serviceOrDescriptor.staticArguments,
            );
            this._services.set(id, service);
            this._createdServices.add(service);
            return service;
        } finally {
            this._activeInstantiations.delete(id);
        }
    }

    private _throwIfDisposed(): void {
        if (this._isDisposed) {
            throw new Error("Instantiation service has been disposed.");
        }
    }
}
