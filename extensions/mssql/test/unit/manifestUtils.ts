/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ConfigurationContribution<T> {
    properties: Record<string, T>;
}

export function collectConfigurationProperties<T>(
    configuration: ConfigurationContribution<T> | ConfigurationContribution<T>[],
): Record<string, T> {
    const contributions = Array.isArray(configuration) ? configuration : [configuration];
    return Object.assign({}, ...contributions.map((contribution) => contribution.properties));
}
