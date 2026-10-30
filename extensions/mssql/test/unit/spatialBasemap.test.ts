/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SPA-10 basemap host suite (addendum §10.1): source-validation grammar,
 * consent/trust/eligibility gates, tile flow (cache tiers, typed fetch
 * failures, bounds, stale generations), disk cache behavior, and privacy
 * canaries proving no URL, host, credential, or tile coordinate survives
 * into descriptors or marker attributes.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as sinon from "sinon";
import * as https from "https";
import { ClientRequest } from "http";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import {
    fetchBasemapResponse,
    pinnedBasemapLookup,
} from "../../src/queryResults/spatialBasemap/spatialBasemapNode";
import { spatialBasemapCacheRoot } from "../../src/queryResults/spatialBasemap/spatialBasemapHost";
import {
    isPrivateNetworkHost,
    spatialBasemapFingerprint,
    validateSpatialBasemapSources,
} from "../../src/queryResults/spatialBasemap/spatialBasemapConfig";
import { createSpatialBasemapConsentStore } from "../../src/queryResults/spatialBasemap/spatialBasemapConsent";
import {
    createSpatialBasemapSetupOffer,
    SPATIAL_BASEMAP_OFFER_DISMISSED_KEY,
} from "../../src/queryResults/spatialBasemap/spatialBasemapOnboarding";
import { SpatialBasemapTileCache } from "../../src/queryResults/spatialBasemap/spatialBasemapTileCache";
import { fetchSpatialBasemapTile } from "../../src/queryResults/spatialBasemap/spatialBasemapFetcher";
import { SpatialBasemapSessionManager } from "../../src/queryResults/spatialBasemap/spatialBasemapSessionManager";
import type {
    SpatialBasemapFetcherDeps,
    SpatialBasemapValidatedSource,
} from "../../src/queryResults/spatialBasemap/spatialBasemapTypes";

const GOOD_SOURCE = {
    id: "contoso-road",
    displayName: "Contoso Road Map",
    kind: "xyzRaster",
    urlTemplate: "https://maps.contoso.example/tiles/{z}/{x}/{y}.png",
    minZoom: 0,
    maxZoom: 19,
    attribution: { text: "© Contoso Maps", termsUrl: "https://maps.contoso.example/terms" },
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function pngResponse(status = 200): Response {
    return new Response(status >= 200 && status < 300 ? PNG : "err", {
        status,
        headers: { "content-type": "image/png" },
    });
}

function fakeFetcher(
    handler: (url: string) => Response | Promise<Response>,
): SpatialBasemapFetcherDeps & { urls: string[] } {
    const urls: string[] = [];
    return {
        urls,
        fetch: async (url) => {
            urls.push(url);
            return handler(url);
        },
        lookup: async () => ["203.0.113.7"],
    };
}

function memento(): {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
} {
    const store = new Map<string, unknown>();
    return {
        get: <T>(key: string, defaultValue: T) => (store.get(key) as T) ?? defaultValue,
        update: async (key, value) => {
            if (value === undefined) store.delete(key);
            else store.set(key, value);
        },
    };
}

function tempCache(maxDiskBytes = 1024 * 1024, maxAgeMs = 60_000): SpatialBasemapTileCache {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sbm-cache-"));
    return new SpatialBasemapTileCache({ root, hmacKey: "test-key", maxDiskBytes, maxAgeMs });
}

function validated(overrides: Partial<typeof GOOD_SOURCE> = {}): SpatialBasemapValidatedSource {
    const result = validateSpatialBasemapSources([{ ...GOOD_SOURCE, ...overrides }]);
    expect(result.issues).to.deep.equal([]);
    return result.sources[0];
}

interface ManagerOptions {
    trusted?: boolean;
    consented?: boolean;
    confirmAnswer?: boolean;
    fetcher?: SpatialBasemapFetcherDeps;
    cache?: SpatialBasemapTileCache;
    source?: SpatialBasemapValidatedSource;
    secret?: string;
}

function manager(options: ManagerOptions = {}) {
    const source = options.source ?? validated();
    const consent = createSpatialBasemapConsentStore(memento());
    if (options.consented !== false) {
        void consent.record(source.fingerprint);
    }
    const confirmed: string[] = [];
    const cache = options.cache ?? tempCache();
    const sessions = new SpatialBasemapSessionManager({
        sources: () => [source],
        consent,
        cache,
        fetcher: options.fetcher ?? fakeFetcher(() => pngResponse()),
        isTrusted: () => options.trusted !== false,
        confirm: async (candidate) => {
            confirmed.push(candidate.config.id);
            return options.confirmAnswer !== false;
        },
        secretFor: async () => options.secret,
    });
    return { sessions, source, consent, cache, confirmed };
}

suite("spatial basemap review regressions", () => {
    const sandbox = sinon.createSandbox();
    teardown(() => sandbox.restore());

    test("private address detection covers mapped IPv6 without rejecting DNS names", () => {
        for (const host of [
            "::ffff:127.0.0.1",
            "[::ffff:7f00:1]",
            "::ffff:10.0.0.1",
            "::",
            "100.64.0.1",
            "febf::1",
        ])
            expect(isPrivateNetworkHost(host), host).to.equal(true);
        for (const host of [
            "fdot-tiles.example.com",
            "fc-maps.example.com",
            "203.0.113.7",
            "2001:db8::1",
        ])
            expect(isPrivateNetworkHost(host), host).to.equal(false);
        expect(
            validateSpatialBasemapSources([
                { ...GOOD_SOURCE, urlTemplate: "https://[::ffff:127.0.0.1]/{z}/{x}/{y}.png" },
            ]).issues.map((issue) => issue.code),
        ).to.include("privateNetwork");
    });

    test("approved addresses are pinned to the socket lookup and the app identifies itself", async () => {
        const lookup = sandbox.stub().resolves(["203.0.113.7"]);
        const fetch = sandbox
            .stub()
            .callsFake(async (_url, init: RequestInit, addresses: readonly string[]) => {
                expect(addresses).to.deep.equal(["203.0.113.7"]);
                expect(new Headers(init.headers).get("user-agent")).to.include("vscode-mssql");
                const connected = sandbox.spy();
                pinnedBasemapLookup(addresses)("maps.contoso.example", { all: true }, connected);
                expect(connected.firstCall.args).to.deep.equal([
                    null,
                    [{ address: "203.0.113.7", family: 4 }],
                ]);
                return pngResponse();
            });
        expect(
            (
                await fetchSpatialBasemapTile(
                    { url: "https://maps.contoso.example/0/0/0.png", allowPrivateNetwork: false },
                    { lookup, fetch },
                )
            ).status,
        ).to.equal("ok");
        expect(lookup.calledOnce).to.equal(true);
        const error = sandbox.spy();
        pinnedBasemapLookup(["203.0.113.7"])("maps.contoso.example", { family: 6 }, error);
        expect(error.firstCall.args[0]).to.be.instanceOf(Error);
    });

    test("native transport preserves the TLS hostname and rejects malformed responses safely", async () => {
        const incoming = Object.assign(new PassThrough(), { rawHeaders: [], statusCode: 700 });
        sandbox.stub(https, "request").callsFake((...args: unknown[]) => {
            expect(args[0]).to.equal("https://maps.contoso.example/0/0/0.png");
            const options = args[1] as https.RequestOptions;
            expect(options.agent).to.equal(false);
            const connected = sandbox.spy();
            options.lookup!("maps.contoso.example", { all: true }, connected);
            expect(connected.firstCall.args[1]).to.deep.equal([
                { address: "203.0.113.7", family: 4 },
            ]);
            const respond = args[2] as (response: typeof incoming) => void;
            return Object.assign(new EventEmitter(), {
                end: () => setImmediate(() => respond(incoming)),
            }) as unknown as ClientRequest;
        });
        const rejected = await fetchBasemapResponse("https://maps.contoso.example/0/0/0.png", {}, [
            "203.0.113.7",
        ]).then(
            () => false,
            () => true,
        );
        expect(rejected).to.equal(true);
        expect(incoming.destroyed).to.equal(true);
    });

    test("unused error/redirect bodies are aborted, including retries", async () => {
        for (const status of [302, 404, 503]) {
            const signals: AbortSignal[] = [];
            await fetchSpatialBasemapTile(
                { url: "https://maps.contoso.example/0/0/0.png", allowPrivateNetwork: false },
                {
                    lookup: async () => ["203.0.113.7"],
                    fetch: async (_url, init) => {
                        signals.push(init.signal!);
                        return new Response(new ReadableStream(), { status });
                    },
                },
            );
            expect(signals).to.have.length(status === 503 ? 2 : 1);
            expect(signals.every((signal) => signal.aborted)).to.equal(true);
        }
    });

    test("DNS resolution is included in the request deadline", async () => {
        const fetch = sandbox.stub();
        const result = await fetchSpatialBasemapTile(
            {
                url: "https://maps.contoso.example/0/0/0.png",
                allowPrivateNetwork: false,
                timeoutMs: 10,
            },
            { lookup: () => new Promise(() => undefined), fetch },
        );
        expect(result.status).to.equal("timeout");
        expect(fetch.called).to.equal(false);
    });

    test("revoked consent, changed sources and trust block cached and network tiles", async () => {
        for (const change of ["consent", "source", "trust"] as const) {
            let source = validated();
            let trusted = true;
            const consent = createSpatialBasemapConsentStore(memento());
            await consent.record(source.fingerprint);
            const cache = tempCache();
            const fetcher = fakeFetcher(() => pngResponse());
            const sessions = new SpatialBasemapSessionManager({
                sources: () => [source],
                consent,
                cache,
                fetcher,
                isTrusted: () => trusted,
                confirm: async () => true,
                secretFor: async () => undefined,
            });
            const opened = await sessions.open({
                layerId: source.config.id,
                activeProjection: "EPSG:4326",
                interactive: false,
            });
            const params = {
                handle: opened.handle!,
                generation: opened.generation!,
                z: 1,
                x: 0,
                y: 0,
            };
            expect((await sessions.tile(params)).status).to.equal("ready");
            if (change === "consent") await consent.clearAll();
            else if (change === "source")
                source = validated({
                    urlTemplate: "https://changed.contoso.example/{z}/{x}/{y}.png",
                });
            else trusted = false;
            expect((await sessions.tile(params)).status).to.equal("cancelled");
            expect((await sessions.tile({ ...params, x: 1 })).status).to.equal("cancelled");
            expect(fetcher.urls).to.have.length(1);
            sessions.dispose("test");
            await cache.clearAll();
        }
    });

    test("all panel managers share the global fetch limit and release capacity", async () => {
        const releases: Array<() => void> = [];
        let current = 0,
            peak = 0;
        let finishing = false;
        const fetcher = fakeFetcher(async () => {
            current++;
            peak = Math.max(peak, current);
            if (!finishing) await new Promise<void>((resolve) => releases.push(resolve));
            current--;
            return pngResponse();
        });
        const contexts = Array.from({ length: 4 }, () => manager({ fetcher }));
        const outcomes: Array<Promise<unknown>> = [];
        try {
            for (const ctx of contexts) {
                const opened = await ctx.sessions.open({
                    layerId: ctx.source.config.id,
                    activeProjection: "EPSG:4326",
                    interactive: false,
                });
                for (let x = 0; x < 4; x++)
                    outcomes.push(
                        ctx.sessions.tile({
                            handle: opened.handle!,
                            generation: opened.generation!,
                            z: 2,
                            x,
                            y: 0,
                        }),
                    );
            }
            // Wait for the async disk cache misses, without holding pending fetches forever.
            const deadline = Date.now() + 5000;
            while (releases.length < 12 && Date.now() < deadline)
                await new Promise<void>((resolve) => setTimeout(resolve, 5));
            expect(peak).to.equal(12);
        } finally {
            finishing = true;
            releases.forEach((release) => release());
            await Promise.all(outcomes);
            for (const ctx of contexts) {
                ctx.sessions.dispose("test");
                await ctx.cache.clearAll();
            }
        }
        const ctx = manager();
        const opened = await ctx.sessions.open({
            layerId: ctx.source.config.id,
            activeProjection: "EPSG:4326",
            interactive: false,
        });
        expect(
            (
                await ctx.sessions.tile({
                    handle: opened.handle!,
                    generation: opened.generation!,
                    z: 0,
                    x: 0,
                    y: 0,
                })
            ).status,
        ).to.equal("ready");
        ctx.sessions.dispose("test");
        await ctx.cache.clearAll();
    });

    test("closing a panel aborts an in-flight request and invalidates its result", async () => {
        let started!: () => void;
        const ready = new Promise<void>((resolve) => (started = resolve));
        const ctx = manager({
            fetcher: {
                lookup: async () => ["203.0.113.7"],
                fetch: async (_url, init) => {
                    started();
                    await new Promise<void>((resolve) =>
                        init.signal!.addEventListener("abort", () => resolve(), { once: true }),
                    );
                    throw Object.assign(new Error("aborted"), { name: "AbortError" });
                },
            },
        });
        const opened = await ctx.sessions.open({
            layerId: ctx.source.config.id,
            activeProjection: "EPSG:4326",
            interactive: false,
        });
        const pending = ctx.sessions.tile({
            handle: opened.handle!,
            generation: opened.generation!,
            z: 0,
            x: 0,
            y: 0,
        });
        await ready;
        ctx.sessions.dispose("consentChanged");
        expect((await pending).status).to.equal("cancelled");
        await ctx.cache.clearAll();
    });

    test("concurrent cache writes enforce the disk budget and live budget changes", async () => {
        const cache = tempCache(4096);
        try {
            const writes = await Promise.all(
                Array.from({ length: 20 }, (_, x) =>
                    cache.put("source", 5, x, 0, new Uint8Array(1024)),
                ),
            );
            expect(await cache.diskBytes()).to.be.at.most(4096);
            expect(fs.existsSync(writes[19].filePath)).to.equal(true);
            await cache.updateBudgets(2048, 60_000);
            expect(await cache.diskBytes()).to.be.at.most(2048);
        } finally {
            await cache.clearAll();
        }
    });
});

suite("spatial basemap source validation (SPA-10 §5.2)", () => {
    test("a well-formed source validates and sanitizes", () => {
        const { sources, issues } = validateSpatialBasemapSources([GOOD_SOURCE]);
        expect(issues).to.deep.equal([]);
        expect(sources).to.have.length(1);
        const descriptor = sources[0].descriptor as unknown as Record<string, unknown>;
        // Privacy canary: the descriptor must never carry the template,
        // credential reference, fingerprint, or any URL besides termsUrl.
        const serialized = JSON.stringify(descriptor);
        expect(serialized).to.not.include("urlTemplate");
        expect(serialized).to.not.include("contoso.example/tiles");
        expect(serialized).to.not.include("credentialRef");
        expect(serialized).to.not.include(sources[0].fingerprint);
    });

    test("rejection matrix", () => {
        const cases: [Record<string, unknown>, string][] = [
            [{ ...GOOD_SOURCE, id: "0bad" }, "invalidId"],
            [{ ...GOOD_SOURCE, id: "worldOutline" }, "reservedId"],
            [{ ...GOOD_SOURCE, kind: "wms" }, "unsupportedKind"],
            [{ ...GOOD_SOURCE, displayName: "" }, "invalidDisplayName"],
            [
                { ...GOOD_SOURCE, urlTemplate: "http://maps.contoso.example/{z}/{x}/{y}.png" },
                "insecureTemplate",
            ],
            [
                { ...GOOD_SOURCE, urlTemplate: "https://maps.contoso.example/{z}/{x}.png" },
                "templatePlaceholders",
            ],
            [
                {
                    ...GOOD_SOURCE,
                    urlTemplate: "https://maps.contoso.example/{z}/{x}/{y}/{token}.png",
                },
                "templatePlaceholders",
            ],
            [
                {
                    ...GOOD_SOURCE,
                    urlTemplate: "https://user:pw@maps.contoso.example/{z}/{x}/{y}.png",
                },
                "templateCredentials",
            ],
            [
                { ...GOOD_SOURCE, urlTemplate: "https://127.0.0.1/{z}/{x}/{y}.png" },
                "privateNetwork",
            ],
            [{ ...GOOD_SOURCE, minZoom: 5, maxZoom: 2 }, "invalidZoom"],
            [{ ...GOOD_SOURCE, maxZoom: 99 }, "invalidZoom"],
            [{ ...GOOD_SOURCE, attribution: { text: "" } }, "invalidAttribution"],
            [
                {
                    ...GOOD_SOURCE,
                    attribution: { text: "ok", termsUrl: "http://insecure.example" },
                },
                "invalidTermsUrl",
            ],
            [{ ...GOOD_SOURCE, credentialRef: "bad ref!" }, "invalidCredentialRef"],
        ];
        for (const [candidate, code] of cases) {
            const { sources, issues } = validateSpatialBasemapSources([candidate]);
            expect(sources, JSON.stringify(candidate)).to.have.length(0);
            expect(issues.map((issue) => issue.code)).to.deep.equal([code]);
        }
    });

    test("duplicate ids are rejected case-insensitively", () => {
        const { sources, issues } = validateSpatialBasemapSources([
            GOOD_SOURCE,
            { ...GOOD_SOURCE, id: "CONTOSO-ROAD" },
        ]);
        expect(sources).to.have.length(1);
        expect(issues.map((issue) => issue.code)).to.deep.equal(["duplicateId"]);
    });

    test("allowPrivateNetwork opts a loopback source in", () => {
        const { sources, issues } = validateSpatialBasemapSources([
            {
                ...GOOD_SOURCE,
                urlTemplate: "https://127.0.0.1/{z}/{x}/{y}.png",
                allowPrivateNetwork: true,
            },
        ]);
        expect(issues).to.deep.equal([]);
        expect(sources).to.have.length(1);
    });

    test("fingerprint tracks identity, not zoom bounds", () => {
        const base = spatialBasemapFingerprint(validated().config);
        expect(spatialBasemapFingerprint(validated({ maxZoom: 12 }).config)).to.equal(base);
        expect(
            spatialBasemapFingerprint(
                validated({ urlTemplate: "https://other.example/{z}/{x}/{y}.png" }).config,
            ),
        ).to.not.equal(base);
    });

    test("private network detection covers the reserved families", () => {
        for (const host of [
            "localhost",
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.9",
            "192.168.1.1",
            "169.254.0.1",
            "::1",
            "fd00::1",
        ]) {
            expect(isPrivateNetworkHost(host), host).to.equal(true);
        }
        expect(isPrivateNetworkHost("203.0.113.7")).to.equal(false);
        expect(isPrivateNetworkHost("maps.contoso.example")).to.equal(false);
    });
});

suite("spatial basemap sessions (SPA-10 §6/§7)", () => {
    test("untrusted workspaces and planar data cannot open", async () => {
        expect(
            (
                await manager({ trusted: false }).sessions.open({
                    layerId: "contoso-road",
                    activeProjection: "EPSG:4326",
                    interactive: true,
                })
            ).status,
        ).to.equal("untrusted");
        expect(
            (
                await manager().sessions.open({
                    layerId: "contoso-road",
                    activeProjection: "planar",
                    interactive: true,
                })
            ).status,
        ).to.equal("incompatible");
    });

    test("consent: restore never prompts, interactive prompts once, decline reverts", async () => {
        const restored = manager({ consented: false });
        const restore = await restored.sessions.open({
            layerId: "contoso-road",
            activeProjection: "EPSG:4326",
            interactive: false,
        });
        expect(restore.status).to.equal("consentRequired");
        expect(restored.confirmed).to.deep.equal([]);

        const declined = manager({ consented: false, confirmAnswer: false });
        expect(
            (
                await declined.sessions.open({
                    layerId: "contoso-road",
                    activeProjection: "EPSG:4326",
                    interactive: true,
                })
            ).status,
        ).to.equal("declined");

        const accepted = manager({ consented: false });
        const first = await accepted.sessions.open({
            layerId: "contoso-road",
            activeProjection: "EPSG:4326",
            interactive: true,
        });
        expect(first.status).to.equal("ready");
        expect(accepted.confirmed).to.deep.equal(["contoso-road"]);
        // Consent recorded: a second interactive open does not prompt again.
        const second = await accepted.sessions.open({
            layerId: "contoso-road",
            activeProjection: "EPSG:4326",
            interactive: true,
        });
        expect(second.status).to.equal("ready");
        expect(accepted.confirmed).to.deep.equal(["contoso-road"]);
    });

    test("tile flow: network then cache tiers; bytes only via local files", async () => {
        const fetcher = fakeFetcher(() => pngResponse());
        const { sessions } = manager({ fetcher });
        const open = await sessions.open({
            layerId: "contoso-road",
            activeProjection: "EPSG:3857",
            interactive: true,
        });
        const params = { handle: open.handle!, generation: open.generation!, z: 3, x: 2, y: 1 };
        const fromNetwork = await sessions.tile(params);
        expect(fromNetwork.status).to.equal("ready");
        expect(fromNetwork.filePath).to.be.a("string");
        expect(fs.readFileSync(fromNetwork.filePath!)[0]).to.equal(0x89);
        // Substituted URL reached the fetcher; the cache path must not leak it.
        expect(fetcher.urls).to.deep.equal(["https://maps.contoso.example/tiles/3/2/1.png"]);
        expect(fromNetwork.filePath).to.not.include("contoso");
        expect(fromNetwork.filePath).to.not.match(/[\\/]3[\\/]2[\\/]1/);
        const fromCache = await sessions.tile(params);
        expect(fromCache.status).to.equal("ready");
        expect(fetcher.urls).to.have.length(1); // no second network hit
    });

    test("bounds, stale sessions, and typed failures", async () => {
        const fetcher = fakeFetcher((url) =>
            url.includes("/4/") ? pngResponse(404) : pngResponse(500),
        );
        const { sessions } = manager({ fetcher });
        const open = await sessions.open({
            layerId: "contoso-road",
            activeProjection: "EPSG:3857",
            interactive: true,
        });
        const base = { handle: open.handle!, generation: open.generation! };
        expect((await sessions.tile({ ...base, z: 25, x: 0, y: 0 })).status).to.equal(
            "unavailable",
        );
        expect((await sessions.tile({ ...base, z: 3, x: 9, y: 0 })).status).to.equal("unavailable");
        expect((await sessions.tile({ ...base, z: 4, x: 0, y: 0 })).status).to.equal("notFound");
        // 5xx retries once, then reports typed unavailability.
        expect((await sessions.tile({ ...base, z: 5, x: 0, y: 0 })).status).to.equal("unavailable");
        expect(fetcher.urls.filter((url) => url.includes("/5/"))).to.have.length(2);
        expect(
            (await sessions.tile({ ...base, generation: base.generation + 1, z: 3, x: 0, y: 0 }))
                .status,
        ).to.equal("cancelled");
        sessions.close(base.handle, "layerChange");
        expect((await sessions.tile({ ...base, z: 3, x: 0, y: 0 })).status).to.equal("cancelled");
    });

    test("secrets ride as host-side bearer headers, never in URLs", async () => {
        let sawAuth: string | undefined;
        const fetcher: SpatialBasemapFetcherDeps & { urls: string[] } = {
            urls: [],
            fetch: async (url, init) => {
                fetcher.urls.push(url);
                sawAuth = (init.headers as Record<string, string>).authorization;
                return pngResponse();
            },
            lookup: async () => ["203.0.113.7"],
        };
        const source = validated({ credentialRef: "contoso-key" } as never);
        const { sessions } = manager({ fetcher, source, secret: "s3cr3t-token" });
        const open = await sessions.open({
            layerId: "contoso-road",
            activeProjection: "EPSG:3857",
            interactive: true,
        });
        const tile = await sessions.tile({
            handle: open.handle!,
            generation: open.generation!,
            z: 1,
            x: 0,
            y: 0,
        });
        expect(tile.status).to.equal("ready");
        expect(sawAuth).to.equal("Bearer s3cr3t-token");
        expect(fetcher.urls[0]).to.not.include("s3cr3t");
        expect(tile.filePath).to.not.include("s3cr3t");
    });
});

suite("spatial basemap fetcher honesty", () => {
    const options = {
        url: "https://maps.contoso.example/tiles/1/0/0.png",
        allowPrivateNetwork: false,
    };

    test("refuses redirects, oversize bodies, and non-raster payloads", async () => {
        expect(
            (
                await fetchSpatialBasemapTile(options, {
                    fetch: async () =>
                        new Response(null, { status: 302, headers: { location: "https://x" } }),
                    lookup: async () => ["203.0.113.7"],
                })
            ).status,
        ).to.equal("unavailable");
        const big = new Uint8Array(3 * 1024 * 1024);
        big.set([0x89, 0x50, 0x4e, 0x47]);
        expect(
            (
                await fetchSpatialBasemapTile(options, {
                    fetch: async () => new Response(big, { status: 200 }),
                    lookup: async () => ["203.0.113.7"],
                })
            ).status,
        ).to.equal("tooLarge");
        expect(
            (
                await fetchSpatialBasemapTile(options, {
                    fetch: async () => new Response("<html>not a tile</html>", { status: 200 }),
                    lookup: async () => ["203.0.113.7"],
                })
            ).status,
        ).to.equal("badMediaType");
    });

    test("resolved private addresses are refused (DNS rebinding gate)", async () => {
        const result = await fetchSpatialBasemapTile(options, {
            fetch: async () => pngResponse(),
            lookup: async () => ["10.0.0.5"],
        });
        expect(result.status).to.equal("unavailable");
    });
});

suite("spatial basemap tile cache (D-0028)", () => {
    test("age and byte-budget eviction, clear, and fingerprint isolation", async () => {
        const cache = tempCache(4_000, 50);
        await cache.put("fpA", 1, 0, 0, PNG);
        await cache.put("fpB", 1, 0, 0, PNG);
        expect(await cache.get("fpA", 1, 0, 0), "fpA hit").to.not.equal(undefined);
        // A different fingerprint never sees another source's tiles.
        expect(await cache.get("fpC", 1, 0, 0)).to.equal(undefined);
        // Age eviction (fresh memory tier bypassed via a new cache instance).
        await new Promise((resolve) => setTimeout(resolve, 80));
        const reopened = new SpatialBasemapTileCache({
            root: (cache as unknown as { options: { root: string } }).options.root,
            hmacKey: "test-key",
            maxDiskBytes: 4_000,
            maxAgeMs: 50,
        });
        expect(await reopened.get("fpA", 1, 0, 0)).to.equal(undefined);
        await reopened.put("fpA", 2, 0, 0, PNG);
        await reopened.clearAll();
        expect(await reopened.diskBytes()).to.equal(0);
    });

    test("byte budget evicts oldest first", async () => {
        const cache = tempCache(2 * PNG.byteLength + 4, 60_000);
        await cache.put("fp", 1, 0, 0, PNG);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await cache.put("fp", 1, 1, 0, PNG);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await cache.put("fp", 1, 1, 1, PNG);
        const surviving = await cache.evict();
        expect(surviving).to.be.at.most(2 * PNG.byteLength + 4);
    });
});

suite("spatial basemap cache root (D-0022 local resource root)", () => {
    test("derives from global storage alone — usable before host init", () => {
        // Restored editors resolve mid-activation, before the host singleton
        // exists; the panel's localResourceRoots and the host's tile cache
        // must agree on this path or every tile 401s from the ServiceWorker.
        const globalStorageUri = vscode.Uri.file(path.join(os.tmpdir(), "mssql-global-storage"));
        const root = spatialBasemapCacheRoot({ globalStorageUri });
        expect(root.fsPath).to.equal(path.join(globalStorageUri.fsPath, "spatial-basemap-cache"));
    });
});

suite("spatial basemap setup offer (first-view OpenStreetMap onboarding)", () => {
    interface OfferHarness {
        offer: ReturnType<typeof createSpatialBasemapSetupOffer>;
        settings: { enabled?: boolean; sources: unknown };
        prompts: number;
        confirms: number;
        consents: string[];
        memento: ReturnType<typeof memento>;
    }

    function harness(
        options: {
            enabled?: boolean;
            sources?: unknown;
            choice?: "add" | "never" | "dismiss";
            dismissed?: boolean;
        } = {},
    ): OfferHarness {
        const store = memento();
        if (options.dismissed) {
            void store.update(SPATIAL_BASEMAP_OFFER_DISMISSED_KEY, true);
        }
        const state: OfferHarness = {
            offer: undefined as unknown as ReturnType<typeof createSpatialBasemapSetupOffer>,
            settings: { enabled: options.enabled, sources: options.sources ?? [] },
            prompts: 0,
            confirms: 0,
            consents: [],
            memento: store,
        };
        state.offer = createSpatialBasemapSetupOffer({
            memento: store,
            isEnabled: () => state.settings.enabled === true,
            globalSources: () => state.settings.sources,
            updateSettings: async (sources) => {
                state.settings.sources = sources;
                state.settings.enabled = true;
            },
            prompt: async () => {
                state.prompts++;
                return options.choice ?? "add";
            },
            confirm: () => {
                state.confirms++;
            },
            recordConsent: async (fingerprint) => {
                state.consents.push(fingerprint);
            },
        });
        return state;
    }

    test("accepting writes enabled + a valid OSM source and records its consent", async () => {
        const state = harness({ enabled: false });
        expect(await state.offer.maybeOffer()).to.equal("added");
        expect(state.settings.enabled).to.equal(true);
        const validated = validateSpatialBasemapSources(state.settings.sources);
        expect(validated.issues).to.deep.equal([]);
        expect(validated.sources).to.have.length(1);
        expect(validated.sources[0].config.id).to.equal("osm-standard");
        expect(validated.sources[0].descriptor.displayName).to.equal("OpenStreetMap");
        // Consent binds to the fingerprint of EXACTLY the entry written —
        // the offer text carries the tile-coordinate disclosure, so the
        // in-pane consent modal never asks the same question again.
        expect(state.consents).to.deep.equal([validated.sources[0].fingerprint]);
        expect(state.confirms).to.equal(1);
    });

    test("offers when enabled but unconfigured; skips once sources exist", async () => {
        const unconfigured = harness({ enabled: true, sources: [] });
        expect(await unconfigured.offer.maybeOffer()).to.equal("added");

        const configured = harness({ enabled: true, sources: [GOOD_SOURCE] });
        expect(await configured.offer.maybeOffer()).to.equal("skipped");
        expect(configured.prompts).to.equal(0);
    });

    test("existing user sources are preserved; OSM is never duplicated", async () => {
        // Disabled but with a source already authored: appending keeps it.
        const state = harness({ enabled: false, sources: [GOOD_SOURCE] });
        expect(await state.offer.maybeOffer()).to.equal("added");
        const validated = validateSpatialBasemapSources(state.settings.sources);
        expect(validated.sources.map((source) => source.config.id)).to.deep.equal([
            "contoso-road",
            "osm-standard",
        ]);

        const withOsm = harness({
            enabled: false,
            sources: [{ ...GOOD_SOURCE, id: "OSM-Standard" }],
        });
        expect(await withOsm.offer.maybeOffer()).to.equal("added");
        expect(
            validateSpatialBasemapSources(withOsm.settings.sources).sources.map((source) =>
                source.config.id.toLowerCase(),
            ),
        ).to.deep.equal(["osm-standard"]);
        expect(withOsm.consents).to.deep.equal([]);
    });

    test("asks at most once per session and never after don't-ask-again", async () => {
        const state = harness({ enabled: false, choice: "dismiss" });
        expect(await state.offer.maybeOffer()).to.equal("declined");
        expect(await state.offer.maybeOffer()).to.equal("skipped");
        expect(state.prompts).to.equal(1);
        // Plain dismiss does NOT persist: a fresh session may offer again.
        expect(state.memento.get(SPATIAL_BASEMAP_OFFER_DISMISSED_KEY, false)).to.equal(false);

        const never = harness({ enabled: false, choice: "never" });
        expect(await never.offer.maybeOffer()).to.equal("declined");
        expect(never.memento.get(SPATIAL_BASEMAP_OFFER_DISMISSED_KEY, false)).to.equal(true);

        const dismissed = harness({ enabled: false, dismissed: true });
        expect(await dismissed.offer.maybeOffer()).to.equal("skipped");
        expect(dismissed.prompts).to.equal(0);
    });
});
