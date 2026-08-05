/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";
import type { IHttpClientMessages } from "../../base";

/** Localized messages used by the VS Code HTTP client. */
export const ProxyMessages: IHttpClientMessages = {
    get unableToGetProxyAgentOptions() {
        return l10n.t("Unable to read proxy agent options.");
    },
    missingProtocolWarning: (proxy: string) =>
        l10n.t({
            message:
                "Proxy settings found, but without a protocol (e.g. http://): '{0}'. You may encounter connection issues.",
            args: [proxy],
            comment: ["{0} is the proxy URL"],
        }),
    unparseableWarning: (proxy: string, errorMessage: string) =>
        l10n.t({
            message:
                "Proxy settings found, but encountered an error while parsing the URL: '{0}'. You may encounter connection issues. Error: {1}",
            args: [proxy, errorMessage],
            comment: ["{0} is the proxy URL", "{1} is the error message"],
        }),
};
