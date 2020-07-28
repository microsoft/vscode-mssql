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