/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import { Readable } from "stream";
import axios, { AxiosRequestConfig, AxiosResponse, RawAxiosResponseHeaders } from "axios";
import * as tunnel from "tunnel";
import {
    createEnvironmentProxyResolver,
    getProxyPort,
    getRedactedProxyDescription,
    IProxyAgentFactory,
    IProxyAgentOptions,
    IProxyConfiguration,
    IProxyResolver,
} from "./proxy";

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

/** Construction options for {@link HttpClient}. */
export interface IHttpClientOptions {
    /** Optional logger for credential-free HTTP diagnostics. */
    readonly logger?: IHttpClientLogger;

    /** Resolves the proxy for each request. Defaults to the environment variable resolver. */
    readonly proxyResolver?: IProxyResolver;

    /** Creates proxy agents. Primarily an injection point for tests. */
    readonly proxyAgentFactory?: IProxyAgentFactory;
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
    protected readonly logger?: IHttpClientLogger;

    private readonly _proxyResolver: IProxyResolver;
    private readonly _proxyAgentFactory: IProxyAgentFactory;

    /**
     * Creates an HTTP client.
     *
     * @param options Optional logger, proxy resolver, and proxy agent factory.
     */
    constructor(options: IHttpClientOptions = {}) {
        this.logger = options.logger;
        this._proxyResolver = options.proxyResolver ?? createEnvironmentProxyResolver();
        this._proxyAgentFactory = options.proxyAgentFactory ?? defaultProxyAgentFactory;
    }

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

    private setupRequest(
        requestUrl: string,
        token?: string,
    ): { requestUrl: string; config: AxiosRequestConfig } {
        const config = this.setupConfigAndProxyForRequest(requestUrl, token);
        return {
            requestUrl,
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
        const target = new URL(requestUrl);
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

        this.applyProxy(config, target);
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

    private applyProxy(config: AxiosRequestConfig, target: URL): void {
        // Proxy selection is owned entirely by the resolver, so Axios's environment handling is
        // always disabled. This is also what allows NO_PROXY to switch a request back to direct.
        config.proxy = false;

        const agent = this.resolveProxyAgent(target);
        if (target.protocol === "https:") {
            config.httpsAgent = agent;
        } else {
            config.httpAgent = agent;
        }

        config.beforeRedirect = (options) => {
            const redirectTarget = new URL(options.href);
            const redirectAgent = this.resolveProxyAgent(redirectTarget);
            const scheme = redirectTarget.protocol.slice(0, -1);
            const agents = options.agents as Record<string, unknown> | undefined;

            if (agents) {
                agents[scheme] = redirectAgent;
            } else {
                options.agents = { [scheme]: redirectAgent };
            }

            options.agent = redirectAgent;
        };
    }

    private resolveProxyAgent(target: URL): unknown | undefined {
        let proxy: IProxyConfiguration | undefined;
        try {
            proxy = this._proxyResolver.resolve(target);
        } catch (error) {
            this.logger?.error("Unable to resolve the configured proxy.");
            throw new ProxyConfigurationError("Unable to resolve the configured proxy.", error);
        }

        if (!proxy) {
            return undefined;
        }

        this.logger?.debug(
            `Routing request through ${proxy.source} proxy ${getRedactedProxyDescription(proxy.url)}.`,
        );

        try {
            return this.createProxyAgent(target, proxy);
        } catch (error) {
            if (error instanceof ProxyConfigurationError) {
                throw error;
            }

            this.logger?.error("Unable to construct the configured proxy agent.");
            throw new ProxyConfigurationError(
                "Unable to construct the configured proxy agent.",
                error,
            );
        }
    }

    private createProxyAgent(target: URL, proxy: IProxyConfiguration): unknown {
        const isHttpsProxy = proxy.url.protocol === "https:";
        const credentials =
            proxy.url.username || proxy.url.password
                ? `${decodeProxyCredential(proxy.url.username)}:${decodeProxyCredential(proxy.url.password)}`
                : undefined;

        const options: IProxyAgentOptions = {
            proxy: {
                host: proxy.url.hostname,
                port: getProxyPort(proxy.url),
                ...(credentials ? { proxyAuth: credentials } : {}),
                // This applies to the proxy connection only. Destination certificates remain
                // validated by the tunnel agent.
                ...(isHttpsProxy ? { rejectUnauthorized: proxy.rejectUnauthorized } : {}),
            },
        };

        if (target.protocol === "https:") {
            return isHttpsProxy
                ? this._proxyAgentFactory.httpsOverHttps(options)
                : this._proxyAgentFactory.httpsOverHttp(options);
        }

        return isHttpsProxy
            ? this._proxyAgentFactory.httpOverHttps(options)
            : this._proxyAgentFactory.httpOverHttp(options);
    }

    private getContentLength(header: unknown): number | undefined {
        if (Array.isArray(header)) {
            return this.getContentLength(header[0]);
        }

        const value = typeof header === "number" ? header : Number.parseInt(`${header}`, 10);
        return Number.isFinite(value) && value > 0 ? value : undefined;
    }
}

const defaultProxyAgentFactory: IProxyAgentFactory = {
    httpOverHttp: (options) => tunnel.httpOverHttp(toAgentOptions(options)),
    httpOverHttps: (options) => tunnel.httpOverHttps(toAgentOptions(options)),
    httpsOverHttp: (options) => tunnel.httpsOverHttp(toAgentOptions(options)),
    httpsOverHttps: (options) => tunnel.httpsOverHttps(toAgentOptions(options)),
};

function toAgentOptions(options: IProxyAgentOptions): tunnel.HttpsOverHttpsOptions {
    const proxy: tunnel.HttpsProxyOptions & { rejectUnauthorized?: boolean } = {
        host: options.proxy.host,
        port: options.proxy.port,
    };

    if (options.proxy.proxyAuth) {
        proxy.proxyAuth = options.proxy.proxyAuth;
    }

    if (options.proxy.rejectUnauthorized !== undefined) {
        proxy.rejectUnauthorized = options.proxy.rejectUnauthorized;
    }

    return { proxy };
}

function decodeProxyCredential(value: string): string {
    return decodeURIComponent(value);
}

/** Error raised when a configured proxy cannot be resolved or its agent cannot be constructed. */
export class ProxyConfigurationError extends Error {
    public override readonly name = "ProxyConfigurationError";

    constructor(
        message: string,
        public readonly cause: unknown,
    ) {
        super(message);
    }
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
