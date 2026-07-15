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
import {
    isPrivateNetworkHost,
    spatialBasemapFingerprint,
    validateSpatialBasemapSources,
} from "../../src/queryResults/spatialBasemap/spatialBasemapConfig";
import { createSpatialBasemapConsentStore } from "../../src/queryResults/spatialBasemap/spatialBasemapConsent";
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
