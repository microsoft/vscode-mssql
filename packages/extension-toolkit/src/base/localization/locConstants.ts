/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";

/** Localized messages used by the HTTP client. */
export class ProxyMessages {
    private constructor() {}

    public static get unableToGetProxyAgentOptions(): string {
        return l10n.t("Unable to read proxy agent options.");
    }

    public static missingProtocolWarning(proxy: string): string {
        return l10n.t({
            message:
                "Proxy settings found, but without a protocol (e.g. http://): '{0}'. You may encounter connection issues.",
            args: [proxy],
            comment: ["{0} is the proxy URL"],
        });
    }

    public static unparseableWarning(proxy: string, errorMessage: string): string {
        return l10n.t({
            message:
                "Proxy settings found, but encountered an error while parsing the URL: '{0}'. You may encounter connection issues. Error: {1}",
            args: [proxy, errorMessage],
            comment: ["{0} is the proxy URL", "{1} is the error message"],
        });
    }
}
