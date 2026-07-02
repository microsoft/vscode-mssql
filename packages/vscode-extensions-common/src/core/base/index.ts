/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type DisposableLike = {
    dispose(): void;
};

export * from "./async";
export * from "./errors";
export * from "./event";
export * from "./lifecycle";
export * from "./linkedList";
