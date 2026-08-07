/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { Readable } from "stream";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import * as tunnel from "tunnel";
import { getErrorMessage } from "../common";
import { ProxyMessages } from "../localization";
import { createHttpHeaders } from "./httpHeaders";
import {
    HttpRequestHeaders,
    IDownloadOptions,
    IDownloadResult,
    IHttpClientLogger,
    IHttpRequest,
    IHttpRequestOptions,
    IHttpResponse,
} from "./httpTypes";

const HTTPS_PORT = 443;
const HTTP_PORT = 80;

/** Runtime integration points for proxy settings. */
export interface IHttpClientDependencies {
    /** Returns the configured proxy endpoint, if available. */
    getProxyConfig?: () => string | undefined;

    /** Returns whether proxy certificates should be validated. */
    getProxyStrictSSL?: () => boolean | undefined;

    /** Parses a URI and returns its scheme. */
    parseUriScheme?: (value: string) => string | undefined;
}

/**
 * Shared HTTP client with proxy support, optional diagnostics, and stream downloads.
 */
export class HttpClient {
    /**
     * Creates an HTTP client.
     *
     * @param logger Optional logger for diagnostics and warnings.
     * @param dependencies Optional host-specific proxy integrations.
     */
    constructor(
        protected readonly logger?: IHttpClientLogger,
        private readonly dependencies: IHttpClientDependencies = {},
    ) {}

    /** Sends a fully described HTTP request. */
    public async request<TResponse = unknown, TBody = undefined>(
        request: IHttpRequest<TBody>,
    ): Promise<IHttpResponse<TResponse>> {
        const { requestUrl, config } = this.setupRequest(request);
        const response = await this.send<TResponse>(requestUrl, config);
        return toHttpResponse(response);
    }

    /** Sends an HTTP GET request. */
    public get<TResponse = unknown>(
        url: string | URL,
        options?: IHttpRequestOptions,
    ): Promise<IHttpResponse<TResponse>> {
        return this.request<TResponse>({ ...options, method: "GET", url });
    }

    /** Sends an HTTP POST request with a JSON body. */
    public postJson<TResponse = unknown, TBody = unknown>(
        url: string | URL,
        body: TBody,
        options?: IHttpRequestOptions,
    ): Promise<IHttpResponse<TResponse>> {
        return this.request<TResponse, TBody>({
            ...options,
            method: "POST",
            url,
            body,
            headers: withDefaultHeaders(options?.headers, {
                "Content-Type": "application/json",
                Accept: "application/json",
            }),
        });
    }

    /** Downloads a URL to a file path and closes the file when the download completes. */
    public async downloadToPath(
        requestUrl: string | URL,
        destinationPath: string,
        options?: IDownloadOptions,
    ): Promise<IDownloadResult> {
        const destinationFd = fs.openSync(destinationPath, "w");

        try {
            return await this.downloadToFileDescriptor(requestUrl, destinationFd, options);
        } finally {
            fs.closeSync(destinationFd);
        }
    }

    /**
     * Downloads a URL to an open file descriptor.
     * The descriptor remains owned by the caller and is not closed by this method.
     */
    public async downloadToFileDescriptor(
        requestUrl: string | URL,
        destinationFd: number,
        options?: IDownloadOptions,
    ): Promise<IDownloadResult> {
        const request = this.setupRequest(
            {
                method: "GET",
                url: requestUrl,
                headers: options?.headers,
                signal: options?.signal,
                timeoutMs: options?.timeoutMs,
            },
            "stream",
        );

        let response: AxiosResponse<Readable>;
        try {
            response = await this.send<Readable>(request.requestUrl, request.config);
        } catch (error) {
            throw new HttpDownloadError("request", error as NodeJS.ErrnoException);
        }

        const result = toDownloadResult(response);
        const totalBytes = this.getContentLength(response.headers["content-length"]);
        let downloadedBytes = 0;
        options?.onProgress?.({
            downloadedBytes,
            totalBytes,
            percentage: totalBytes === undefined ? undefined : 0,
        });

        if (!result.ok) {
            response.data.destroy();
            return result;
        }

        await new Promise<void>((resolve, reject) => {
            const destinationStream = fs.createWriteStream("", {
                fd: destinationFd,
                autoClose: false,
            });
            let isSettled = false;

            const rejectDownload = (error: NodeJS.ErrnoException) => {
                if (isSettled) {
                    return;
                }

                isSettled = true;
                response.data.destroy();
                destinationStream.destroy();
                reject(new HttpDownloadError("response", error));
            };

            response.data.on("data", (data: Buffer) => {
                downloadedBytes += data.length;
                options?.onProgress?.({
                    downloadedBytes,
                    totalBytes,
                    percentage:
                        totalBytes === undefined
                            ? undefined
                            : Math.min(100, (downloadedBytes / totalBytes) * 100),
                });
            });

            response.data.on("error", rejectDownload);
            destinationStream.on("error", rejectDownload);

            destinationStream.on("finish", () => {
                if (isSettled) {
                    return;
                }

                isSettled = true;
                resolve();
            });

            response.data.pipe(destinationStream);
        });

        return result;
    }

    /**
     * Validates the configured proxy settings.
     *
     * @returns A localized warning for the first invalid proxy, or `undefined` when all proxies
     * are valid or unset.
     */
    protected getInvalidProxySettingsWarning(): string | undefined {
        for (const proxy of this.getProxyCandidatesForValidation()) {
            const warning = this.getInvalidProxyWarning(proxy);
            if (warning) {
                return warning;
            }
        }

        return undefined;
    }

    /**
     * Validates a proxy endpoint and logs an invalid setting.
     *
     * @param proxy The proxy endpoint to validate.
     * @returns A localized warning when the proxy is invalid; otherwise, `undefined`.
     */
    private getInvalidProxyWarning(proxy: string): string | undefined {
        let message: string | undefined;
        let localizedMessage: string | undefined;
        const redactedProxy = redactProxySecrets(proxy);

        try {
            const scheme = this.dependencies.parseUriScheme
                ? this.dependencies.parseUriScheme(proxy)
                : new URL(proxy).protocol;

            if (!scheme) {
                message = `Proxy settings found, but without a protocol (e.g. http://): '${redactedProxy}'.  You may encounter connection issues while using this extension.`;
                localizedMessage = ProxyMessages.missingProtocolWarning(redactedProxy);
            }
        } catch (error) {
            const errorMessage = redactProxySecrets(
                getErrorMessage(error).replaceAll(proxy, redactedProxy),
            );
            message = `Proxy settings found, but encountered an error while parsing the URL: '${redactedProxy}'.  You may encounter connection issues while using this extension.  Error: ${errorMessage}`;
            localizedMessage = ProxyMessages.unparseableWarning(redactedProxy, errorMessage);
        }

        if (message) {
            this.logger?.warn(message);
        }

        return localizedMessage;
    }

    /**
     * Parses a request and builds the URL and Axios configuration used to send it.
     *
     * @param request The HTTP request to configure.
     * @param responseType The optional Axios response type.
     * @returns The normalized request URL and its Axios configuration.
     */
    private setupRequest<TBody>(
        request: IHttpRequest<TBody>,
        responseType?: "stream",
    ): { requestUrl: string; config: AxiosRequestConfig } {
        const requestUrl = new URL(request.url.toString());
        const config = this.setupConfigAndProxyForRequest(requestUrl, request.headers);
        config.method = request.method;
        config.data = request.body;
        config.signal = request.signal;
        config.timeout = request.timeoutMs;
        config.responseType = responseType;

        return {
            requestUrl: this.constructRequestUrl(requestUrl, config),
            config,
        };
    }

    /**
     * Builds the Axios configuration and attaches a protocol-appropriate proxy agent.
     *
     * @param requestUrl The parsed request URL.
     * @param headers The headers to include in the request.
     * @returns The Axios configuration for the request.
     */
    private setupConfigAndProxyForRequest(
        requestUrl: URL,
        headers: HttpRequestHeaders = {},
    ): AxiosRequestConfig {
        const config: AxiosRequestConfig = {
            headers: { ...headers },
            validateStatus: () => true,
        };

        const proxy = this.getProxyForRequest(requestUrl);

        if (proxy) {
            this.logger?.debug(
                "Proxy endpoint found in environment variables or workspace configuration.",
            );
            config.proxy = false;

            const agent = this.createProxyAgent(
                requestUrl,
                proxy,
                this.dependencies.getProxyStrictSSL?.(),
            );
            if (requestUrl.protocol === "https:") {
                config.httpsAgent = agent.agent;
            } else {
                config.httpAgent = agent.agent;
            }
        }
        return config;
    }

    private send<TResponse>(
        requestUrl: string,
        config: AxiosRequestConfig,
    ): Promise<AxiosResponse<TResponse>> {
        return axios.request<TResponse>({ ...config, url: requestUrl });
    }

    /**
     * Selects the workspace proxy or the environment proxy for the request protocol.
     *
     * @param requestUrl The parsed request URL used to select an environment proxy.
     * @returns The selected proxy endpoint, or `undefined` when no proxy applies.
     */
    private getProxyForRequest(requestUrl: URL): string | undefined {
        const configuredProxy = this.dependencies.getProxyConfig?.();
        if (configuredProxy) {
            return configuredProxy;
        }

        this.logger?.debug(
            "Workspace HTTP config didn't contain a proxy endpoint. Checking environment variables.",
        );
        return this.getEnvironmentProxyForRequest(requestUrl);
    }

    /**
     * Adds the default protocol port when Axios proxy handling is disabled.
     *
     * @param requestUrl The parsed request URL.
     * @param config The Axios configuration for the request.
     * @returns The request URL with an explicit port when required.
     */
    private constructRequestUrl(requestUrl: URL, config: AxiosRequestConfig): string {
        if (!config.proxy) {
            const port =
                requestUrl.port || (requestUrl.protocol === "https:" ? HTTPS_PORT : HTTP_PORT);

            return `${requestUrl.protocol}//${requestUrl.hostname}:${port}${requestUrl.pathname}${requestUrl.search}`;
        }
        return requestUrl.toString();
    }

    /**
     * Gets the configured proxies that should be checked for diagnostic warnings.
     *
     * @returns The workspace proxy, or the protocol-specific environment proxies when no
     * workspace proxy is configured.
     */
    private getProxyCandidatesForValidation(): string[] {
        const configuredProxy = this.dependencies.getProxyConfig?.();
        if (configuredProxy) {
            return [configuredProxy];
        }

        this.logger?.debug(
            "Workspace HTTP config didn't contain a proxy endpoint. Checking environment variables.",
        );
        return [
            process.env.HTTPS_PROXY || process.env.https_proxy,
            process.env.HTTP_PROXY || process.env.http_proxy,
        ].filter((proxy): proxy is string => Boolean(proxy));
    }

    /**
     * Creates the tunnel agent for the request and proxy protocols.
     *
     * @param requestUrl The parsed request URL.
     * @param proxy The proxy endpoint through which the request will be sent.
     * @param proxyStrictSSL Whether the proxy certificate must pass validation.
     * @returns The configured proxy agent.
     */
    private createProxyAgent(requestUrl: URL, proxy: string, proxyStrictSSL?: boolean): ProxyAgent {
        const agentOptions = this.getProxyAgentOptions(proxy, proxyStrictSSL);
        if (!agentOptions || !agentOptions.host || !agentOptions.port) {
            this.logger?.error("Unable to read proxy agent options to create proxy agent.");
            throw new Error(ProxyMessages.unableToGetProxyAgentOptions);
        }

        const isHttpsProxy = agentOptions.protocol === "https:";
        const tunnelOptions: tunnel.HttpsOverHttpsOptions = {
            proxy: {
                host: agentOptions.host,
                port: Number(agentOptions.port),
                ...(agentOptions.auth ? { proxyAuth: agentOptions.auth } : {}),
                ...(isHttpsProxy ? { rejectUnauthorized: agentOptions.rejectUnauthorized } : {}),
            },
        };

        const isHttpsRequest = requestUrl.protocol === "https:";
        return {
            agent: this.createTunnelingAgent(isHttpsRequest, isHttpsProxy, tunnelOptions),
        };
    }

    /**
     * Creates the tunnel implementation for the request and proxy protocol combination.
     *
     * @param isHttpsRequest Whether the request uses HTTPS.
     * @param isHttpsProxy Whether the proxy endpoint uses HTTPS.
     * @param tunnelOptions The proxy options passed to the tunnel package.
     * @returns An HTTP or HTTPS tunneling agent for the protocol combination.
     */
    private createTunnelingAgent(
        isHttpsRequest: boolean,
        isHttpsProxy: boolean,
        tunnelOptions: tunnel.HttpsOverHttpsOptions,
    ): http.Agent | https.Agent {
        if (isHttpsRequest && isHttpsProxy) {
            this.logger?.debug("Creating https request over https proxy tunneling agent");
            return tunnel.httpsOverHttps(tunnelOptions);
        } else if (isHttpsRequest && !isHttpsProxy) {
            this.logger?.debug("Creating https request over http proxy tunneling agent");
            return tunnel.httpsOverHttp(tunnelOptions);
        } else if (!isHttpsRequest && isHttpsProxy) {
            this.logger?.debug("Creating http request over https proxy tunneling agent");
            return tunnel.httpOverHttps(tunnelOptions);
        }

        this.logger?.debug("Creating http request over http proxy tunneling agent");
        return tunnel.httpOverHttp(tunnelOptions);
    }

    /**
     * Parses a proxy endpoint into the options required by the tunnel package.
     *
     * @param proxy The proxy endpoint to parse.
     * @param strictSSL Whether the proxy certificate must pass validation.
     * @returns Parsed proxy-agent options, or `undefined` for an unsupported proxy protocol.
     */
    private getProxyAgentOptions(
        proxy: string,
        strictSSL?: boolean,
    ): ProxyAgentOptions | undefined {
        const proxyEndpoint = new URL(proxy);
        if (!/^https?:$/.test(proxyEndpoint.protocol)) {
            return undefined;
        }

        const auth =
            proxyEndpoint.username || proxyEndpoint.password
                ? `${proxyEndpoint.username}:${proxyEndpoint.password}`
                : undefined;

        return {
            protocol: proxyEndpoint.protocol,
            host: proxyEndpoint.hostname,
            port: proxyEndpoint.port
                ? Number(proxyEndpoint.port)
                : proxyEndpoint.protocol === "https:"
                  ? HTTPS_PORT
                  : HTTP_PORT,
            auth,
            rejectUnauthorized: strictSSL !== false,
        };
    }

    /**
     * Selects an environment proxy according to the request protocol.
     *
     * @param requestUrl The parsed request URL.
     * @returns The matching environment proxy, or `undefined` when none applies.
     */
    private getEnvironmentProxyForRequest(requestUrl: URL): string | undefined {
        if (requestUrl.protocol === "http:") {
            return process.env.HTTP_PROXY || process.env.http_proxy || undefined;
        } else if (requestUrl.protocol === "https:") {
            return (
                process.env.HTTPS_PROXY ||
                process.env.https_proxy ||
                process.env.HTTP_PROXY ||
                process.env.http_proxy ||
                undefined
            );
        }

        return undefined;
    }

    private getContentLength(header: unknown): number | undefined {
        if (Array.isArray(header)) {
            return this.getContentLength(header[0]);
        }

        const value = typeof header === "number" ? header : Number.parseInt(`${header}`, 10);
        return Number.isFinite(value) && value > 0 ? value : undefined;
    }
}

function toHttpResponse<TResponse>(response: AxiosResponse<TResponse>): IHttpResponse<TResponse> {
    return {
        data: response.data,
        status: response.status,
        statusText: response.statusText ?? "",
        ok: isSuccessStatus(response.status),
        headers: createHttpHeaders(toHeaderRecord(response.headers)),
    };
}

function toDownloadResult(response: AxiosResponse<Readable>): IDownloadResult {
    return {
        status: response.status,
        statusText: response.statusText ?? "",
        ok: isSuccessStatus(response.status),
        headers: createHttpHeaders(toHeaderRecord(response.headers)),
    };
}

function toHeaderRecord(headers: unknown): Record<string, unknown> {
    if (typeof headers !== "object" || headers === null) {
        return {};
    }

    return Object.fromEntries(Object.entries(headers as Record<string, unknown>));
}

function isSuccessStatus(status: number): boolean {
    return status >= 200 && status < 300;
}

function withDefaultHeaders(
    headers: HttpRequestHeaders | undefined,
    defaults: Record<string, string>,
): HttpRequestHeaders {
    const merged: Record<string, string> = { ...headers };
    const supplied = new Set(Object.keys(merged).map((name) => name.toLowerCase()));

    for (const [name, value] of Object.entries(defaults)) {
        if (!supplied.has(name.toLowerCase())) {
            merged[name] = value;
        }
    }

    return merged;
}

interface ProxyAgent {
    agent: http.Agent | https.Agent;
}

interface ProxyAgentOptions {
    auth: string | undefined;
    host?: string | null;
    port?: string | number | null;
    protocol: string;
    rejectUnauthorized: boolean;
}

/**
 * Redacts credentials and query or fragment values from proxy URL-like strings.
 *
 * Examples:
 * - `http://user:password@proxy.example.com:8080` becomes
 *   `http://<redacted>@proxy.example.com:8080`.
 * - `http://proxy.example.com:8080?token=secret#fragment` becomes
 *   `http://proxy.example.com:8080<redacted>`.
 * - `proxy.example.com:8080` remains usable as a protocol-less proxy value while
 *   still redacting any credentials or query and fragment values.
 */
function redactProxySecrets(proxy: string): string {
    const schemeSeparatorIndex = proxy.indexOf("://");
    const authorityStart = schemeSeparatorIndex >= 0 ? schemeSeparatorIndex + 3 : 0;
    const authorityEnd = ["/", "?", "#"]
        .map((separator) => proxy.indexOf(separator, authorityStart))
        .filter((index) => index >= 0)
        .reduce((first, index) => Math.min(first, index), proxy.length);
    const credentialSeparatorIndex = proxy.lastIndexOf("@", authorityEnd - 1);

    let redacted =
        credentialSeparatorIndex >= authorityStart
            ? `${proxy.slice(0, authorityStart)}<redacted>@${proxy.slice(credentialSeparatorIndex + 1)}`
            : proxy;
    const sensitiveSuffixIndex = [redacted.indexOf("?"), redacted.indexOf("#")]
        .filter((index) => index >= 0)
        .reduce((first, index) => Math.min(first, index), redacted.length);
    if (sensitiveSuffixIndex < redacted.length) {
        redacted = `${redacted.slice(0, sensitiveSuffixIndex)}<redacted>`;
    }

    return redacted;
}

/** Error raised by a download when request or response streaming fails. */
export class HttpDownloadError extends Error {
    /**
     * Creates a download error with phase metadata.
     *
     * @param phase Whether the failure happened while requesting or streaming.
     * @param innerError The underlying Node.js error.
     */
    constructor(
        public phase: "request" | "response",
        public innerError: NodeJS.ErrnoException,
    ) {
        super(innerError.message);
    }
}
