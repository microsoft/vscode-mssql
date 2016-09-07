import {RequestType} from 'vscode-languageclient';

// --------------------------------- < Version Request > -------------------------------------------------

// Version request message callback declaration
export namespace VersionRequest {
    export const type: RequestType<void, VersionResult, void> = { get method(): string { return 'version'; } };
}

// Version response format
export type VersionResult = string;

// ------------------------------- </ Version Request > --------------------------------------------------


// --------------------------------- < Read Credential Request > -------------------------------------------------

// Read Credential request message callback declaration
export namespace ReadCredentialRequest {
    export const type: RequestType<Credential, Credential, void> = { get method(): string { return 'credential/read'; } };
}

/**
 * Parameters to initialize a connection to a database
 */
export class Credential {
    /**
     * Unique ID identifying the credential
     */
    public credentialId: string;

    /**
     * password
     */
    public password: string;
}

// --------------------------------- </ Read Credential Request > -------------------------------------------------

// --------------------------------- < Save Credential Request > -------------------------------------------------

// Save Credential request message callback declaration
export namespace SaveCredentialRequest {
    export const type: RequestType<Credential, boolean, void> = { get method(): string { return 'credential/save'; } };
}
// --------------------------------- </ Save Credential Request > -------------------------------------------------


// --------------------------------- < Delete Credential Request > -------------------------------------------------

// Delete Credential request message callback declaration
export namespace DeleteCredentialRequest {
    export const type: RequestType<Credential, boolean, void> = { get method(): string { return 'credential/delete'; } };
}
// --------------------------------- </ Save Credential Request > -------------------------------------------------
