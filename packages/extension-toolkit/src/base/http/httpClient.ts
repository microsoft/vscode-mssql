/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { Readable, Transform, Writable } from "stream";
import { pipeline } from "stream/promises";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import * as tunnel from "tunnel";
import { getErrorMessage } from "../common";
import { getErrorCode, HttpClientError } from "./httpErrors";
import { createHttpHeaders, IHttpHeaders } from "./httpHeaders";
import {
    HttpRequestHeaders,
    IDownloadOptions,
    IDownloadResult,
    IHttpClientLogger,
    IHttpRequest,
    IHttpRequestOptions,
    IHttpResponse,
} from "./httpTypes";
import {
    createEnvironmentProxyResolver,
    getProxyPort,
    getRedactedProxyDescription,
    IProxyAgentFactory,
    IProxyAgentOptions,
    IProxyConfiguration,
    IProxyResolver,
} from "./proxy";

/** Construction options for {@link HttpClient}. */
export interface IHttpClientOptions {
    /** Optional logger for credential-free HTTP diagnostics. */
    readonly logger?: IHttpClientLogger;

    /** Resolves the proxy for each request. Defaults to the environment variable resolver. */
    readonly proxyResolver?: IProxyResolver;

    /** Creates proxy agents. Primarily an injection point for tests. */
    readonly proxyAgentFactory?: IProxyAgentFactory;
}

/**
 * Transport-neutral HTTP client with proxy support and staged file downloads.
 *
 * Behavior that callers can rely on:
 * - Every HTTP status resolves, including 4xx and 5xx. Only transport, timeout, cancellation,
 *   destination, and stream failures reject, always with an {@link HttpClientError}.
 * - Response generics are compile-time assertions only; no runtime schema validation is done.
 * - Response header names are case-insensitive.
 * - Proxy precedence is the host-provided proxy setting, then the environment, then direct.
 * - Only `http:` and `https:` proxies are supported.
 * - Requests are never retried automatically.
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
     * Sends an HTTP request. This is the canonical request path; every other request helper
     * delegates to it.
     *
     * @param request Method, URL, headers, and optional body.
     * @returns The response, including non-success statuses.
     * @throws {HttpClientError} When the request fails, times out, or is cancelled.
     */
    public async request<TResponse = unknown, TBody = undefined>(
        request: IHttpRequest<TBody>,
    ): Promise<IHttpResponse<TResponse>> {
        const cancellation = createRequestCancellation(request.signal, request.timeoutMs);
        let requestConfig: { config: AxiosRequestConfig; target: URL };
        try {
            requestConfig = this.createRequestConfig(request, undefined, cancellation.signal);
        } catch (error) {
            cancellation.dispose();
            throw error;
        }

        const { config, target } = requestConfig;
        const startedAt = Date.now();

        let response: AxiosResponse<TResponse>;
        try {
            response = await axios.request<TResponse>(config);
        } catch (error) {
            const failure = toRequestError(error, cancellation);
            this.logger?.error(
                `HTTP ${request.method} ${describeTarget(target)} failed after ${Date.now() - startedAt}ms: ${failure.kind}${failure.code ? ` (${failure.code})` : ""}.`,
            );
            throw failure;
        } finally {
            cancellation.dispose();
        }

        this.logger?.debug(
            `HTTP ${request.method} ${describeTarget(target)} responded ${response.status} in ${Date.now() - startedAt}ms.`,
        );

        return toHttpResponse<TResponse>(response);
    }

    /**
     * Sends an HTTP GET request. No content type is added automatically.
     *
     * @param url Target URL.
     * @param options Headers, cancellation signal, and timeout.
     */
    public get<TResponse = unknown>(
        url: string | URL,
        options?: IHttpRequestOptions,
    ): Promise<IHttpResponse<TResponse>> {
        return this.request<TResponse, undefined>({ ...options, method: "GET", url });
    }

    /**
     * Sends an HTTP POST request with a JSON body.
     *
     * `Content-Type: application/json` and `Accept: application/json` are added only when the
     * caller has not already supplied them.
     *
     * @param url Target URL.
     * @param body Payload to serialize as JSON.
     * @param options Headers, cancellation signal, and timeout.
     */
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

    /**
     * Downloads a URL into a file path.
     *
     * The response is staged in a temporary sibling file and moved over the destination only
     * after the download completes successfully, so an existing file is never truncated by a
     * non-success response, a stream failure, or a cancellation. Every descriptor and stream
     * created here is owned and closed by this method.
     *
     * @param url Target URL.
     * @param destinationPath Final path to write.
     * @param options Headers, cancellation signal, timeout, and progress callback.
     * @returns The response status and headers. Non-success responses leave the destination alone.
     * @throws {HttpClientError} When the request, response stream, progress callback, or
     * destination replacement fails.
     */
    public async downloadToPath(
        url: string | URL,
        destinationPath: string,
        options?: IDownloadOptions,
    ): Promise<IDownloadResult> {
        const cancellation = createRequestCancellation(options?.signal, options?.timeoutMs);
        try {
            const download = await this.requestDownload(url, options, cancellation);
            if (!download.result.ok) {
                download.response.data.destroy();
                return download.result;
            }

            try {
                emitInitialProgress(download.totalBytes, options);
            } catch (error) {
                download.response.data.destroy();
                throw error;
            }

            const temporaryPath = createTemporarySiblingPath(destinationPath);
            try {
                const destinationStream = fs.createWriteStream(temporaryPath);
                await this.pipeResponse(
                    download.response.data,
                    destinationStream,
                    download.totalBytes,
                    options,
                    cancellation,
                );
                await waitForClose(destinationStream);
                await replaceFile(temporaryPath, destinationPath, this.logger);
            } catch (error) {
                await removeQuietly(temporaryPath, this.logger);
                throw error instanceof HttpClientError
                    ? error
                    : new HttpClientError(
                          "destination",
                          "Unable to replace the download destination.",
                          getErrorCode(error),
                          { cause: error },
                      );
            }

            return download.result;
        } finally {
            cancellation.dispose();
        }
    }

    /**
     * Downloads a URL into an already-open file descriptor.
     *
     * The descriptor remains owned by the caller: it is never closed by this method, on success
     * or on failure. Non-success responses are returned without writing anything.
     *
     * @param url Target URL.
     * @param destinationFd Open file descriptor to write into.
     * @param options Headers, cancellation signal, timeout, and progress callback.
     * @throws {HttpClientError} When the request, response stream, progress callback, or write
     * fails.
     */
    public async downloadToFileDescriptor(
        url: string | URL,
        destinationFd: number,
        options?: IDownloadOptions,
    ): Promise<IDownloadResult> {
        const cancellation = createRequestCancellation(options?.signal, options?.timeoutMs);
        try {
            const download = await this.requestDownload(url, options, cancellation);
            if (!download.result.ok) {
                download.response.data.destroy();
                return download.result;
            }

            try {
                emitInitialProgress(download.totalBytes, options);
            } catch (error) {
                download.response.data.destroy();
                throw error;
            }

            await this.pipeResponse(
                download.response.data,
                createFileDescriptorWritable(destinationFd),
                download.totalBytes,
                options,
                cancellation,
            );

            return download.result;
        } finally {
            cancellation.dispose();
        }
    }

    private async requestDownload(
        url: string | URL,
        options?: IDownloadOptions,
        cancellation?: IRequestCancellation,
    ): Promise<{
        response: AxiosResponse<Readable>;
        result: IDownloadResult;
        totalBytes: number | undefined;
    }> {
        const { config, target } = this.createRequestConfig(
            {
                method: "GET",
                url,
                headers: withDefaultHeaders(options?.headers, {
                    "Accept-Encoding": "identity",
                }),
            },
            "stream",
            cancellation?.signal,
        );
        config.decompress = false;

        let response: AxiosResponse<Readable>;
        try {
            response = await axios.request<Readable>(config);
        } catch (error) {
            const failure = toRequestError(error, cancellation);
            this.logger?.error(
                `Download of ${describeTarget(target)} failed: ${failure.kind}${failure.code ? ` (${failure.code})` : ""}.`,
            );
            throw failure;
        }

        const headers = createHttpHeaders(toHeaderRecord(response.headers));
        const result: IDownloadResult = {
            status: response.status,
            statusText: response.statusText ?? "",
            ok: isSuccessStatus(response.status),
            headers,
        };

        const contentEncodings = headers.getAll("content-encoding");
        if (
            result.ok &&
            contentEncodings.some((encoding) => encoding.trim().toLowerCase() !== "identity")
        ) {
            response.data.destroy();
            throw new HttpClientError(
                "response-stream",
                "The download response used an unsupported content encoding.",
                "ERR_UNSUPPORTED_CONTENT_ENCODING",
                { cause: undefined },
            );
        }

        this.logger?.debug(`Download of ${describeTarget(target)} responded ${response.status}.`);

        return { response, result, totalBytes: parseContentLength(headers) };
    }

    private async pipeResponse(
        source: Readable,
        destination: Writable,
        totalBytes: number | undefined,
        options?: IDownloadOptions,
        cancellation?: IRequestCancellation,
    ): Promise<void> {
        const onProgress = options?.onProgress;
        let downloadedBytes = 0;

        const progress = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                downloadedBytes += chunk.length;

                if (onProgress) {
                    try {
                        onProgress({ downloadedBytes, totalBytes });
                    } catch (error) {
                        callback(
                            new HttpClientError(
                                "progress-callback",
                                "The download progress callback threw an error.",
                                getErrorCode(error),
                                { cause: error },
                            ),
                        );
                        return;
                    }
                }

                callback(null, chunk);
            },
        });

        let sourceError: unknown;
        source.on("error", (error) => {
            sourceError = error;
        });

        let destinationError: unknown;
        destination.on("error", (error) => {
            destinationError = error;
        });

        try {
            await pipeline(source, progress, destination, { signal: cancellation?.signal });
        } catch (error) {
            throw toStreamError(error, destinationError, sourceError, cancellation);
        }

        if (totalBytes !== undefined && downloadedBytes !== totalBytes) {
            throw new HttpClientError(
                "response-stream",
                `The download ended after ${downloadedBytes} bytes but ${totalBytes} bytes were expected.`,
                "ERR_CONTENT_LENGTH_MISMATCH",
                { cause: undefined },
            );
        }
    }

    private createRequestConfig<TBody>(
        request: IHttpRequest<TBody>,
        responseType?: "stream",
        signal?: AbortSignal,
    ): { config: AxiosRequestConfig; target: URL } {
        const target = parseTargetUrl(request.url);

        const config: AxiosRequestConfig = {
            method: request.method,
            url: typeof request.url === "string" ? request.url : request.url.toString(),
            headers: { ...request.headers },
            validateStatus: () => true,
        };

        if (request.body !== undefined) {
            config.data = request.body;
        }

        if (signal) {
            config.signal = signal;
        }

        if (responseType) {
            config.responseType = responseType;
        }

        this.applyProxy(config, target);

        return { config, target };
    }

    private applyProxy(config: AxiosRequestConfig, target: URL): void {
        // Proxy selection is owned entirely by the resolver, so the transport's own environment
        // handling is always disabled.
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

            // `follow-redirects` normally selects this value from `agents`, but setting it here
            // also keeps the redirect options correct for transports with equivalent hooks.
            options.agent = redirectAgent;
        };
    }

    private resolveProxyAgent(target: URL): unknown | undefined {
        let proxy: IProxyConfiguration | undefined;
        try {
            proxy = this._proxyResolver.resolve(target);
        } catch (error) {
            const code = getErrorCode(error);
            this.logger?.error(
                `Unable to resolve the configured proxy${code ? ` (${code})` : ""}.`,
            );
            throw new HttpClientError(
                "proxy-configuration",
                "Unable to resolve the configured proxy.",
                getErrorCode(error),
                { cause: error },
            );
        }

        if (!proxy) {
            return undefined;
        }

        this.logger?.debug(
            `Routing request through ${proxy.source} proxy ${getRedactedProxyDescription(proxy.url)}.`,
        );

        let agent: unknown;
        try {
            agent = this.createProxyAgent(target, proxy);
        } catch (error) {
            if (error instanceof HttpClientError) {
                throw error;
            }

            const code = getErrorCode(error);
            this.logger?.error(
                `Unable to construct the configured proxy agent${code ? ` (${code})` : ""}.`,
            );
            throw new HttpClientError(
                "proxy-configuration",
                "Unable to construct the configured proxy agent.",
                code,
                { cause: error },
            );
        }

        return agent;
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
                // Applies to the proxy connection only; the destination certificate is always validated.
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

function toHttpResponse<TResponse>(response: AxiosResponse<TResponse>): IHttpResponse<TResponse> {
    return {
        data: response.data,
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

    const record: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
        record[name] = value;
    }

    return record;
}

function isSuccessStatus(status: number): boolean {
    return status >= 200 && status < 300;
}

function parseTargetUrl(url: string | URL): URL {
    if (url instanceof URL) {
        return url;
    }

    try {
        return new URL(url);
    } catch (error) {
        throw new HttpClientError(
            "network",
            "The request URL is not a valid absolute URL.",
            "ERR_INVALID_URL",
            { cause: error },
        );
    }
}

function describeTarget(target: URL): string {
    return target.origin;
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

function isAbortError(error: unknown): boolean {
    if (axios.isCancel(error)) {
        return true;
    }

    const code = getErrorCode(error);
    if (code === "ERR_CANCELED" || code === "ABORT_ERR") {
        return true;
    }

    return (error as { name?: unknown } | undefined)?.name === "AbortError";
}

interface IRequestCancellation {
    readonly signal: AbortSignal | undefined;
    readonly timedOut: boolean;
    dispose(): void;
}

function createRequestCancellation(
    callerSignal: AbortSignal | undefined,
    timeoutMs: number | undefined,
): IRequestCancellation {
    if (timeoutMs === undefined || timeoutMs === 0) {
        return {
            signal: callerSignal,
            timedOut: false,
            dispose: () => undefined,
        };
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);

    if (callerSignal?.aborted) {
        abortFromCaller();
    } else {
        callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    const timeout = setTimeout(
        () => {
            if (!controller.signal.aborted) {
                timedOut = true;
                controller.abort(new Error("The HTTP operation timed out."));
            }
        },
        Math.max(0, timeoutMs),
    );

    return {
        signal: controller.signal,
        get timedOut(): boolean {
            return timedOut;
        },
        dispose(): void {
            clearTimeout(timeout);
            callerSignal?.removeEventListener("abort", abortFromCaller);
        },
    };
}

function toRequestError(error: unknown, cancellation?: IRequestCancellation): HttpClientError {
    const httpClientError = findHttpClientError(error);
    if (httpClientError) {
        return httpClientError;
    }

    const code = getErrorCode(error);

    if (cancellation?.timedOut) {
        return new HttpClientError("timeout", "The HTTP request timed out.", code, {
            cause: error,
        });
    }

    if (isAbortError(error) || cancellation?.signal?.aborted) {
        return new HttpClientError("cancelled", "The HTTP request was cancelled.", code, {
            cause: error,
        });
    }

    if (code === "ECONNABORTED" || code === "ETIMEDOUT" || code === "ERR_TIMEOUT") {
        return new HttpClientError("timeout", "The HTTP request timed out.", code, {
            cause: error,
        });
    }

    return new HttpClientError("network", "The HTTP request failed.", code, { cause: error });
}

function findHttpClientError(error: unknown): HttpClientError | undefined {
    const visited = new Set<unknown>();
    let current = error;

    while (typeof current === "object" && current !== null && !visited.has(current)) {
        if (current instanceof HttpClientError) {
            return current;
        }

        visited.add(current);
        current = (current as { cause?: unknown }).cause;
    }

    return undefined;
}

function toStreamError(
    error: unknown,
    destinationError: unknown,
    sourceError: unknown,
    cancellation?: IRequestCancellation,
): HttpClientError {
    if (error instanceof HttpClientError) {
        return error;
    }

    const code = getErrorCode(error);

    if (cancellation?.timedOut) {
        return new HttpClientError("timeout", "The download timed out.", code, { cause: error });
    }

    if (isAbortError(error) || cancellation?.signal?.aborted) {
        return new HttpClientError("cancelled", "The download was cancelled.", code, {
            cause: error,
        });
    }

    if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
        return new HttpClientError("timeout", "The download timed out.", code, { cause: error });
    }

    // `pipeline` destroys the destination with the source's error, so a destination failure is
    // only genuine when the source did not fail with the same error first.
    if (destinationError !== undefined && error === destinationError && error !== sourceError) {
        return new HttpClientError(
            "destination",
            "Unable to write to the download destination.",
            code,
            { cause: error },
        );
    }

    return new HttpClientError("response-stream", "The download response stream failed.", code, {
        cause: error,
    });
}

function emitInitialProgress(totalBytes: number | undefined, options?: IDownloadOptions): void {
    if (!options?.onProgress) {
        return;
    }

    try {
        options.onProgress({ downloadedBytes: 0, totalBytes });
    } catch (error) {
        throw new HttpClientError(
            "progress-callback",
            "The download progress callback threw an error.",
            getErrorCode(error),
            { cause: error },
        );
    }
}

function parseContentLength(headers: IHttpHeaders): number | undefined {
    const raw = headers.get("content-length");
    if (raw === undefined || !/^\d+$/.test(raw.trim())) {
        return undefined;
    }

    const value = Number(raw.trim());
    if (!Number.isSafeInteger(value)) {
        return undefined;
    }

    return value;
}

function decodeProxyCredential(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch (error) {
        throw new HttpClientError(
            "proxy-configuration",
            "Unable to decode the configured proxy credentials.",
            getErrorCode(error),
            { cause: error },
        );
    }
}

function createFileDescriptorWritable(destinationFd: number): fs.WriteStream {
    return fs.createWriteStream("", {
        fd: destinationFd,
        autoClose: false,
    });
}

function createTemporarySiblingPath(destinationPath: string): string {
    const directory = path.dirname(destinationPath);
    const fileName = path.basename(destinationPath);
    return path.join(directory, `.${fileName}.${crypto.randomBytes(6).toString("hex")}.download`);
}

async function waitForClose(stream: fs.WriteStream): Promise<void> {
    if (stream.closed) {
        return;
    }

    await new Promise<void>((resolve) => {
        stream.once("close", resolve);
    });
}

async function replaceFile(
    temporaryPath: string,
    destinationPath: string,
    logger?: IHttpClientLogger,
): Promise<void> {
    const backupPath = `${destinationPath}.${crypto.randomBytes(6).toString("hex")}.bak`;
    let hasBackup = false;

    try {
        await fsPromises.rename(destinationPath, backupPath);
        hasBackup = true;
    } catch (error) {
        if (getErrorCode(error) !== "ENOENT") {
            throw error;
        }
    }

    try {
        await fsPromises.rename(temporaryPath, destinationPath);
    } catch (error) {
        if (hasBackup) {
            try {
                await fsPromises.rename(backupPath, destinationPath);
            } catch (restoreError) {
                logger?.error(
                    `Unable to restore the previous download destination: ${getErrorMessage(restoreError)}`,
                );
            }
        }
        throw error;
    }

    if (hasBackup) {
        try {
            await fsPromises.rm(backupPath, { force: true });
        } catch (cleanupError) {
            logger?.warn(
                `Unable to remove the replaced download backup file: ${getErrorMessage(cleanupError)}`,
            );
        }
    }
}

async function removeQuietly(filePath: string, logger?: IHttpClientLogger): Promise<void> {
    try {
        await fsPromises.rm(filePath, { force: true });
    } catch (error) {
        logger?.warn(`Unable to remove the partial download file: ${getErrorMessage(error)}`);
    }
}
