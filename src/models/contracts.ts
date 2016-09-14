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

// --------------------------------- < Save Results as CSV Request > ------------------------------------------
// save results as csv format
export namespace SaveResultsAsCsvRequest {
    export const type: RequestType<SaveResultsRequestParams, SaveResultRequestResult, void> = { get method(): string { return 'query/saveCsv'; } };
    export class SaveResultsRequestParams {
        ownerUri: string;
        filePath: string;
        batchIndex: number;
        resultSetIndex: number;
        fileEncoding: string = 'utf-8';
        includeHeaders: boolean = true;
        valueInQuotes: boolean = false;
    }

    export class SaveResultRequestResult {
        messages: string;
    }
}
// --------------------------------- </ Save Results as CSV Request > ------------------------------------------

// --------------------------------- < Save Results as JSON Request > ------------------------------------------
// save results as csv format
export namespace SaveResultsAsJsonRequest {
    export const type: RequestType<SaveResultsRequestParams, SaveResultRequestResult, void> = { get method(): string { return 'query/saveJson'; } };
    export class SaveResultsRequestParams {
        ownerUri: string;
        filePath: string;
        batchIndex: number;
        resultSetIndex: number;
    }

    export class SaveResultRequestResult {
        messages: string;
    }
}
// --------------------------------- </ Save Results as JSON Request > ------------------------------------------
