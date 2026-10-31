/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Basemap source configuration load + validation (SPA-10, addendum §5).
 * Application/user scope ONLY: the caller supplies the USER-level settings
 * value (never workspace inspection results), and everything here re-validates
 * from scratch — a workspace, SQL result, or webview message can neither add
 * nor alter a source (addendum §5.1, MAP-2 exit criteria).
 */

import * as crypto from "crypto";
import * as net from "net";
import {
    SPATIAL_BASEMAP_LIMITS,
    SPATIAL_BASEMAP_RESERVED_IDS,
    SpatialBasemapSourceConfig,
    SpatialBasemapValidatedSource,
    SpatialBasemapValidationIssue,
} from "./spatialBasemapTypes";

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CREDENTIAL_REF_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const PLACEHOLDER_PATTERN = /\{([^}]*)\}/g;
const MAX_DISPLAY_NAME = 64;
const MAX_ATTRIBUTION = 128;
/** Control characters make "plain text" a lie; reject rather than sanitize. */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export interface SpatialBasemapConfigResult {
    readonly sources: readonly SpatialBasemapValidatedSource[];
    readonly issues: readonly SpatialBasemapValidationIssue[];
}

function isBoundedText(value: unknown, max: number): value is string {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= max &&
        !CONTROL_CHARS.test(value)
    );
}

const PRIVATE_RANGES = new net.BlockList();
for (const [address, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
] as const) {
    PRIVATE_RANGES.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
] as const) {
    PRIVATE_RANGES.addSubnet(address, prefix, "ipv6");
}

/** Literal and resolved addresses, including IPv4-mapped IPv6. */
export function isPrivateNetworkHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    const family = net.isIP(host);
    return family === 4
        ? PRIVATE_RANGES.check(host, "ipv4")
        : family === 6
          ? PRIVATE_RANGES.check(host, "ipv6")
          : false;
}

function templateIssues(
    template: unknown,
    allowPrivateNetwork: boolean,
):
    | "invalidTemplate"
    | "insecureTemplate"
    | "templateCredentials"
    | "templatePlaceholders"
    | "privateNetwork"
    | undefined {
    if (typeof template !== "string" || template.length === 0 || template.length > 2048) {
        return "invalidTemplate";
    }
    const placeholders = [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
    const counts = new Map<string, number>();
    for (const name of placeholders) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (
        counts.get("z") !== 1 ||
        counts.get("x") !== 1 ||
        counts.get("y") !== 1 ||
        counts.size !== 3
    ) {
        return "templatePlaceholders";
    }
    let parsed: URL;
    try {
        parsed = new URL(template.replace(PLACEHOLDER_PATTERN, "0"));
    } catch {
        return "invalidTemplate";
    }
    if (parsed.protocol !== "https:") {
        return "insecureTemplate";
    }
    if (parsed.username !== "" || parsed.password !== "") {
        return "templateCredentials";
    }
    if (parsed.hash !== "") {
        return "invalidTemplate";
    }
    if (!allowPrivateNetwork && isPrivateNetworkHost(parsed.hostname)) {
        return "privateNetwork";
    }
    return undefined;
}

/** Identity that consent and cache bind to (D-0027/D-0028). */
export function spatialBasemapFingerprint(config: SpatialBasemapSourceConfig): string {
    return crypto
        .createHash("sha256")
        .update(
            [
                config.id.toLowerCase(),
                config.kind,
                config.urlTemplate,
                config.attribution.text,
                config.attribution.termsUrl ?? "",
                config.allowPrivateNetwork === true,
                config.credentialRef ?? "",
            ].join("\n"),
        )
        .digest("hex");
}

export function validateSpatialBasemapSources(raw: unknown): SpatialBasemapConfigResult {
    const sources: SpatialBasemapValidatedSource[] = [];
    const issues: SpatialBasemapValidationIssue[] = [];
    if (!Array.isArray(raw)) {
        return { sources, issues };
    }
    const seenIds = new Set<string>();
    raw.forEach((entry, index) => {
        const label = () =>
            typeof (entry as { id?: unknown })?.id === "string"
                ? (entry as { id: string }).id
                : String(index);
        const reject = (code: SpatialBasemapValidationIssue["code"]) =>
            issues.push({ source: label(), code });
        if (typeof entry !== "object" || entry === null) {
            reject("invalidTemplate");
            return;
        }
        const candidate = entry as Record<string, unknown>;
        const id = candidate.id;
        if (typeof id !== "string" || !ID_PATTERN.test(id)) {
            reject("invalidId");
            return;
        }
        if (SPATIAL_BASEMAP_RESERVED_IDS.includes(id.toLowerCase())) {
            reject("reservedId");
            return;
        }
        if (seenIds.has(id.toLowerCase())) {
            reject("duplicateId");
            return;
        }
        if (candidate.kind !== "xyzRaster") {
            reject("unsupportedKind");
            return;
        }
        if (!isBoundedText(candidate.displayName, MAX_DISPLAY_NAME)) {
            reject("invalidDisplayName");
            return;
        }
        const allowPrivateNetwork = candidate.allowPrivateNetwork === true;
        const templateIssue = templateIssues(candidate.urlTemplate, allowPrivateNetwork);
        if (templateIssue) {
            reject(templateIssue);
            return;
        }
        const minZoom = candidate.minZoom ?? SPATIAL_BASEMAP_LIMITS.zoomMin;
        const maxZoom = candidate.maxZoom ?? SPATIAL_BASEMAP_LIMITS.zoomMax;
        if (
            !Number.isInteger(minZoom) ||
            !Number.isInteger(maxZoom) ||
            (minZoom as number) < SPATIAL_BASEMAP_LIMITS.zoomMin ||
            (maxZoom as number) > SPATIAL_BASEMAP_LIMITS.zoomMax ||
            (minZoom as number) > (maxZoom as number)
        ) {
            reject("invalidZoom");
            return;
        }
        const attribution = candidate.attribution as Record<string, unknown> | undefined;
        if (!attribution || !isBoundedText(attribution.text, MAX_ATTRIBUTION)) {
            reject("invalidAttribution");
            return;
        }
        if (attribution.termsUrl !== undefined) {
            try {
                const terms = new URL(attribution.termsUrl as string);
                if (terms.protocol !== "https:" || terms.username || terms.password) {
                    reject("invalidTermsUrl");
                    return;
                }
            } catch {
                reject("invalidTermsUrl");
                return;
            }
        }
        if (
            candidate.credentialRef !== undefined &&
            (typeof candidate.credentialRef !== "string" ||
                !CREDENTIAL_REF_PATTERN.test(candidate.credentialRef))
        ) {
            reject("invalidCredentialRef");
            return;
        }
        seenIds.add(id.toLowerCase());
        const config: SpatialBasemapSourceConfig = {
            id,
            displayName: candidate.displayName as string,
            kind: "xyzRaster",
            urlTemplate: candidate.urlTemplate as string,
            minZoom: minZoom as number,
            maxZoom: maxZoom as number,
            attribution: {
                text: attribution.text as string,
                ...(attribution.termsUrl !== undefined
                    ? { termsUrl: attribution.termsUrl as string }
                    : {}),
            },
            ...(candidate.credentialRef !== undefined
                ? { credentialRef: candidate.credentialRef as string }
                : {}),
            ...(allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
        };
        sources.push({
            config,
            fingerprint: spatialBasemapFingerprint(config),
            descriptor: {
                id: config.id,
                displayName: config.displayName,
                kind: "xyzRaster",
                online: true,
                minZoom: config.minZoom ?? SPATIAL_BASEMAP_LIMITS.zoomMin,
                maxZoom: config.maxZoom ?? SPATIAL_BASEMAP_LIMITS.zoomMax,
                attribution: config.attribution,
            },
        });
    });
    return { sources, issues };
}
