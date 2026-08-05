/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
    createEnvironmentProxyResolver,
    getProxyPort,
    getRedactedProxyDescription,
    parseProxyConfiguration,
    resolveEnvironmentProxyValue,
    resolveProxyConfiguration,
} = require("../dist/base/index.js");

describe("parseProxyConfiguration", () => {
    it("accepts an http proxy", () => {
        const result = parseProxyConfiguration("http://proxy.example.com:3128");

        assert.equal(result.ok, true);
        assert.equal(result.url.hostname, "proxy.example.com");
    });

    it("accepts an https proxy", () => {
        const result = parseProxyConfiguration("https://proxy.example.com");

        assert.equal(result.ok, true);
        assert.equal(result.url.protocol, "https:");
    });

    it("trims surrounding whitespace", () => {
        const result = parseProxyConfiguration("  http://proxy.example.com:3128  ");

        assert.equal(result.ok, true);
    });

    it("reports a missing protocol", () => {
        const result = parseProxyConfiguration("proxy.example.com:3128");

        assert.equal(result.ok, false);
        assert.equal(result.issue.kind, "missing-protocol");
    });

    it("reports an unsupported protocol", () => {
        const result = parseProxyConfiguration("socks5://proxy.example.com:1080");

        assert.equal(result.ok, false);
        assert.equal(result.issue.kind, "unsupported-protocol");
    });

    it("reports an unsupported protocol even when its separator is malformed", () => {
        const result = parseProxyConfiguration("socks5:proxy.example.com:1080");

        assert.equal(result.ok, false);
        assert.equal(result.issue.kind, "unsupported-protocol");
    });

    for (const value of ["http:/proxy.example.com", "https:proxy.example.com"]) {
        it(`reports the malformed HTTP proxy '${value}' as invalid`, () => {
            const result = parseProxyConfiguration(value);

            assert.equal(result.ok, false);
            assert.equal(result.issue.kind, "invalid-url");
        });
    }

    it("reports localhost without a protocol as missing a protocol", () => {
        const result = parseProxyConfiguration("localhost:3128");

        assert.equal(result.ok, false);
        assert.equal(result.issue.kind, "missing-protocol");
    });

    it("reports a URL without a host", () => {
        const result = parseProxyConfiguration("http://");

        assert.equal(result.ok, false);
        assert.equal(result.issue.kind, "invalid-url");
    });
});

describe("getProxyPort", () => {
    it("uses the explicit port", () => {
        assert.equal(getProxyPort(new URL("http://proxy.example.com:3128")), 3128);
    });

    it("defaults http proxies to 80", () => {
        assert.equal(getProxyPort(new URL("http://proxy.example.com")), 80);
    });

    it("defaults https proxies to 443", () => {
        assert.equal(getProxyPort(new URL("https://proxy.example.com")), 443);
    });
});

describe("getRedactedProxyDescription", () => {
    it("omits credentials", () => {
        const description = getRedactedProxyDescription(
            new URL("http://user:secret@proxy.example.com:3128/path?token=abc"),
        );

        assert.equal(description, "http://proxy.example.com:3128");
    });
});

describe("resolveEnvironmentProxyValue", () => {
    it("uses HTTP_PROXY for http targets", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
        });

        assert.equal(value, "http://proxy.example.com:3128");
    });

    it("prefers HTTPS_PROXY for https targets", () => {
        const value = resolveEnvironmentProxyValue(new URL("https://example.com"), {
            HTTPS_PROXY: "http://secure-proxy.example.com:3128",
            HTTP_PROXY: "http://proxy.example.com:3128",
        });

        assert.equal(value, "http://secure-proxy.example.com:3128");
    });

    it("falls back to HTTP_PROXY for https targets", () => {
        const value = resolveEnvironmentProxyValue(new URL("https://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
        });

        assert.equal(value, "http://proxy.example.com:3128");
    });

    it("ignores HTTPS_PROXY for http targets", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTPS_PROXY: "http://secure-proxy.example.com:3128",
        });

        assert.equal(value, undefined);
    });

    it("ignores blank values", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTP_PROXY: "   ",
        });

        assert.equal(value, undefined);
    });

    it("honors an exact NO_PROXY host", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
            NO_PROXY: "example.com",
        });

        assert.equal(value, undefined);
    });

    it("honors a NO_PROXY suffix match", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://api.example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
            NO_PROXY: ".example.com",
        });

        assert.equal(value, undefined);
    });

    it("honors a NO_PROXY wildcard", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
            NO_PROXY: "*",
        });

        assert.equal(value, undefined);
    });

    it("does not bypass unrelated NO_PROXY hosts", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
            NO_PROXY: "other.com",
        });

        assert.equal(value, "http://proxy.example.com:3128");
    });

    it("respects a NO_PROXY entry with a non-matching port", () => {
        const value = resolveEnvironmentProxyValue(new URL("http://example.com:8080"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
            NO_PROXY: "example.com:9090",
        });

        assert.equal(value, "http://proxy.example.com:3128");
    });

    it("returns undefined for non-http protocols", () => {
        const value = resolveEnvironmentProxyValue(new URL("ftp://example.com"), {
            HTTP_PROXY: "http://proxy.example.com:3128",
        });

        assert.equal(value, undefined);
    });
});

describe("createEnvironmentProxyResolver", () => {
    it("returns undefined when no proxy is configured", () => {
        const resolver = createEnvironmentProxyResolver({ environment: {} });

        assert.equal(resolver.resolve(new URL("https://example.com")), undefined);
    });

    it("marks the resolved proxy as coming from the environment", () => {
        const resolver = createEnvironmentProxyResolver({
            environment: { HTTPS_PROXY: "http://proxy.example.com:3128" },
        });

        const proxy = resolver.resolve(new URL("https://example.com"));

        assert.equal(proxy.source, "environment");
        assert.equal(proxy.rejectUnauthorized, true);
    });

    it("propagates the requested certificate validation mode", () => {
        const resolver = createEnvironmentProxyResolver({
            environment: { HTTPS_PROXY: "https://proxy.example.com:3128" },
            rejectUnauthorized: false,
        });

        assert.equal(resolver.resolve(new URL("https://example.com")).rejectUnauthorized, false);
    });

    it("throws for an unusable proxy value", () => {
        const resolver = createEnvironmentProxyResolver({
            environment: { HTTPS_PROXY: "proxy.example.com:3128" },
        });

        assert.throws(() => resolver.resolve(new URL("https://example.com")), /missing a protocol/);
    });
});

describe("resolveProxyConfiguration", () => {
    it("prefers an explicit VS Code proxy over the environment", () => {
        const proxy = resolveProxyConfiguration(
            new URL("https://example.com"),
            "https://vscode-proxy.example.com:444",
            false,
            { HTTPS_PROXY: "http://environment-proxy.example.com:3128" },
        );

        assert.equal(proxy.source, "vscode");
        assert.equal(proxy.url.toString(), "https://vscode-proxy.example.com:444/");
        assert.equal(proxy.rejectUnauthorized, false);
    });

    it("falls back to the target-aware environment proxy", () => {
        const proxy = resolveProxyConfiguration(new URL("https://example.com"), undefined, true, {
            HTTPS_PROXY: "http://environment-proxy.example.com:3128",
        });

        assert.equal(proxy.source, "environment");
        assert.equal(proxy.url.toString(), "http://environment-proxy.example.com:3128/");
        assert.equal(proxy.rejectUnauthorized, true);
    });

    it("uses a direct connection when neither source configures a proxy", () => {
        const proxy = resolveProxyConfiguration(
            new URL("https://example.com"),
            undefined,
            true,
            {},
        );

        assert.equal(proxy, undefined);
    });
});
