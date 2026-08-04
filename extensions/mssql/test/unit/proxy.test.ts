/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    createEnvironmentProxyResolver,
    getProxyPort,
    getRedactedProxyDescription,
    parseProxyConfiguration,
    resolveEnvironmentProxyValue,
    resolveProxyConfiguration,
} from "extension-toolkit/base";

suite("parseProxyConfiguration", () => {
    test("accepts an http proxy", () => {
        const result = parseProxyConfiguration("http://proxy.example.com:3128");

        expect(result.ok).to.be.true;
        expect(result.ok === true && result.url.hostname).to.equal("proxy.example.com");
    });

    test("accepts an https proxy", () => {
        const result = parseProxyConfiguration("https://proxy.example.com");

        expect(result.ok).to.be.true;
        expect(result.ok === true && result.url.protocol).to.equal("https:");
    });

    test("trims surrounding whitespace", () => {
        const result = parseProxyConfiguration("  http://proxy.example.com:3128  ");

        expect(result.ok).to.be.true;
    });

    test("reports a missing protocol", () => {
        const result = parseProxyConfiguration("proxy.example.com:3128");

        expect(result.ok).to.be.false;
        expect(result.ok === false && result.issue.kind).to.equal("missing-protocol");
    });

    test("reports an unsupported protocol", () => {
        const result = parseProxyConfiguration("socks5://proxy.example.com:1080");

        expect(result.ok).to.be.false;
        expect(result.ok === false && result.issue.kind).to.equal("unsupported-protocol");
    });

    test("reports an unsupported protocol even when its separator is malformed", () => {
        const result = parseProxyConfiguration("socks5:proxy.example.com:1080");

        expect(result.ok).to.be.false;
        expect(result.ok === false && result.issue.kind).to.equal("unsupported-protocol");
    });

    for (const value of ["http:/proxy.example.com", "https:proxy.example.com"]) {
        test(`reports the malformed HTTP proxy '${value}' as invalid`, () => {
            const result = parseProxyConfiguration(value);

            expect(result.ok).to.be.false;
            expect(result.ok === false && result.issue.kind).to.equal("invalid-url");
        });
    }

    test("reports localhost without a protocol as missing a protocol", () => {
        const result = parseProxyConfiguration("localhost:3128");

        expect(result.ok).to.be.false;
        expect(result.ok === false && result.issue.kind).to.equal("missing-protocol");
    });

    test("reports a URL without a host", () => {
        const result = parseProxyConfiguration("http://");

        expect(result.ok).to.be.false;
        expect(result.ok === false && result.issue.kind).to.equal("invalid-url");
    });
});

suite("getProxyPort", () => {
    test("uses the explicit port", () => {
        expect(getProxyPort(new URL("http://proxy.example.com:3128"))).to.equal(3128);
    });

    test("defaults http proxies to 80", () => {
        expect(getProxyPort(new URL("http://proxy.example.com"))).to.equal(80);
    });

    test("defaults https proxies to 443", () => {
        expect(getProxyPort(new URL("https://proxy.example.com"))).to.equal(443);
    });
});

suite("getRedactedProxyDescription", () => {
    test("omits credentials", () => {
        const description = getRedactedProxyDescription(
            new URL("http://user:secret@proxy.example.com:3128/path?token=abc"),
        );

        expect(description).to.equal("http://proxy.example.com:3128");
    });
});

suite("resolveEnvironmentProxyValue", () => {
    test("uses HTTP_PROXY for http targets", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
        });

        expect(value).to.equal("http://proxy.example.com:3128");
    });

    test("prefers HTTPS_PROXY for https targets", () => {
        const value = resolveEnvironmentProxyValue(new URL("https://example.com"), {
            HTTPS_PROXY: "http://secure-proxy.example.com:3128",
            HTTP_PROXY: "http://proxy.example.com:3128",
        });

        expect(value).to.equal("http://secure-proxy.example.com:3128");
    });

    test("falls back to HTTP_PROXY for https targets", () => {
        const value = resolveEnvironmentProxyValue(new URL("https://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
        });

        expect(value).to.equal("http://proxy.example.com:3128");
    });

    test("ignores HTTPS_PROXY for http targets", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTPS_PROXY: "http://secure-proxy.example.com:3128",
        });

        expect(value).to.be.undefined;
    });

    test("ignores blank values", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTP_PROXY: "   ",
        });

        expect(value).to.be.undefined;
    });

    test("honors an exact NO_PROXY host", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
            NO_PROXY: "example.com",
        });

        expect(value).to.be.undefined;
    });

    test("honors a NO_PROXY suffix match", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://api.example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
            NO_PROXY: ".example.com",
        });

        expect(value).to.be.undefined;
    });

    test("honors a NO_PROXY wildcard", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
            NO_PROXY: "*",
        });

        expect(value).to.be.undefined;
    });

    test("does not bypass unrelated NO_PROXY hosts", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
            NO_PROXY: "other.com",
        });

        expect(value).to.equal("http://proxy.example.com:3128");
    });

    test("respects a NO_PROXY entry with a non-matching port", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com:8080"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
            NO_PROXY: "example.com:9090",
        });

        expect(value).to.equal("http://proxy.example.com:3128");
    });

    test("returns undefined for non-http protocols", () => {
        const value = resolveEnvironmentProxyValue(new URL("ftp://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
        });

        expect(value).to.be.undefined;
    });
});

suite("createEnvironmentProxyResolver", () => {
    test("returns undefined when no proxy is configured", () => {
        const resolver = createEnvironmentProxyResolver({ environment: {} });

        expect(resolver.resolve(new URL("https://example.com"))).to.be.undefined;
    });

    test("marks the resolved proxy as coming from the environment", () => {
        const resolver = createEnvironmentProxyResolver({
            environment: { HTTPS_PROXY: "http://proxy.example.com:3128" },
        });

        const proxy = resolver.resolve(new URL("https://example.com"));

        expect(proxy?.source).to.equal("environment");
        expect(proxy?.rejectUnauthorized).to.be.true;
    });

    test("propagates the requested certificate validation mode", () => {
        const resolver = createEnvironmentProxyResolver({
            environment: { HTTPS_PROXY: "https://proxy.example.com:3128" },
            rejectUnauthorized: false,
        });

        expect(resolver.resolve(new URL("https://example.com"))?.rejectUnauthorized).to.be.false;
    });

    test("throws for an unusable proxy value", () => {
        const resolver = createEnvironmentProxyResolver({
            environment: { HTTPS_PROXY: "proxy.example.com:3128" },
        });

        expect(() => resolver.resolve(new URL("https://example.com"))).to.throw(
            /missing a protocol/,
        );
    });
});

suite("resolveProxyConfiguration", () => {
    test("prefers an explicit VS Code proxy over the environment", () => {
        const proxy = resolveProxyConfiguration(
            new URL("https://example.com"),
            "https://vscode-proxy.example.com:444",
            false,
            { HTTPS_PROXY: "http://environment-proxy.example.com:3128" },
        );

        expect(proxy?.source).to.equal("vscode");
        expect(proxy?.url.toString()).to.equal("https://vscode-proxy.example.com:444/");
        expect(proxy?.rejectUnauthorized).to.be.false;
    });

    test("falls back to the target-aware environment proxy", () => {
        const proxy = resolveProxyConfiguration(new URL("https://example.com"), undefined, true, {
            HTTPS_PROXY: "http://environment-proxy.example.com:3128",
        });

        expect(proxy?.source).to.equal("environment");
        expect(proxy?.url.toString()).to.equal("http://environment-proxy.example.com:3128/");
        expect(proxy?.rejectUnauthorized).to.be.true;
    });

    test("uses a direct connection when neither source configures a proxy", () => {
        const proxy = resolveProxyConfiguration(
            new URL("https://example.com"),
            undefined,
            true,
            {},
        );

        expect(proxy).to.be.undefined;
    });
});
