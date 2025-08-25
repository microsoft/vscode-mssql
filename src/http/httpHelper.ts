/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as tunnel from "tunnel";
import * as http from "http";
import * as https from "https";
import * as url from "url";
import axios, { AxiosResponse, AxiosRequestConfig } from "axios";
import { Url } from "url";

import * as LocalizedConstants from "../constants/locConstants";
import { Logger } from "../models/logger";

export class HttpHelper {
    constructor(private logger?: Logger) {}

    public async makeGetRequest<TResponse>(
        requestUrl: string,
        token: string,
    ): Promise<AxiosResponse<TResponse>> {
        const config: AxiosRequestConfig = {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            validateStatus: () => true, // Never throw
        };

        const httpConfig = vscode.workspace.getConfiguration("http");
        let proxy: string | undefined = httpConfig["proxy"] as string;
        if (!proxy) {
            this.logger?.verbose(
                "Workspace HTTP config didn't contain a proxy endpoint. Checking environment variables.",
            );

            proxy = this.loadEnvironmentProxyValue();
        }

        if (proxy) {
            this.logger?.verbose(
                "Proxy endpoint found in environment variables or workspace configuration.",
            );

            // Turning off automatic proxy detection to avoid issues with tunneling agent by setting proxy to false.
            // https://github.com/axios/axios/blob/bad6d8b97b52c0c15311c92dd596fc0bff122651/lib/adapters/http.js#L85
            config.proxy = false;

            const agent = this.createProxyAgent(requestUrl, proxy, httpConfig["proxyStrictSSL"]);
            if (agent.isHttps) {
                config.httpsAgent = agent.agent;
            } else {
                config.httpAgent = agent.agent;
            }

            const HTTPS_PORT = 443;
            const HTTP_PORT = 80;
            const parsedRequestUrl = url.parse(requestUrl);
            const port = parsedRequestUrl.protocol?.startsWith("https") ? HTTPS_PORT : HTTP_PORT;

            // Request URL will include HTTPS port 443 ('https://management.azure.com:443/tenants?api-version=2019-11-01'), so
            // that Axios doesn't try to reach this URL with HTTP port 80 on HTTP proxies, which result in an error. See https://github.com/axios/axios/issues/925
            const requestUrlWithPort = `${parsedRequestUrl.protocol}//${parsedRequestUrl.hostname}:${port}${parsedRequestUrl.path}`;
            const response: AxiosResponse = await axios.get<TResponse>(requestUrlWithPort, config);
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
                requestUrl,
            );
            return response;
        }

        const response: AxiosResponse = await axios.get<TResponse>(requestUrl, config);
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
            requestUrl,
        );
        return response;
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
        proxyStrictSSL: boolean,
    ): ProxyAgent {
        const agentOptions = this.getProxyAgentOptions(
            url.parse(requestUrl),
            proxy,
            proxyStrictSSL,
        );
        if (!agentOptions || !agentOptions.host || !agentOptions.port) {
            this.logger?.error("Unable to read proxy agent options to create proxy agent.");
            throw new Error(LocalizedConstants.unableToGetProxyAgentOptionsToGetTenants);
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
        const proxyAgent = {
            isHttps: isHttpsProxy,
            agent: this.createTunnelingAgent(isHttpsRequest, isHttpsProxy, tunnelOptions),
        } as ProxyAgent;

        return proxyAgent;
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
        requestURL: Url,
        proxy?: string,
        strictSSL?: boolean,
    ): ProxyAgentOptions | undefined {
        const proxyURL = proxy || this.getSystemProxyURL(requestURL);

        if (!proxyURL) {
            return undefined;
        }

        const proxyEndpoint = url.parse(proxyURL);

        if (!/^https?:$/.test(proxyEndpoint.protocol!)) {
            return undefined;
        }

        const opts: ProxyAgentOptions = {
            host: proxyEndpoint.hostname,
            port: Number(proxyEndpoint.port),
            auth: proxyEndpoint.auth,
            rejectUnauthorized: typeof strictSSL === "boolean",
        };

        return opts;
    }

    private getSystemProxyURL(requestURL: Url): string | undefined {
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
}

interface ProxyAgent {
    isHttps: boolean;
    agent: http.Agent | https.Agent;
}

interface ProxyAgentOptions {
    auth: string | null;
    secureProxy?: boolean;
    host?: string | null;
    path?: string | null;
    port?: string | number | null;
    rejectUnauthorized: boolean;
}
