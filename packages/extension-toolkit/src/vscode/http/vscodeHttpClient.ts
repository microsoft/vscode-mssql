/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    HttpClient,
    IHttpClientLogger,
    IProxyConfiguration,
    IProxyResolver,
    parseProxyConfiguration,
    ProxyConfigurationIssue,
    resolveProxyConfiguration,
} from "../../base";

/** Options for creating a VS Code-aware HTTP client. */
export interface IVscodeHttpClientOptions {
    /** Optional logger for credential-free HTTP diagnostics. */
    readonly logger?: IHttpClientLogger;
}

/**
 * An HTTP client configured from VS Code's `http.proxy` and `http.proxyStrictSSL` settings.
 *
 * Proxy precedence is the `http.proxy` setting, then the standard proxy environment variables,
 * then a direct connection. `http.proxyStrictSSL` controls certificate validation for `https:`
 * proxy connections only; the destination server's certificate is always validated.
 *
 * Invalid proxy settings surface as a `proxy-configuration` error on the failing request. Use
 * {@link getVscodeProxyConfigurationIssue} to report them during activation with a localized
 * message.
 */
export class VscodeHttpClient extends HttpClient {
    /**
     * Creates a VS Code-aware HTTP client.
     *
     * @param options Optional diagnostic logger.
     */
    constructor(options: IVscodeHttpClientOptions = {}) {
        super({
            logger: options.logger,
            proxyResolver: createVscodeProxyResolver(),
        });
    }
}

/**
 * Creates a proxy resolver backed by VS Code's `http.proxy` and `http.proxyStrictSSL` settings
 * with an environment variable fallback.
 */
export function createVscodeProxyResolver(): IProxyResolver {
    return {
        resolve(target: URL): IProxyConfiguration | undefined {
            const rejectUnauthorized = getProxyStrictSSL() !== false;
            return resolveProxyConfiguration(target, getVscodeProxySetting(), rejectUnauthorized);
        },
    };
}

/**
 * Validates VS Code's `http.proxy` setting using the same parser the client uses at request time.
 *
 * @returns The problem with the configured proxy, or `undefined` when the setting is empty or
 * valid. Callers own presenting a localized warning; the raw setting is intentionally not
 * returned because it may embed credentials.
 */
export function getVscodeProxyConfigurationIssue(): ProxyConfigurationIssue | undefined {
    const configured = getVscodeProxySetting();
    if (!configured) {
        return undefined;
    }

    const parsed = parseProxyConfiguration(configured);
    return parsed.ok === false ? parsed.issue : undefined;
}

function getVscodeProxySetting(): string | undefined {
    const value = vscode.workspace.getConfiguration("http").get<string>("proxy");
    return value?.trim() ? value.trim() : undefined;
}

function getProxyStrictSSL(): boolean | undefined {
    return vscode.workspace.getConfiguration("http").get<boolean>("proxyStrictSSL");
}
