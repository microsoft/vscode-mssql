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

    /** Returns a localized warning when the configured proxy is invalid. */
    protected getInvalidProxySettingsWarning(): string | undefined {
        const proxy = this.loadProxyConfig();
        if (!proxy) {
            return undefined;
        }

        let message: string | undefined;
        let localizedMessage: string | undefined;

        try {
            const scheme = this.dependencies.parseUriScheme
                ? this.dependencies.parseUriScheme(proxy)
                : new URL(proxy).protocol;

            if (!scheme) {
                message = `Proxy settings found, but without a protocol (e.g. http://): '${proxy}'.  You may encounter connection issues while using this extension.`;
                localizedMessage = ProxyMessages.missingProtocolWarning(proxy);
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            message = `Proxy settings found, but encountered an error while parsing the URL: '${proxy}'.  You may encounter connection issues while using this extension.  Error: ${errorMessage}`;
            localizedMessage = ProxyMessages.unparseableWarning(proxy, errorMessage);
        }

        if (message) {
            this.logger?.warn(message);
        }

        return localizedMessage;
    }

    private setupRequest<TBody>(
        request: IHttpRequest<TBody>,
        responseType?: "stream",
    ): { requestUrl: string; config: AxiosRequestConfig } {
        const originalRequestUrl = request.url.toString();
        const config = this.setupConfigAndProxyForRequest(originalRequestUrl, request.headers);
        config.method = request.method;
        config.data = request.body;
        config.signal = request.signal;
        config.timeout = request.timeoutMs;
        config.responseType = responseType;

        return {
            requestUrl: this.constructRequestUrl(originalRequestUrl, config),
            config,
        };
    }

    private setupConfigAndProxyForRequest(
        requestUrl: string,
        headers: HttpRequestHeaders = {},
    ): AxiosRequestConfig {
        const config: AxiosRequestConfig = {
            headers: { ...headers },
            validateStatus: () => true,
        };

        const proxy = this.loadProxyConfig();

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
            if (requestUrl.startsWith("https")) {
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

    private loadProxyConfig(): string | undefined {
        let proxy = this.dependencies.getProxyConfig?.();

        if (!proxy) {
            this.logger?.debug(
                "Workspace HTTP config didn't contain a proxy endpoint. Checking environment variables.",
            );
            proxy = this.loadEnvironmentProxyValue();
        }

        return proxy;
    }

    private constructRequestUrl(requestUrl: string, config: AxiosRequestConfig): string {
        if (!config.proxy) {
            const parsedRequestUrl = new URL(requestUrl);
            const port =
                parsedRequestUrl.port ||
                (parsedRequestUrl.protocol?.startsWith("https") ? HTTPS_PORT : HTTP_PORT);

            return `${parsedRequestUrl.protocol}//${parsedRequestUrl.hostname}:${port}${parsedRequestUrl.pathname}${parsedRequestUrl.search}`;
        }
        return requestUrl;
    }

    private loadEnvironmentProxyValue(): string | undefined {
        const HTTP_PROXY = "HTTP_PROXY";
        const HTTPS_PROXY = "HTTPS_PROXY";

        if (!process) {
            this.logger?.debug(
                "No process object found, unable to read environment variables for proxy.",
            );
            return undefined;
        }

        if (process.env[HTTP_PROXY] || process.env[HTTP_PROXY.toLowerCase()]) {
            this.logger?.debug("Loading proxy value from HTTP_PROXY environment variable.");
            return process.env[HTTP_PROXY] || process.env[HTTP_PROXY.toLowerCase()];
        } else if (process.env[HTTPS_PROXY] || process.env[HTTPS_PROXY.toLowerCase()]) {
            this.logger?.debug("Loading proxy value from HTTPS_PROXY environment variable.");
            return process.env[HTTPS_PROXY] || process.env[HTTPS_PROXY.toLowerCase()];
        }

        this.logger?.debug(
            "No proxy value found in either HTTPS_PROXY or HTTP_PROXY environment variables.",
        );
        return undefined;
    }

    private createProxyAgent(
        requestUrl: string,
        proxy: string,
        proxyStrictSSL?: boolean,
    ): ProxyAgent {
        const agentOptions = this.getProxyAgentOptions(new URL(requestUrl), proxy, proxyStrictSSL);
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

        const isHttpsRequest = requestUrl.startsWith("https");
        return {
            agent: this.createTunnelingAgent(isHttpsRequest, isHttpsProxy, tunnelOptions),
        };
    }

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

    private getProxyAgentOptions(
        requestUrl: URL,
        proxy?: string,
        strictSSL?: boolean,
    ): ProxyAgentOptions | undefined {
        const proxyUrl = proxy || this.getSystemProxyUrl(requestUrl);

        if (!proxyUrl) {
            return undefined;
        }

        const proxyEndpoint = new URL(proxyUrl);
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

    private getSystemProxyUrl(requestUrl: URL): string | undefined {
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
