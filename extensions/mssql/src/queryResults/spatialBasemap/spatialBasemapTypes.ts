/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Spatial basemap host types (SPA-10, online maps addendum §5/§6). Everything
 * here is extension-host internal EXCEPT the sanitized descriptor, which is
 * the ONLY source-derived shape allowed across the webview boundary: no URL
 * template, host name, credential reference, fingerprint, or consent state
 * ever leaves the host.
 */

export interface SpatialBasemapSourceConfig {
    readonly id: string;
    readonly displayName: string;
    readonly kind: "xyzRaster";
    readonly urlTemplate: string;
    readonly minZoom?: number;
    readonly maxZoom?: number;
    readonly attribution: { readonly text: string; readonly termsUrl?: string };
    readonly credentialRef?: string;
    readonly allowPrivateNetwork?: boolean;
}

/** Sanitized, webview-safe source description (addendum §5.2). */
export interface SpatialBasemapDescriptor {
    readonly id: string;
    readonly displayName: string;
    readonly kind: "xyzRaster";
    readonly online: true;
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly attribution: { readonly text: string; readonly termsUrl?: string };
}

export type SpatialBasemapValidationCode =
    | "invalidId"
    | "duplicateId"
    | "reservedId"
    | "invalidDisplayName"
    | "unsupportedKind"
    | "invalidTemplate"
    | "insecureTemplate"
    | "templateCredentials"
    | "templatePlaceholders"
    | "privateNetwork"
    | "invalidZoom"
    | "invalidAttribution"
    | "invalidTermsUrl"
    | "invalidCredentialRef";

export interface SpatialBasemapValidationIssue {
    /** Source id when parseable, else the array index as a string. */
    readonly source: string;
    readonly code: SpatialBasemapValidationCode;
}

export interface SpatialBasemapValidatedSource {
    readonly config: SpatialBasemapSourceConfig;
    /**
     * Stable identity over id + kind + template + attribution. Consent and
     * cache entries bind to this; any change invalidates both (D-0027/D-0028).
     */
    readonly fingerprint: string;
    readonly descriptor: SpatialBasemapDescriptor;
}

export type SpatialBasemapFetchResult =
    | { readonly status: "ok"; readonly bytes: Uint8Array; readonly contentType: string }
    | {
          readonly status: "notFound" | "unavailable" | "tooLarge" | "badMediaType" | "timeout";
      };

/** Injectable network seam: tests use deterministic fakes, never the internet. */
export interface SpatialBasemapFetcherDeps {
    fetch(url: string, init: RequestInit): Promise<Response>;
    /** Resolve a hostname for the private-network gate (D-0029/addendum §5.2). */
    lookup(hostname: string): Promise<readonly string[]>;
}

/** Registered request limits (addendum §7.2; D-0029). Tune only with evidence. */
export const SPATIAL_BASEMAP_LIMITS = {
    perPanelConcurrentFetches: 4,
    globalConcurrentFetches: 12,
    tileBytesMax: 2 * 1024 * 1024,
    fetchTimeoutMs: 10_000,
    transientRetries: 1,
    zoomMin: 0,
    zoomMax: 22,
    memoryCacheBytes: 16 * 1024 * 1024,
    cacheMaxMbDefault: 128,
    cacheMaxAgeDaysDefault: 30,
    maxSessions: 4,
} as const;

export const SPATIAL_BASEMAP_RESERVED_IDS: readonly string[] = ["none", "worldoutline"];
