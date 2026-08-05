/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";
import type { ProxyConfigurationIssue } from "../../base";

/** Localized messages used by the VS Code HTTP client. */
export const ProxyMessages = {
    get missingProtocolWarning(): string {
        return l10n.t(
            "Proxy settings found, but without a protocol (e.g. http://). You may encounter connection issues.",
        );
    },
    unsupportedProtocolWarning: (protocol: string): string =>
        l10n.t({
            message:
                "Proxy settings found, but the protocol '{0}' is not supported; only http and https proxies can be used. You may encounter connection issues.",
            args: [protocol],
            comment: ["{0} is the proxy protocol"],
        }),
    get unparseableWarning(): string {
        return l10n.t(
            "Proxy settings found, but the URL could not be parsed. You may encounter connection issues.",
        );
    },
};

/** Maps a parsed proxy configuration issue to a localized, credential-safe warning. */
export function getProxyConfigurationIssueMessage(issue: ProxyConfigurationIssue): string {
    switch (issue.kind) {
        case "missing-protocol":
            return ProxyMessages.missingProtocolWarning;
        case "unsupported-protocol":
            return ProxyMessages.unsupportedProtocolWarning(issue.protocol);
        case "invalid-url":
            return ProxyMessages.unparseableWarning;
    }
}
