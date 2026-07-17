/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//!!! DO NOT modify directly. This file contains stable DI primitives copied from microsoft/vscode.
// Source: https://github.com/microsoft/vscode/blob/1f01c15f70c50c8a6f6e9e17acca9d7cae9bbd5c/src/vs/platform/instantiation/common/instantiation.ts
// Reference: https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/util/vs/platform/instantiation/common/instantiation.ts
// Extension-specific behavior should live outside src/base/di.

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
        propertyKey: string | symbol | undefined,
        parameterIndex: number,
    ): void {
        if (
            typeof target !== "function" ||
            propertyKey !== undefined ||
            typeof parameterIndex !== "number"
        ) {
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
