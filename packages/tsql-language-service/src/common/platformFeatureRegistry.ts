/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FeatureAvailability, TsqlFeatureProfile } from "./engineCapabilities.js";
import { describeProfile, sqlServerProductName } from "./engineCapabilities.js";
import type { SqlEngineProfile } from "./engineProfile.js";
import { engineProfileDisplayName } from "./engineProfile.js";
import { platformFeatures } from "./platformFeatureDefinitions.js";
import type { PlatformFeature, StatementFamily } from "./platformFeatureDefinitions.js";

/**
 * The statement families the dialect inventory groups scenarios by. The list is closed so a new
 * feature cannot invent a family the readiness report does not know how to total.
 */
export type { PlatformFeature, StatementFamily } from "./platformFeatureDefinitions.js";

/** The dedicated diagnostic code every availability decision publishes. */
export const featureAvailabilityDiagnosticCode = "FeatureNotAvailable";

/** Why a feature is unavailable, so a host can present the four cases differently. */
export type FeatureRestrictionKind = "profile" | "version" | "removed" | "preview";

/** The structured payload attached to an availability diagnostic. */
export interface FeatureAvailabilityDetail {
    readonly featureId: string;
    readonly displayName: string;
    readonly family: StatementFamily;
    readonly kind: FeatureRestrictionKind;
    readonly profile: SqlEngineProfile;
    /** One sentence naming what the construct needs. */
    readonly requirement: string;
    readonly documentationKey?: string;
}

const registry = platformFeatures;

const byId = new Map(registry.map((feature) => [feature.id, feature]));
const byNode = buildNodeIndex(registry);

function buildNodeIndex(
    features: readonly PlatformFeature[],
): ReadonlyMap<string, readonly PlatformFeature[]> {
    const index = new Map<string, PlatformFeature[]>();
    for (const feature of features) {
        for (const node of feature.nodes) {
            const bucket = index.get(node);
            if (bucket) bucket.push(feature);
            else index.set(node, [feature]);
        }
    }
    return index;
}

/** Every registered feature, in declaration order. */
export { platformFeatures };

/** Every grammar node name the registry gates. */
export const platformFeatureNodes: readonly string[] = Object.freeze([...byNode.keys()].sort());

export function platformFeatureById(id: string): PlatformFeature | undefined {
    return byId.get(id);
}

export function platformFeaturesForNode(nodeName: string): readonly PlatformFeature[] {
    return byNode.get(nodeName) ?? [];
}

/**
 * Selects the single feature a node carries.
 *
 * `text` is the node's own source slice; it participates only through {@link PlatformFeature.textPattern},
 * which separates spellings that share one structural node such as `BACKUP` and `DUMP`.
 */
export function platformFeatureForNode(
    nodeName: string,
    text: string,
): PlatformFeature | undefined {
    const candidates = byNode.get(nodeName);
    if (!candidates) return undefined;
    for (const feature of candidates) {
        if (feature.textPattern === undefined) return feature;
        if (feature.textPattern.test(text)) return feature;
    }
    return undefined;
}

/** Whether the feature may be used under the profile, or whether the answer must wait. */
export function featureAvailability(
    feature: PlatformFeature,
    profile: TsqlFeatureProfile,
): FeatureAvailability {
    const restriction = featureRestriction(feature, profile);
    if (restriction === undefined) return "available";
    return restriction === "deferred" ? "deferred" : "unavailable";
}

/**
 * The restriction that applies, `"deferred"` when a required fact is missing, or `undefined` when
 * the feature is available.
 */
function featureRestriction(
    feature: PlatformFeature,
    profile: TsqlFeatureProfile,
): FeatureRestrictionKind | "deferred" | undefined {
    if (feature.requiresPreview === true && profile.previewFeatures !== true) return "preview";
    if (feature.profiles !== undefined && !feature.profiles.includes(profile.engineProfile)) {
        return profile.engineProfile === "unknown" ? "deferred" : "profile";
    }
    if (feature.minimumServer !== undefined) {
        if (profile.serverMajorVersion === undefined) return "deferred";
        if (profile.serverMajorVersion < feature.minimumServer) return "version";
    }
    if (feature.minimumCompatibility !== undefined) {
        if (profile.compatibilityLevel === undefined) return "deferred";
        if (profile.compatibilityLevel < feature.minimumCompatibility) return "version";
    }
    if (feature.maximumCompatibility !== undefined) {
        if (profile.compatibilityLevel === undefined) return "deferred";
        if (profile.compatibilityLevel > feature.maximumCompatibility) return "removed";
    }
    return undefined;
}

/** The structured availability detail, or `undefined` when the feature is available or deferred. */
export function featureAvailabilityDetail(
    feature: PlatformFeature,
    profile: TsqlFeatureProfile,
): FeatureAvailabilityDetail | undefined {
    const restriction = featureRestriction(feature, profile);
    if (restriction === undefined || restriction === "deferred") return undefined;
    return Object.freeze({
        featureId: feature.id,
        displayName: feature.displayName,
        family: feature.family,
        kind: restriction,
        profile: profile.engineProfile,
        requirement: featureRequirement(feature, restriction),
        ...(feature.documentationKey === undefined
            ? {}
            : { documentationKey: feature.documentationKey }),
    });
}

/** One sentence naming what the construct needs. */
export function featureRequirement(feature: PlatformFeature, kind: FeatureRestrictionKind): string {
    switch (kind) {
        case "preview":
            return "It requires preview language features to be enabled.";
        case "profile": {
            const names = (feature.profiles ?? []).map(engineProfileDisplayName);
            return `It is available on ${joinWithOr(names)}.`;
        }
        case "removed":
            return `It was removed after database compatibility level ${feature.maximumCompatibility}.`;
        case "version": {
            const parts: string[] = [];
            if (feature.minimumServer !== undefined) {
                parts.push(`SQL Server ${sqlServerProductName(feature.minimumServer)} or later`);
            }
            if (feature.minimumCompatibility !== undefined) {
                parts.push(
                    `database compatibility level ${feature.minimumCompatibility} or higher`,
                );
            }
            return `It requires ${parts.join(" with ")}.`;
        }
    }
}

/** The message an availability diagnostic publishes. */
export function featureAvailabilityMessage(
    feature: PlatformFeature,
    profile: TsqlFeatureProfile,
    detail: FeatureAvailabilityDetail,
): string {
    const where = describeProfile(
        profile.engineProfile,
        profile.serverMajorVersion,
        profile.compatibilityLevel,
    );
    const subject =
        feature.statementUnavailable || feature.keyword === undefined
            ? feature.displayName
            : `${feature.displayName} (near '${feature.keyword}')`;
    return `${subject} is not available on ${where}. ${detail.requirement}`;
}

/**
 * Keywords whose every registered feature is unavailable on the profile.
 *
 * This is only half the question a caller needs. A word here may still be ordinary T-SQL — `ALL`
 * spells `UNION ALL` and `GRANT ALL` as well as Fabric's `GROUP BY ALL` — so a caller must also
 * check the general keyword catalogue before withholding one. `platformOnlyKeywords` does that.
 */
export function unavailableFeatureKeywords(profile: TsqlFeatureProfile): ReadonlySet<string> {
    const byKeyword = new Map<string, { available: number; total: number }>();
    for (const feature of registry) {
        if (feature.keyword === undefined) continue;
        const key = feature.keyword.toUpperCase();
        const entry = byKeyword.get(key) ?? { available: 0, total: 0 };
        entry.total++;
        // A deferred feature counts as available: an unidentified engine must not lose a word.
        if (featureAvailability(feature, profile) !== "unavailable") entry.available++;
        byKeyword.set(key, entry);
    }
    const withheld = new Set<string>();
    for (const [keyword, entry] of byKeyword) {
        if (entry.available === 0) withheld.add(keyword);
    }
    return withheld;
}

/**
 * Every keyword the registry names, so completion can offer a dialect word the general keyword
 * catalogue does not carry. Availability is applied separately by {@link platformOnlyKeywords}.
 */
export const platformFeatureKeywords: readonly string[] = Object.freeze([
    ...new Set(
        registry
            .map((feature) => feature.keyword)
            .filter((keyword): keyword is string => keyword !== undefined)
            .map((keyword) => keyword.toUpperCase()),
    ),
]);

/**
 * The words completion must withhold on a profile.
 *
 * A word is withheld only when every feature that names it is unavailable *and* the general keyword
 * catalogue does not carry it. That second condition is what keeps ordinary T-SQL intact: `ALL` is
 * named only by Fabric features here, but it is a reserved word everywhere, so it stays offered.
 * `CLUSTER`, `PREDICT`, and `CLASSIFIER` are absent from the catalogue and appear only through this
 * registry, so they are offered exactly where they run.
 *
 * @param generalKeywords the reserved and contextual catalogue, upper-cased.
 */
export function platformOnlyKeywords(
    profile: TsqlFeatureProfile,
    generalKeywords: ReadonlySet<string>,
): ReadonlySet<string> {
    const withheld = new Set<string>();
    for (const keyword of unavailableFeatureKeywords(profile)) {
        if (!generalKeywords.has(keyword)) withheld.add(keyword);
    }
    return withheld;
}

function joinWithOr(names: readonly string[]): string {
    if (names.length === 0) return "no profile";
    if (names.length === 1) return names[0]!;
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}
