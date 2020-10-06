/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { ErrorCodes } from "../errors/errors";

export interface ErrorLookup {
    getSimpleError: (errorCode: ErrorCodes) => string;

    getTenantNotFoundError: (context: Error1Context) => string;
}

export interface Error1Context {
    tenantId: string;
}
