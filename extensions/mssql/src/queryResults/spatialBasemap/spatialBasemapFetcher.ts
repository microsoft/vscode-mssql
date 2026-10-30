/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Host-only tile fetch (SPA-10, addendum §6.2/§7.2). HTTPS only, no redirects,
 * bounded time and size, sniffed raster media types, at most one transient
 * retry, and a resolved-address private-network re-check (DNS answers, not
 * just the configured hostname string). Failures are TYPED — provider response
 * bodies never reach the UI, markers, or logs.
 */

import {
    SPATIAL_BASEMAP_LIMITS,
    SpatialBasemapFetchResult,
    SpatialBasemapFetcherDeps,
} from "./spatialBasemapTypes";
import { isIP } from "net";
import { isPrivateNetworkHost } from "./spatialBasemapConfig";

const RASTER_SNIFFERS: readonly ((bytes: Uint8Array) => boolean)[] = [
    (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, // PNG
    (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, // JPEG
    (b) =>
        b.length > 12 &&
        b[0] === 0x52 &&
        b[1] === 0x49 &&
        b[2] === 0x46 &&
        b[3] === 0x46 &&
        b[8] === 0x57 &&
        b[9] === 0x45 &&
        b[10] === 0x42 &&
        b[11] === 0x50, // WebP (RIFF....WEBP)
];

export interface SpatialBasemapFetchOptions {
    readonly url: string;
    readonly bearerSecret?: string;
    readonly allowPrivateNetwork: boolean;
    readonly timeoutMs?: number;
    readonly maxBytes?: number;
    readonly signal?: AbortSignal;
}

async function fetchOnce(
    options: SpatialBasemapFetchOptions,
    deps: SpatialBasemapFetcherDeps,
): Promise<SpatialBasemapFetchResult | "transient"> {
    const timeoutMs = options.timeoutMs ?? SPATIAL_BASEMAP_LIMITS.fetchTimeoutMs;
    const maxBytes = options.maxBytes ?? SPATIAL_BASEMAP_LIMITS.tileBytesMax;
    const parsed = new URL(options.url);
    if (parsed.protocol !== "https:") {
        return { status: "unavailable" };
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const cancel = () => abort.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) abort.abort();
    try {
        const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
        const addresses = isIP(hostname)
            ? [hostname]
            : await Promise.race([
                  deps.lookup(hostname),
                  new Promise<never>((_resolve, reject) => {
                      const stop = () =>
                          reject(
                              Object.assign(new Error("Map request aborted"), {
                                  name: "AbortError",
                              }),
                          );
                      if (abort.signal.aborted) stop();
                      else abort.signal.addEventListener("abort", stop, { once: true });
                  }),
              ]);
        if (
            !addresses.length ||
            addresses.some(
                (address) =>
                    !isIP(address) ||
                    (!options.allowPrivateNetwork && isPrivateNetworkHost(address)),
            )
        )
            return { status: "unavailable" };
        if (abort.signal.aborted) return { status: "timeout" };
        const response = await deps.fetch(
            options.url,
            {
                method: "GET",
                redirect: "manual",
                signal: abort.signal,
                headers: {
                    accept: "image/png,image/jpeg,image/webp",
                    "user-agent": "vscode-mssql (+https://github.com/microsoft/vscode-mssql)",
                    ...(options.bearerSecret
                        ? { authorization: `Bearer ${options.bearerSecret}` }
                        : {}),
                },
            },
            addresses,
        );
        if (response.status >= 300 && response.status < 400) {
            // Redirects are refused by policy (addendum §5.2) — following one
            // would bypass the validated host.
            return { status: "unavailable" };
        }
        if (response.status === 404) {
            return { status: "notFound" };
        }
        if (response.status >= 500) {
            return "transient";
        }
        if (!response.ok || !response.body) {
            return { status: "unavailable" };
        }
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > maxBytes) {
            abort.abort();
            return { status: "tooLarge" };
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                received += value.byteLength;
                if (received > maxBytes) {
                    abort.abort();
                    return { status: "tooLarge" };
                }
                chunks.push(value);
            }
        }
        const bytes = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        if (!RASTER_SNIFFERS.some((sniff) => sniff(bytes))) {
            return { status: "badMediaType" };
        }
        return {
            status: "ok",
            bytes,
            contentType: response.headers.get("content-type") ?? "image/png",
        };
    } catch (error) {
        if ((error as Error)?.name === "AbortError") {
            return { status: "timeout" };
        }
        return "transient";
    } finally {
        clearTimeout(timer);
        abort.abort(); // Also destroys every unused redirect/error response body.
        options.signal?.removeEventListener("abort", cancel);
    }
}

/** One request plus at most one retry for transient (network/5xx) failures. */
export async function fetchSpatialBasemapTile(
    options: SpatialBasemapFetchOptions,
    deps: SpatialBasemapFetcherDeps,
): Promise<SpatialBasemapFetchResult> {
    for (let attempt = 0; attempt <= SPATIAL_BASEMAP_LIMITS.transientRetries; attempt++) {
        if (options.signal?.aborted) return { status: "unavailable" };
        const result = await fetchOnce(options, deps);
        if (result !== "transient") {
            return result;
        }
    }
    return { status: "unavailable" };
}
