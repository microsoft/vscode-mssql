/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from "http";

/** Default port used when an `http:` proxy URL omits one. */
const DEFAULT_HTTP_PORT = 80;

/** Default port used when an `https:` proxy URL omits one. */
const DEFAULT_HTTPS_PORT = 443;

const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** Where a resolved proxy came from. */
export type ProxySource = "vscode" | "environment";

/** A proxy that should be used for a specific request. */
export interface IProxyConfiguration {
    /** Parsed proxy endpoint. Only `http:` and `https:` are supported. */
    readonly url: URL;

    /**
     * Whether the certificate presented by an `https:` proxy must be valid.
     *
     * This controls the connection to the proxy only; the destination server's certificate is
     * always validated.
     */
    readonly rejectUnauthorized: boolean;

    /** Where the proxy setting was read from. */
    readonly source: ProxySource;
}

/**
 * Resolves the proxy to use for a request.
 *
 * Implementations may throw when a configured proxy value is invalid; the HTTP client converts
 * such failures into a `proxy-configuration` error.
 */
export interface IProxyResolver {
    /**
     * Returns the proxy to use for the given target, or `undefined` for a direct connection.
     *
     * @param target Absolute URL of the request.
     */
    resolve(target: URL): IProxyConfiguration | undefined;
}

/** Reason a configured proxy value could not be used. */
export type ProxyConfigurationIssue =
    /** The value has no scheme, for example `proxy.example.com:3128`. */
    | { readonly kind: "missing-protocol" }
    /** The value uses a scheme other than `http:` or `https:`, for example `socks5:`. */
    | {
          readonly kind: "unsupported-protocol";
          readonly protocol: string;
      }
    /** The value could not be parsed as a URL. */
    | {
          readonly kind: "invalid-url";
          readonly error: unknown;
      };

/** Successful or failed result of parsing a proxy setting. */
export type ProxyConfigurationParseResult =
    | { readonly ok: true; readonly url: URL }
    | { readonly ok: false; readonly issue: ProxyConfigurationIssue };

/**
 * Parses a proxy setting using the same rules for activation-time validation and request-time
 * resolution.
 *
 * Only `http:` and `https:` proxies are supported. Values without a scheme (`localhost:3128`)
 * are reported as `missing-protocol` rather than being silently accepted.
 *
 * @param value Raw proxy setting.
 */
export function parseProxyConfiguration(value: string): ProxyConfigurationParseResult {
    const trimmed = value.trim();

    if (!SCHEME_PATTERN.test(trimmed)) {
        if (/^https?:/i.test(trimmed)) {
            return {
                ok: false,
                issue: {
                    kind: "invalid-url",
                    error: new Error("HTTP proxy URL is malformed."),
                },
            };
        }

        const scheme = trimmed.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)?.[1];
        const looksLikeHostAndPort = /^[^:/\\]+:\d+(?:$|[/\\])/.test(trimmed);
        if (scheme && !looksLikeHostAndPort) {
            return {
                ok: false,
                issue: {
                    kind: "unsupported-protocol",
                    protocol: `${scheme.toLowerCase()}:`,
                },
            };
        }

        return { ok: false, issue: { kind: "missing-protocol" } };
    }

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch (error) {
        return { ok: false, issue: { kind: "invalid-url", error } };
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, issue: { kind: "unsupported-protocol", protocol: url.protocol } };
    }

    if (!url.hostname) {
        return {
            ok: false,
            issue: { kind: "invalid-url", error: new Error("Proxy URL has no host.") },
        };
    }

    return { ok: true, url };
}

/**
 * Builds a credential-free, non-localized description of a proxy configuration problem.
 *
 * The raw proxy value is intentionally excluded because it may embed credentials.
 *
 * @param issue Problem reported by {@link parseProxyConfiguration}.
 */
export function describeProxyConfigurationIssue(issue: ProxyConfigurationIssue): string {
    switch (issue.kind) {
        case "missing-protocol":
            return "Proxy setting is missing a protocol (for example, http:// or https://).";
        case "unsupported-protocol":
            return `Proxy setting uses an unsupported protocol '${issue.protocol}'; only http: and https: are supported.`;
        case "invalid-url":
            return "Proxy setting could not be parsed as a URL.";
    }
}

/**
 * Formats a proxy endpoint for diagnostics without exposing credentials.
 *
 * Username, password, query, and fragment are omitted.
 *
 * @param proxyUrl Parsed proxy endpoint.
 */
export function getRedactedProxyDescription(proxyUrl: URL): string {
    return `${proxyUrl.protocol}//${proxyUrl.hostname}:${getProxyPort(proxyUrl)}`;
}

/**
 * Returns the effective port for a proxy endpoint, applying protocol defaults.
 *
 * @param proxyUrl Parsed proxy endpoint.
 */
export function getProxyPort(proxyUrl: URL): number {
    if (proxyUrl.port) {
        return Number(proxyUrl.port);
    }

    return proxyUrl.protocol === "https:" ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT;
}

/**
 * Selects the environment proxy for a target URL.
 *
 * `HTTP` targets read `HTTP_PROXY` then `http_proxy`. `HTTPS` targets read `HTTPS_PROXY`,
 * `https_proxy`, `HTTP_PROXY`, then `http_proxy`. `NO_PROXY`/`no_proxy` bypasses the proxy.
 *
 * @param target Absolute URL of the request.
 * @param environment Environment variables to read; defaults to `process.env`.
 */
export function resolveEnvironmentProxyValue(
    target: URL,
    environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
    if (target.protocol !== "http:" && target.protocol !== "https:") {
        return undefined;
    }

    if (!shouldProxyTarget(target, environment)) {
        return undefined;
    }

    const names =
        target.protocol === "https:"
            ? ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
            : ["HTTP_PROXY", "http_proxy"];

    for (const name of names) {
        const value = environment[name];
        if (value && value.trim()) {
            return value.trim();
        }
    }

    return undefined;
}

/**
 * Creates a proxy resolver backed by the standard proxy environment variables.
 *
 * @param options Optional overrides for the environment source and certificate validation.
 */
export function createEnvironmentProxyResolver(options?: {
    /** Environment variables to read; defaults to `process.env`. */
    readonly environment?: NodeJS.ProcessEnv;

    /** Whether an `https:` proxy certificate must be valid. Defaults to `true`. */
    readonly rejectUnauthorized?: boolean;
}): IProxyResolver {
    return {
        resolve(target: URL): IProxyConfiguration | undefined {
            const value = resolveEnvironmentProxyValue(target, options?.environment);
            if (!value) {
                return undefined;
            }

            const parsed = parseProxyConfiguration(value);
            if (parsed.ok === false) {
                throw new Error(describeProxyConfigurationIssue(parsed.issue));
            }

            return {
                url: parsed.url,
                rejectUnauthorized: options?.rejectUnauthorized !== false,
                source: "environment",
            };
        },
    };
}

/**
 * Resolves an explicit host proxy setting with an environment fallback.
 *
 * A non-empty explicit setting always takes precedence, including when the target matches
 * `NO_PROXY`. When it is absent, the target-aware environment resolver is used.
 *
 * @param target Absolute request URL.
 * @param explicitProxyValue Explicit host proxy setting, such as VS Code's `http.proxy`.
 * @param rejectUnauthorized Whether an `https:` proxy certificate must be valid.
 * @param environment Environment variables used by the fallback resolver.
 */
export function resolveProxyConfiguration(
    target: URL,
    explicitProxyValue: string | undefined,
    rejectUnauthorized: boolean,
    environment: NodeJS.ProcessEnv = process.env,
): IProxyConfiguration | undefined {
    const explicitValue = explicitProxyValue?.trim();
    if (!explicitValue) {
        return createEnvironmentProxyResolver({ environment, rejectUnauthorized }).resolve(target);
    }

    const parsed = parseProxyConfiguration(explicitValue);
    if (parsed.ok === false) {
        throw new Error(describeProxyConfigurationIssue(parsed.issue));
    }

    return {
        url: parsed.url,
        rejectUnauthorized,
        source: "vscode",
    };
}

/** Connection options used to reach a proxy server. */
export interface IProxyConnectionOptions {
    /** Proxy host name. */
    readonly host: string;

    /** Proxy port. */
    readonly port: number;

    /** `user:password` credentials sent in the proxy authorization header, when configured. */
    readonly proxyAuth?: string;

    /** Whether the `https:` proxy certificate must be valid. Only set for `https:` proxies. */
    readonly rejectUnauthorized?: boolean;
}

/** Options passed to a proxy agent factory. */
export interface IProxyAgentOptions {
    /** How to connect to the proxy server. */
    readonly proxy: IProxyConnectionOptions;
}

/**
 * Creates connection-pooling agents that route requests through a proxy.
 *
 * The four members cover each combination of request protocol and proxy protocol.
 */
export interface IProxyAgentFactory {
    /**
     * Creates an agent for an `http:` request through an `http:` proxy.
     *
     * @param options Proxy connection options.
     */
    httpOverHttp(options: IProxyAgentOptions): http.Agent;

    /**
     * Creates an agent for an `http:` request through an `https:` proxy.
     *
     * @param options Proxy connection options.
     */
    httpOverHttps(options: IProxyAgentOptions): http.Agent;

    /**
     * Creates an agent for an `https:` request through an `http:` proxy.
     *
     * @param options Proxy connection options.
     */
    httpsOverHttp(options: IProxyAgentOptions): http.Agent;

    /**
     * Creates an agent for an `https:` request through an `https:` proxy.
     *
     * @param options Proxy connection options.
     */
    httpsOverHttps(options: IProxyAgentOptions): http.Agent;
}

function shouldProxyTarget(target: URL, environment: NodeJS.ProcessEnv): boolean {
    const noProxy = (environment.NO_PROXY || environment.no_proxy || "").trim().toLowerCase();
    if (!noProxy) {
        return true;
    }

    if (noProxy === "*") {
        return false;
    }

    const hostname = target.hostname.toLowerCase();
    const port = target.port
        ? Number(target.port)
        : target.protocol === "https:"
          ? DEFAULT_HTTPS_PORT
          : DEFAULT_HTTP_PORT;

    return noProxy.split(/[,\s]/).every((entry) => {
        if (!entry) {
            return true;
        }

        const withPort = entry.match(/^(.+):(\d+)$/);
        let entryHost = withPort ? withPort[1] : entry;
        const entryPort = withPort ? Number(withPort[2]) : 0;

        if (entryPort && entryPort !== port) {
            return true;
        }

        if (!/^[.*]/.test(entryHost)) {
            return hostname !== entryHost;
        }

        if (entryHost.startsWith("*")) {
            entryHost = entryHost.slice(1);
        }

        return !hostname.endsWith(entryHost);
    });
}
