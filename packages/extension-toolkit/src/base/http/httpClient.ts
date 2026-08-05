/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { Readable } from "stream";
import axios, { AxiosRequestConfig, AxiosResponse, RawAxiosResponseHeaders } from "axios";
import * as tunnel from "tunnel";
import { getErrorMessage } from "../common";

const UnableToGetProxyAgentOptionsMessage = "Unable to read proxy agent options.";
const HTTPS_PORT = 443;
const HTTP_PORT = 80;

/** Optional logger contract used by the HTTP client for diagnostics and errors. */
export interface IHttpClientLogger {
    /** Writes a diagnostic message. */
    debug(message: string, ...args: unknown[]): void;

    /** Writes a warning message. */
    warn(message: string, ...args: unknown[]): void;

    /** Writes an error message. */
    error(message: string, ...args: unknown[]): void;

    /**
     * Writes a message with explicit PII sanitization metadata.
     */
    piiSanitized(
        message: unknown,
        objectsToSanitize: { name: string; objOrArray: unknown | unknown[] }[],
        stringsToShorten: { name: string; value: string }[],
        ...values: unknown[]
    ): void;
}

/** Localized proxy warning messages used by the HTTP client. */
export interface IHttpClientMessages {
    /** Builds a warning when a proxy is configured without a protocol. */
    missingProtocolWarning(proxy: string): string;

    /** Builds a warning when a proxy URL cannot be parsed. */
    unparseableWarning(proxy: string, errorMessage: string): string;

    /** Message used when a proxy agent cannot be constructed. */
    unableToGetProxyAgentOptions: string;
}

/** Runtime integration points for proxy settings and warning presentation. */
export interface IHttpClientDependencies {
    /** Returns the configured proxy endpoint, if available. */
    getProxyConfig?: () => string | undefined;

    /** Returns whether proxy certificates should be validated. */
    getProxyStrictSSL?: () => boolean | undefined;

    /** Parses a URI and returns its scheme. */
    parseUriScheme?: (value: string) => string | undefined;

    /** Displays a warning message to the user. */
    showWarningMessage?: (message: string) => void;

    /** Localized proxy warning messages. */
    messages?: IHttpClientMessages;
}

/** Progress payload for download callbacks. */
export interface IDownloadProgress {
    /** Number of bytes downloaded so far. */
    downloadedBytes: number;

    /** Total bytes, when known from response headers. */
    totalBytes?: number;

    /** Percentage in the range `[0, 100]`, when total bytes are known. */
    percentage?: number;
}

/** Optional settings for file download operations. */
export interface IDownloadFileOptions {
    /** Receives progress updates while the response stream is being written. */
    onProgress?: (progress: IDownloadProgress) => void;
}

/** Result returned by a completed download operation. */
export interface IDownloadFileResult {
    /** HTTP response status code. */
    status: number;

    /** Response headers from the download request. */
    headers: RawAxiosResponseHeaders;
}

/**
 * Shared HTTP client with proxy support, optional diagnostics, and stream downloads.
 */
export class HttpClient {
    /**
     * Creates an HTTP client.
     *
     * @param logger Optional logger for diagnostics and warnings.
     * @param dependencies Optional host-specific proxy and UI integrations.
     */
    constructor(
        protected readonly logger?: IHttpClientLogger,
        private readonly dependencies: IHttpClientDependencies = {},
    ) {}

    /**
     * Sends an HTTP GET request.
     *
     * @param requestUrl Target URL.
     * @param token Bearer token sent in the `Authorization` header.
     */
    public async makeGetRequest<TResponse>(
        requestUrl: string,
        token: string,
    ): Promise<AxiosResponse<TResponse>> {
        const request = this.setupRequest(requestUrl, token);

        const response: AxiosResponse = await this.get<TResponse>(
            request.requestUrl,
            request.config,
        );
        this.logger?.piiSanitized(
            "GET request ",
            [
                {
                    name: "response",
                    objOrArray:
                        (response.data?.value as TResponse) ??
                        (response.data as { value: TResponse }),
                },
            ],
            [],
            request.requestUrl,
        );
        return response;
    }

    /**
     * Sends an HTTP POST request.
     *
     * @param requestUrl Target URL.
     * @param token Bearer token sent in the `Authorization` header.
     * @param payload JSON payload to post.
     */
    public async makePostRequest<TResponse, TPayload>(
        requestUrl: string,
        token: string,
        payload: TPayload,
    ): Promise<AxiosResponse<TResponse>> {
        const request = this.setupRequest(requestUrl, token);

        const response: AxiosResponse = await this.post<TResponse, TPayload>(
            request.requestUrl,
            payload,
            request.config,
        );
        this.logger?.piiSanitized(
            "POST request ",
            [{ name: "response", objOrArray: response.data }],
            [],
            request.requestUrl,
        );
        return response;
    }

    /**
     * Downloads a URL to a path or an open file descriptor.
     * The caller retains ownership of a supplied file descriptor.
     *
     * @param requestUrl Target URL.
     * @param destination Output path or open file descriptor.
     * @param options Optional download settings including progress callback.
     */
    public async downloadFile(
        requestUrl: string,
        destination: string | number,
        options?: IDownloadFileOptions,
    ): Promise<IDownloadFileResult> {
        const destinationFd =
            typeof destination === "string" ? fs.openSync(destination, "w") : destination;

        try {
            return await this.downloadToFileDescriptor(requestUrl, destinationFd, options);
        } finally {
            if (typeof destination === "string") {
                fs.closeSync(destinationFd);
            }
        }
    }

    /**
     * Validates proxy settings and emits warnings for invalid values.
     */
    public warnOnInvalidProxySettings(): void {
        const proxy = this.loadProxyConfig();
        if (!proxy) {
            return;
        }

        let message = undefined;
        let localizedMessage = undefined;

        try {
            const scheme = this.dependencies.parseUriScheme
                ? this.dependencies.parseUriScheme(proxy)
                : new URL(proxy).protocol;

            if (!scheme) {
                message = `Proxy settings found, but without a protocol (e.g. http://): '${proxy}'.  You may encounter connection issues while using this extension.`;
                localizedMessage = this.dependencies.messages?.missingProtocolWarning(proxy);
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            message = `Proxy settings found, but encountered an error while parsing the URL: '${proxy}'.  You may encounter connection issues while using this extension.  Error: ${errorMessage}`;
            localizedMessage = this.dependencies.messages?.unparseableWarning(proxy, errorMessage);
        }

        if (message) {
            if (localizedMessage) {
                this.dependencies.showWarningMessage?.(localizedMessage);
            }
            this.logger?.warn(message);
        }
    }

    private setupRequest(
        requestUrl: string,
        token?: string,
    ): { requestUrl: string; config: AxiosRequestConfig } {
        const config = this.setupConfigAndProxyForRequest(requestUrl, token);
        return {
            requestUrl: this.constructRequestUrl(requestUrl, config),
            config,
        };
    }

    private async downloadToFileDescriptor(
        requestUrl: string,
        destinationFd: number,
        options?: IDownloadFileOptions,
    ): Promise<IDownloadFileResult> {
        const request = this.setupRequest(requestUrl);
        const requestConfig: AxiosRequestConfig = {
            ...request.config,
            responseType: "stream",
        };

        let response: AxiosResponse<Readable>;
        try {
            response = await this.get<Readable>(request.requestUrl, requestConfig);
        } catch (error) {
            throw new HttpDownloadError("request", error as NodeJS.ErrnoException);
        }

        const totalBytes = this.getContentLength(response.headers["content-length"]);
        let downloadedBytes = 0;
        options?.onProgress?.({
            downloadedBytes,
            totalBytes,
            percentage: totalBytes === undefined ? undefined : 0,
        });

        if (response.status !== 200) {
            response.data.destroy();
            return {
                status: response.status,
                headers: response.headers,
            };
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

        return {
            status: response.status,
            headers: response.headers,
        };
    }

    private setupConfigAndProxyForRequest(requestUrl: string, token?: string): AxiosRequestConfig {
        const headers: { "Content-Type": string; Authorization?: string } = {
            "Content-Type": "application/json",
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        const config: AxiosRequestConfig = {
            headers,
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

    private get<TResponse>(
        requestUrl: string,
        config: AxiosRequestConfig,
    ): Promise<AxiosResponse<TResponse>> {
        return axios.get<TResponse>(requestUrl, config);
    }

    private post<TResponse, TPayload>(
        requestUrl: string,
        payload: TPayload,
        config: AxiosRequestConfig,
    ): Promise<AxiosResponse<TResponse>> {
        return axios.post<TResponse>(requestUrl, payload, config);
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
            throw new Error(
                this.dependencies.messages?.unableToGetProxyAgentOptions ??
                    UnableToGetProxyAgentOptionsMessage,
            );
        }

        const tunnelOptions: tunnel.HttpsOverHttpsOptions = {
            proxy: {
                host: agentOptions.host,
                port: Number(agentOptions.port),
                ...(agentOptions.auth ? { proxyAuth: agentOptions.auth } : {}),
            },
        };

        const isHttpsRequest = requestUrl.startsWith("https");
        const isHttpsProxy = proxy.startsWith("https");
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

interface ProxyAgent {
    agent: http.Agent | https.Agent;
}

interface ProxyAgentOptions {
    auth: string | undefined;
    host?: string | null;
    port?: string | number | null;
    rejectUnauthorized: boolean;
}

/** Error raised by `downloadFile` when request or response streaming fails. */
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
