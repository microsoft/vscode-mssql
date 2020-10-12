/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
export interface Logger{
    log:(msg: any, ...vals: any[])=> void;
    error:(msg: any, ...vals: any[])=>void;
    pii:(msg: any, ...vals: any[])=> void;
}

export interface Deferred<T> {
    resolve: (result: T|Promise<T>) => void;
    reject: (reason: any) => void;
}

export interface MessageDisplayer {
    displayInfoMessage: (msg: string) => Promise<void>;
    displayErrorMessage: (msg: string) => Promise<void>;
}