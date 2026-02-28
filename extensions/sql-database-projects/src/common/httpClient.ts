/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as vscode from "vscode";
import * as tunnel from "tunnel";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import * as constants from "./constants";
import type { Readable } from "stream";
import { Buffer } from "buffer";

const DownloadTimeoutMs = 20000;

/**
 * HTTP client for making GET requests and downloading files.
 * Respects VS Code proxy settings and HTTP_PROXY / HTTPS_PROXY environment variables,
 * routing downloads through a tunneling agent when a proxy is configured.
 *
 * Proxy detection priority:
 *   1. VS Code `http.proxy` setting
 *   2. HTTP_PROXY environment variable (and lowercase equivalent)
 *   3. HTTPS_PROXY environment variable (and lowercase equivalent)
 */
export class HttpClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
    private static cache: Map<string, any> = new Map();

    /**
     * Makes an HTTP GET request to the given URL, returning the parsed JSON body.
     * If useCache is true the result is memoised and returned on subsequent calls.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static async getRequest(url: string, useCache = false): Promise<any> {
        if (useCache && HttpClient.cache.has(url)) {
            return HttpClient.cache.get(url);
        }

        const config: AxiosRequestConfig = {
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true, // Never throw
        };

        const response = await axios.get(url, config);
        if (response.status !== 200) {
            const errorMessage: string[] = [response.status.toString(), response.statusText];
            if (response.data?.error) {
                errorMessage.push(
                    `${response.data?.error?.code} : ${response.data?.error?.message}`,
                );
            }
            throw new Error(errorMessage.join(os.EOL));
        }

        if (useCache) {
            HttpClient.cache.set(url, response.data);
        }
        return response.data;
    }

    /**
     * Downloads a file from downloadUrl and writes it to targetPath.
     * Proxy settings are applied automatically.
     * @param downloadUrl  URL to fetch
     * @param targetPath   Destination file path on disk
     * @param outputChannel  Optional output channel for progress/error messages
     */
    public async download(
        downloadUrl: string,
        targetPath: string,
        outputChannel?: vscode.OutputChannel,
    ): Promise<void> {
        const config: AxiosRequestConfig = {
            responseType: "stream",
            timeout: DownloadTimeoutMs,
            validateStatus: () => true, // Never throw; we check status manually
        };

        const proxy = this.loadProxyConfig();
        if (proxy) {
            // Disable Axios' built-in proxy so our tunneling agent takes over.
            // https://github.com/axios/axios/blob/bad6d8b97b52c0c15311c92dd596fc0bff122651/lib/adapters/http.js#L85
            config.proxy = false;
            const httpConfig = vscode.workspace.getConfiguration("http");
            const agent = this.createProxyAgent(
                downloadUrl,
                proxy,
                httpConfig.get<boolean>("proxyStrictSSL") ?? true,
            );
            if (agent.isHttps) {
                config.httpsAgent = agent.agent;
            } else {
                config.httpAgent = agent.agent;
            }
        }

        let response: AxiosResponse;
        try {
            response = await axios.get(downloadUrl, config);
        } catch (e) {
            outputChannel?.appendLine(constants.downloadError);
            throw e;
        }

        if (response.status !== 200) {
            outputChannel?.appendLine(constants.downloadError);
            throw new Error(response.statusText || `HTTP ${response.status}`);
        }

        const totalBytes = parseInt(response.headers["content-length"] || "0");
        const totalMB = totalBytes > 0 ? totalBytes / (1024 * 1024) : undefined;

        if (totalMB !== undefined) {
            outputChannel?.appendLine(
                `${constants.downloading} ${downloadUrl} (0 / ${totalMB.toFixed(2)} MB)`,
            );
        }

        let receivedBytes = 0;
        let printThreshold = 0.1;
        const stream: Readable = response.data;

        return new Promise<void>((resolve, reject) => {
            const writer = fs.createWriteStream(targetPath);

            stream.on("data", (chunk: Buffer) => {
                receivedBytes += chunk.length;
                if (totalMB) {
                    const receivedMB = receivedBytes / (1024 * 1024);
                    if (receivedMB / totalMB >= printThreshold) {
                        outputChannel?.appendLine(
                            `${constants.downloadProgress} (${receivedMB.toFixed(2)} / ${totalMB.toFixed(2)} MB)`,
                        );
                        printThreshold += 0.1;
                    }
                }
            });

            stream.on("error", (err: Error) => {
                outputChannel?.appendLine(constants.downloadError);
                writer.destroy();
                reject(err);
            });

            writer.on("close", () => resolve());

            writer.on("error", (err: Error) => {
                stream.destroy(err);
                reject(err);
            });

            stream.pipe(writer);
        });
    }

    /**
     * Reads proxy configuration in priority order:
     *   1. VS Code `http.proxy` setting
     *   2. HTTP_PROXY / HTTPS_PROXY environment variables (and lowercase equivalents)
     */
    private loadProxyConfig(): string | undefined {
        const proxy = vscode.workspace.getConfiguration("http").get<string>("proxy");
        if (proxy) {
            return proxy;
        }
        return this.getSystemProxyURL();
    }

    private getSystemProxyURL(): string | undefined {
        return (
            process.env["HTTP_PROXY"] ||
            process.env["http_proxy"] ||
            process.env["HTTPS_PROXY"] ||
            process.env["https_proxy"] ||
            undefined
        );
    }

    /**
     * Creates a tunneling proxy agent for the given request URL and proxy.
     * Selects the correct tunnel.* variant based on whether the request and proxy are HTTP or HTTPS.
     */
    private createProxyAgent(
        requestUrl: string,
        proxy: string,
        proxyStrictSSL: boolean,
    ): ProxyAgent {
        const agentOptions = this.getProxyAgentOptions(new URL(requestUrl), proxy, proxyStrictSSL);

        if (!agentOptions || !agentOptions.host || !agentOptions.port) {
            throw new Error(`Unable to parse proxy agent options from proxy URL: ${proxy}`);
        }

        const tunnelOptions: tunnel.HttpsOverHttpsOptions = {
            proxy: {
                host: agentOptions.host,
                port: Number(agentOptions.port),
                ...(agentOptions.auth ? { proxyAuth: agentOptions.auth } : {}),
                rejectUnauthorized: agentOptions.rejectUnauthorized,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        };

        const isHttpsRequest = requestUrl.startsWith("https");
        const isHttpsProxy = proxy.startsWith("https");

        return {
            isHttps: isHttpsRequest,
            agent: this.createTunnelingAgent(isHttpsRequest, isHttpsProxy, tunnelOptions),
        };
    }

    private createTunnelingAgent(
        isHttpsRequest: boolean,
        isHttpsProxy: boolean,
        tunnelOptions: tunnel.HttpsOverHttpsOptions,
    ): http.Agent | https.Agent {
        if (isHttpsRequest && isHttpsProxy) {
            return tunnel.httpsOverHttps(tunnelOptions);
        } else if (isHttpsRequest && !isHttpsProxy) {
            return tunnel.httpsOverHttp(tunnelOptions);
        } else if (!isHttpsRequest && isHttpsProxy) {
            return tunnel.httpOverHttps(tunnelOptions);
        } else {
            return tunnel.httpOverHttp(tunnelOptions);
        }
    }

    /*
     * Returns proxy agent options derived from the explicit proxy URL, falling back to
     * system environment variables when no explicit proxy is given.
     */
    private getProxyAgentOptions(
        requestURL: URL,
        proxy?: string,
        strictSSL?: boolean,
    ): ProxyAgentOptions | undefined {
        const proxyURL = proxy || this.getSystemProxyURL();

        if (!proxyURL) {
            return undefined;
        }

        const proxyEndpoint = new URL(proxyURL);

        if (!/^https?:$/.test(proxyEndpoint.protocol)) {
            return undefined;
        }

        const auth =
            proxyEndpoint.username || proxyEndpoint.password
                ? `${proxyEndpoint.username}:${proxyEndpoint.password}`
                : undefined;

        const port =
            proxyEndpoint.port !== ""
                ? Number(proxyEndpoint.port)
                : proxyEndpoint.protocol === "https:"
                  ? 443
                  : 80;

        const rejectUnauthorized = typeof strictSSL === "undefined" ? true : strictSSL;

        return {
            host: proxyEndpoint.hostname,
            port,
            auth,
            rejectUnauthorized,
        };
    }
}

interface ProxyAgent {
    isHttps: boolean;
    agent: http.Agent | https.Agent;
}

interface ProxyAgentOptions {
    auth: string | undefined;
    host?: string | null;
    port?: string | number | null;
    rejectUnauthorized: boolean;
}
