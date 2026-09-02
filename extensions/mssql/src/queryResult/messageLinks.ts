/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISelectionData } from "../models/interfaces";
import { IMessageLink } from "../sharedInterfaces/queryResult";

/**
 * Navigation metadata for a query error message.
 */
export interface ErrorMessageNavigation {
    link: IMessageLink;
    selection: ISelectionData;
}

/**
 * Builds navigation for an error when SQL Tools Service supplies an absolute source selection.
 * SQL Server puts the source line in the final comma-delimited segment of the error header. Using
 * that segment keeps the rest of the error styled as an error without depending on localized
 * header labels.
 */
export function createErrorMessageNavigation(
    message: string | undefined,
    errorSelection: ISelectionData | undefined,
    uri: string,
): ErrorMessageNavigation | undefined {
    if (!message || !errorSelection) {
        return undefined;
    }

    const header = message.split(/\r?\n/, 1)[0];
    const linkText = header.slice(header.lastIndexOf(",") + 1).trim();
    if (!linkText) {
        return undefined;
    }

    return {
        link: { text: linkText, uri },
        selection: errorSelection,
    };
}
