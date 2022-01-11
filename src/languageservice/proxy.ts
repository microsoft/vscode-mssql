/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Url, parse as parseUrl } from 'url';
import * as httpProxyAgent from 'http-proxy-agent';
import * as httpsProxyAgent from 'https-proxy-agent';

function getSystemProxyURL(requestURL: Url): string {
	if (requestURL.protocol === 'http:') {
		return process.env.HTTP_PROXY || process.env.http_proxy || undefined;
	} else if (requestURL.protocol === 'https:') {
		return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || undefined;
	}

	return undefined;
}

export function isBoolean(obj: any): obj is boolean {
	return obj === true || obj === false;
}

/*
 * Returns the proxy agent using the proxy url in the parameters or the system proxy. Returns null if no proxy found
 */
export function getProxyAgent(requestURL: Url, proxy?: string, strictSSL?: boolean): any {
	const proxyURL = proxy || getSystemProxyURL(requestURL);

	if (!proxyURL) {
		return undefined;
	}

	const proxyEndpoint = parseUrl(proxyURL);

	if (!/^https?:$/.test(proxyEndpoint.protocol)) {
		return undefined;
	}

	const opts = {
		host: proxyEndpoint.hostname,
		port: Number(proxyEndpoint.port),
		auth: proxyEndpoint.auth,
		rejectUnauthorized: isBoolean(strictSSL) ? strictSSL : true
	};

	return requestURL.protocol === 'http:' ? new httpProxyAgent(opts) : new httpsProxyAgent(opts);
}
