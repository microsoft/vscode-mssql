/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { StringLookup, InteractionRequiredContext } from '../models';

type StringMapping = {
    [stringCode: number]: string;
};

const simpleStringMapping: StringMapping = {
    2: 'Something failed with the authentication, or your tokens have been deleted from the system. Please try adding your account to Azure Data Studio again',
    3: 'Token retrival failed with an error. Open developer tools to view the error',
    4: 'No access token returned from Microsoft OAuth',
    5: 'The user had no unique identifier within AAD',
    6: 'Error retrieving tenant information'
};

export class EnUsStringLookup implements StringLookup {
    getSimpleString(code: number): string {
        return simpleStringMapping[code];
    }

    getInteractionRequiredString({tenant, resource}: InteractionRequiredContext): string {
        return `Your tenant '${tenant.displayName} (${tenant.id}) required you to re-authenticate to access ${resource.id} resources. Press Open to start the re-authentication process.`;
    }

}