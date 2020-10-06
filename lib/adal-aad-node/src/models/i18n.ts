/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { AADResource, Tenant } from '.';

export interface StringLookup {
    getSimpleString: (code: number) => string;
    getInteractionRequiredString: (context: InteractionRequiredContext) => string;
}

export interface InteractionRequiredContext{
    tenant: Tenant;
    resource: AADResource;
}