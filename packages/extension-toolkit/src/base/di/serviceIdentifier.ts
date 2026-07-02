/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type BrandedService = { readonly _serviceBrand: undefined };

export type Constructor<T> = new (...args: unknown[]) => T;

export interface ServiceIdentifier<T> {
    (target: Function, propertyKey: string | symbol | undefined, parameterIndex: number): void;
    readonly type: T;
    readonly id: string;
}

export interface ServiceDependency {
    readonly id: ServiceIdentifier<unknown>;
    readonly index: number;
}

const serviceDependencies = new WeakMap<Function, ServiceDependency[]>();

export function createServiceIdentifier<T>(id: string): ServiceIdentifier<T> {
    const decorator = function (
        target: Function,
        _propertyKey: string | symbol | undefined,
        parameterIndex: number,
    ): void {
        if (typeof parameterIndex !== "number") {
            throw new Error(
                `Service '${id}' can only be used as a constructor parameter decorator.`,
            );
        }

        const existing = serviceDependencies.get(target) ?? [];
        existing.push({ id: decorator as ServiceIdentifier<unknown>, index: parameterIndex });
        serviceDependencies.set(target, existing);
    } as ServiceIdentifier<T>;

    Object.defineProperties(decorator, {
        id: { value: id, enumerable: true },
        type: { value: undefined },
    });

    return decorator;
}

export function getServiceDependencies(ctor: Function): readonly ServiceDependency[] {
    return [...(serviceDependencies.get(ctor) ?? [])].sort((a, b) => a.index - b.index);
}
