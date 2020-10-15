/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
export interface UserInteraction {
    /**
     * Asks the user for consent. Expects a true or false response. True means that
     * @param msg
     */
    askForConsent(msg: string): Promise<boolean>;

    /**
     * Opens a browser page on the caller.
     * @param url
     */
    openUrl(url: string): Promise<boolean>;
}

export interface AuthRequest {
    /**
     * Gets the state to send with the oauth request
     */
    getState(): string;

    /**
     * After the auth mechanism opens the URL, it will request an auth token to be returned to the caller to finish the authentication process.
     * @param signInUrl
     * @param state
     */
    getAuthorizationCode(signInUrl: string, authCompletePromise: Promise<void>): Promise<string>;

    /**
     * Display the device code screen to the user.
     * @param msg
     * @param userCode
     * @param verificationUrl
     */
    displayDeviceCodeScreen(msg: string, userCode: string, verificationUrl: string): Promise<void>;

    /**
     * Closes the device code screen
     */
    closeDeviceCodeScreen(): Promise<void>;
}