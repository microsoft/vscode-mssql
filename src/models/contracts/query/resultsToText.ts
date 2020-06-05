/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from 'vscode-languageclient';


export class ResultsToTextRequestParams {

    /*
     * URI for the editor that called execute results
     */
    ownerUri: string;

    /**
     * Include headers of columns in text
     */
    includeHeaders: boolean = true;

    /*
     * Delimiter for separating data items in text
     */
    delimiter: string = ' ';

    /**
     * either CR, CRLF or LF to seperate rows in text
     */
    lineSeperator: string = undefined;

    /**
     * Text identifier for alphanumeric columns in text
     */
    textIdentifier: string = '\"';

    /**
     * Are the results column algined
     */
    isColumnAligned: boolean = true;

    /**
     * User selected file path where the results need to
     * be saved if isSave is true, otherwise file path
     * to save a temp text file to read from
     */
    filePath: string;

    /**
     * Is the request to save the results in text
     */
    isSave?: boolean = false;

}

export class ResultsToTextResult {

    /**
     * The path of the temporary file to read text from
     */
    messages: string[];

    /**
     * Was the operation successful or not
     */
    isSuccess: boolean;

    /**
     * Errors if any when carrying out this operation
     */
    errors: string[];
}

// ------------------------------- < Results to Text Request > ------------------------------------
export namespace ResultsToTextRequest {
    export const type = new RequestType<ResultsToTextRequestParams, ResultsToTextResult, void, void>('query/resultstotext');
}
