interface UserInteraction {
    /**
     * Asks the user for consent. Expects a true or false response. True means that 
     * @param msg 
     */
    askForConsent(msg: string): Promise<boolean>;

    /**
     * Opens a browser page on the caller.
     * @param url 
     */
    openUrl(url: string): Promise<void>;
}

interface AuthRequest {
    /**
     * Gets the state to send with the oauth request
     */
    getState(): Promise<string>;

    /**
     * After the auth mechanism opens the URL, it will request an auth token to be returned to the caller to finish the authentication process.
     * @param state 
     */
    getAuthorizationCode(state: string): Promise<string>;
}