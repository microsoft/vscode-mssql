/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { ErrorCodes } from './errors';

export class AzureAuthError extends Error {

	constructor(private errorCode: ErrorCodes, private readonly errorMessage: string, private readonly originalException?: any) {
        super(errorMessage);
    }

	getPrintableString(): string {
		return JSON.stringify({
            errorCode: this.errorCode,
			errorMessage: this.errorMessage,
			originalException: this.originalException ?? ''
		}, undefined, ErrorCodes.AuthError);
	}
}
