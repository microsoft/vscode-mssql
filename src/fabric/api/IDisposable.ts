/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Describes an object that can destroy itself and its resources
 */
export interface IDisposable {
    /**
     * Destroys the object and its underlying resources
     */
    dispose(): void;
}
