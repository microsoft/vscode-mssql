/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as tunnel from "tunnel";
import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import axios, { AxiosRequestConfig, AxiosResponse, RawAxiosResponseHeaders } from "axios";
import { Readable } from "stream";
import { ILogger } from "../models/interfaces";

const UnableToGetProxyAgentOptionsMessage = "Unable to read proxy agent options to get tenants.";

export interface IHttpClientMessages {
    missingProtocolWarning(proxy: string): string;
    unparseableWarning(proxy: string, errorMessage: string): string;
    unableToGetProxyAgentOptions: string;
}

export interface IHttpClientDependencies {
    getProxyConfig?: () => string | undefined;
    getProxyStrictSSL?: () => boolean | undefined;
    parseUriScheme?: (value: string) => string | undefined;
    showWarningMessage?: (message: string) => void;
    getErrorMessage?: (error: unknown) => string;
    messages?: IHttpClientMessages;
}

/**
 * Core HTTP client class that is independent of VS Code APIs and can be used in any context, like the build/pipeline infrastructure.
 * The HttpClient class extends this core class and provides VS Code specific implementations of the dependencies.
 */
export class HttpClientCore {
    constructor(
        protected readonly logger?: ILogger,
        private readonly dependencies: IHttpClientDependencies = {},
    ) {}

    /**
     * Makes a GET request to the specified URL with the provided token.
     */
    public async makeGetRequest<TResponse>(
        requestUrl: string,
        token: string,
    ): Promise<AxiosResponse<TResponse>> {
        const request = this.setupRequest(requestUrl, token);

        const response: AxiosResponse = await axios.get<TResponse>(
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
     * Makes a POST request to the specified URL with the provided token and payload.
     */
    public async makePostRequest<TResponse, TPayload>(
        requestUrl: string,
        token: string,
        payload: TPayload,
    ): Promise<AxiosResponse<TResponse>> {
        const request = this.setupRequest(requestUrl, token);

        const response: AxiosResponse = await axios.post<TResponse>(
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
     * Downloads a file from the specified URL to the destination file descriptor, with optional callbacks for headers and data received.
     * @param requestUrl request URL to download the file from
     * @param destinationFd file descriptor of the destination file to write the downloaded content to
     * @param options optional callbacks for headers and data received
     * @returns result of the download operation, including the HTTP status and response headers
     */
    public async downloadFile(
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
            response = await axios.get<Readable>(request.requestUrl, requestConfig);
        } catch (error: unknown) {
            throw new HttpDownloadError("request", error as NodeJS.ErrnoException);
        }

        options?.onHeaders?.(response.headers);
        if (response.status !== 200) {
            response.data.destroy();
            return {
                status: response.status,
                headers: response.headers,
            };
        }

        await new Promise<void>((resolve, reject) => {
            const tmpFile = fs.createWriteStream("", { fd: destinationFd });

            response.data.on("data", (data: Buffer) => {
                options?.onData?.(data);
            });

            response.data.on("error", (err: NodeJS.ErrnoException) => {
                reject(new HttpDownloadError("response", err));
            });

            tmpFile.on("error", (err: NodeJS.ErrnoException) => {
                reject(new HttpDownloadError("response", err));
            });

            response.data.on("end", () => {
                resolve();
            });

            response.data.pipe(tmpFile, { end: false });
        });

        return {
            status: response.status,
            headers: response.headers,
        };
    }

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
                message = `Proxy settings found, but without a protocol (e.g. http://): '${proxy}'.  You may encounter connection issues while using the MSSQL extension.`;
                localizedMessage = this.dependencies.messages?.missingProtocolWarning(proxy);
            }
        } catch (err) {
            const errorMessage = this.getErrorMessage(err);
            message = `Proxy settings found, but encountered an error while parsing the URL: '${proxy}'.  You may encounter connection issues while using the MSSQL extension.  Error: ${errorMessage}`;
            localizedMessage = this.dependencies.messages?.unparseableWarning(proxy, errorMessage);
        }

        if (message) {
            if (localizedMessage) {
                this.dependencies.showWarningMessage?.(localizedMessage);
            }
            this.logger?.warn(message);
        }
    }

    protected setupRequest(
        requestUrl: string,
        token?: string,
    ): { requestUrl: string; config: AxiosRequestConfig } {
        const config = this.setupConfigAndProxyForRequest(requestUrl, token);
        return {
            requestUrl: this.constructRequestUrl(requestUrl, config),
            config,
        };
    }

    /**
     * Builds an Axios request config with headers, auth token, and proxy/agent settings.
     *
     * - Adds JSON content type and bearer token headers.
     * - Disables Axios status throwing (`validateStatus` always true).
     * - Checks VS Code HTTP proxy settings or environment variables.
     * - If a proxy is found, disables Axios' default proxy handling
     *   and attaches a custom HTTP/HTTPS agent.
     *
     * @param requestUrl - The target request URL.
     * @param token - Bearer token for the Authorization header.
     * @returns AxiosRequestConfig with headers and proxy/agent configuration.
     */
    private setupConfigAndProxyForRequest(requestUrl: string, token?: string): AxiosRequestConfig {
        const headers: { "Content-Type": string; Authorization?: string } = {
            "Content-Type": "application/json",
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        const config: AxiosRequestConfig = {
            headers,
            validateStatus: () => true, // Never throw
        };

        const proxy = this.loadProxyConfig();

        if (proxy) {
            this.logger?.verbose(
                "Proxy endpoint found in environment variables or workspace configuration.",
            );

            // Turning off automatic proxy detection to avoid issues with tunneling agent by setting proxy to false.
            // https://github.com/axios/axios/blob/bad6d8b97b52c0c15311c92dd596fc0bff122651/lib/adapters/http.js#L85
            config.proxy = false;

            const agent = this.createProxyAgent(
                requestUrl,
                proxy,
                this.dependencies.getProxyStrictSSL?.(),
            );
            if (agent.isHttps) {
                config.httpsAgent = agent.agent;
            } else {
                config.httpAgent = agent.agent;
            }
        }
        return config;
    }

    /**
     * Attempts to read proxy configuration in priority order:
     * 1. VS Code settings (http.proxy config key)
     * 2. environment variables (HTTP_PROXY, then HTTPS_PROXY)
     * @returns found proxy information
     */
    private loadProxyConfig(): string | undefined {
        let proxy: string | undefined = this.dependencies.getProxyConfig?.();

        if (!proxy) {
            this.logger?.verbose(
                "Workspace HTTP config didn't contain a proxy endpoint. Checking environment variables.",
            );
            proxy = this.loadEnvironmentProxyValue();
        }

        return proxy;
    }

    /**
     * Constructs a request URL that explicitly includes the port number when no proxy is configured.
     *
     * If a proxy is configured in the request config, the original URL is returned unchanged.
     *
     * @param requestUrl - The original request URL.
     * @param config - The Axios request configuration, which may contain proxy settings.
     * @returns A URL string with the appropriate port included if no proxy is configured,
     *          otherwise the original request URL.
     */
    private constructRequestUrl(requestUrl: string, config: AxiosRequestConfig): string {
        if (!config.proxy) {
            // Request URL will include HTTPS port 443 ('https://management.azure.com:443/tenants?api-version=2019-11-01'), so
            // that Axios doesn't try to reach this URL with HTTP port 80 on HTTP proxies, which result in an error. See https://github.com/axios/axios/issues/925

            const HTTPS_PORT = 443;
            const HTTP_PORT = 80;
            const parsedRequestUrl = new URL(requestUrl);
            const port = parsedRequestUrl.protocol?.startsWith("https") ? HTTPS_PORT : HTTP_PORT;

            return `${parsedRequestUrl.protocol}//${parsedRequestUrl.hostname}:${port}${parsedRequestUrl.pathname}${parsedRequestUrl.search}`;
        }
        return requestUrl;
    }

    private loadEnvironmentProxyValue(): string | undefined {
        const HTTP_PROXY = "HTTP_PROXY";
        const HTTPS_PROXY = "HTTPS_PROXY";

        if (!process) {
            this.logger?.verbose(
                "No process object found, unable to read environment variables for proxy.",
            );
            return undefined;
        }

        if (process.env[HTTP_PROXY] || process.env[HTTP_PROXY.toLowerCase()]) {
            this.logger?.verbose("Loading proxy value from HTTP_PROXY environment variable.");

            return process.env[HTTP_PROXY] || process.env[HTTP_PROXY.toLowerCase()];
        } else if (process.env[HTTPS_PROXY] || process.env[HTTPS_PROXY.toLowerCase()]) {
            this.logger?.verbose("Loading proxy value from HTTPS_PROXY environment variable.");

            return process.env[HTTPS_PROXY] || process.env[HTTPS_PROXY.toLowerCase()];
        }

        this.logger?.verbose(
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

        let tunnelOptions: tunnel.HttpsOverHttpsOptions = {};
        if (typeof agentOptions.auth === "string" && agentOptions.auth) {
            tunnelOptions = {
                proxy: {
                    proxyAuth: agentOptions.auth,
                    host: agentOptions.host,
                    port: Number(agentOptions.port),
                },
            };
        } else {
            tunnelOptions = {
                proxy: {
                    host: agentOptions.host,
                    port: Number(agentOptions.port),
                },
            };
        }

        const isHttpsRequest = requestUrl.startsWith("https");
        const isHttpsProxy = proxy.startsWith("https");
        return {
            isHttps: isHttpsProxy,
            agent: this.createTunnelingAgent(isHttpsRequest, isHttpsProxy, tunnelOptions),
        };
    }

    private createTunnelingAgent(
        isHttpsRequest: boolean,
        isHttpsProxy: boolean,
        tunnelOptions: tunnel.HttpsOverHttpsOptions,
    ): http.Agent | https.Agent {
        if (isHttpsRequest && isHttpsProxy) {
            this.logger?.verbose("Creating https request over https proxy tunneling agent");
            return tunnel.httpsOverHttps(tunnelOptions);
        } else if (isHttpsRequest && !isHttpsProxy) {
            this.logger?.verbose("Creating https request over http proxy tunneling agent");
            return tunnel.httpsOverHttp(tunnelOptions);
        } else if (!isHttpsRequest && isHttpsProxy) {
            this.logger?.verbose("Creating http request over https proxy tunneling agent");
            return tunnel.httpOverHttps(tunnelOptions);
        } else {
            this.logger?.verbose("Creating http request over http proxy tunneling agent");
            return tunnel.httpOverHttp(tunnelOptions);
        }
    }

    /*
     * Returns the proxy agent using the proxy url in the parameters or the system proxy. Returns null if no proxy found
     */
    private getProxyAgentOptions(
        requestURL: URL,
        proxy?: string,
        strictSSL?: boolean,
    ): ProxyAgentOptions | undefined {
        const proxyURL = proxy || this.getSystemProxyURL(requestURL);

        if (!proxyURL) {
            return undefined;
        }

        const proxyEndpoint = new URL(proxyURL);
        if (!/^https?:$/.test(proxyEndpoint.protocol!)) {
            return undefined;
        }

        const auth =
            proxyEndpoint.username || proxyEndpoint.password
                ? `${proxyEndpoint.username}:${proxyEndpoint.password}`
                : undefined;

        return {
            host: proxyEndpoint.hostname,
            port: Number(proxyEndpoint.port),
            auth,
            rejectUnauthorized: typeof strictSSL === "boolean",
        };
    }

    private getSystemProxyURL(requestURL: URL): string | undefined {
        if (requestURL.protocol === "http:") {
            return process.env.HTTP_PROXY || process.env.http_proxy || undefined;
        } else if (requestURL.protocol === "https:") {
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

    private getErrorMessage(error: unknown): string {
        if (this.dependencies.getErrorMessage) {
            return this.dependencies.getErrorMessage(error);
        }

        if (error instanceof Error) {
            return typeof error.message === "string" ? error.message : "";
        }
        if (typeof error === "string") {
            return error;
        }
        return `${JSON.stringify(error, undefined, "\t")}`;
    }
}

interface ProxyAgent {
    isHttps: boolean;
    agent: http.Agent | https.Agent;
}

interface ProxyAgentOptions {
    auth: string | undefined;
    secureProxy?: boolean;
    host?: string | null;
    path?: string | null;
    port?: string | number | null;
    rejectUnauthorized: boolean;
}

export class HttpDownloadError extends Error {
    constructor(
        public phase: "request" | "response",
        public innerError: NodeJS.ErrnoException,
    ) {
        super(innerError.message);
    }
}

export interface IDownloadFileOptions {
    onHeaders?: (headers: RawAxiosResponseHeaders) => void;
    onData?: (data: Buffer) => void;
}

export interface IDownloadFileResult {
    status: number;
    headers: RawAxiosResponseHeaders;
}
