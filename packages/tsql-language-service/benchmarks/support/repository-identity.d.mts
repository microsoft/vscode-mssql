/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface RepositoryIdentity {
    readonly commit: string;
    readonly dirty: boolean;
    readonly sourceFingerprint: string;
}

export function repositoryIdentity(packageDirectory: string): Promise<RepositoryIdentity>;
