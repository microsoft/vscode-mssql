/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * v1 connection label + tooltip recipes (OE_V1_PARITY_PLAN K6), copied from
 * classic `models/connectionInfo.ts getConnectionDisplayName()` and
 * `objectExplorer/nodes/connectionNode.ts getConnectionTooltip()` so the v2
 * tree reads identically: `server, database (auth)` with `<default>` for an
 * unset database, and a tooltip listing every non-default property. Kept as
 * a PURE module (tree/ may not import vscode/l10n) — strings mirror the
 * classic English l10n sources; a parity test pins the label recipe against
 * the classic function. Karl's addition over v1: when two sibling nodes tie
 * on the full label, each tooltip gains the properties that differ.
 */

/** Classic auth-type wire values (constants.ts). */
const SQL_AUTH = "SqlLogin";
const AZURE_MFA = "AzureMFA";
const INTEGRATED = "Integrated";

const DEFAULT_DATABASE_LABEL = "<default>";

/** Everything the label/tooltip recipes read off a stored profile. */
export interface OeV2ConnectionLabelFacts {
    readonly profileName?: string;
    readonly server?: string;
    readonly database?: string;
    readonly authenticationType?: string;
    readonly user?: string;
    readonly email?: string;
    readonly port?: number | string;
    readonly containerName?: string;
    readonly version?: string;
    readonly applicationIntent?: string;
    readonly connectTimeout?: number;
    readonly commandTimeout?: number;
    readonly alwaysEncrypted?: boolean | string;
    readonly replication?: boolean;
}

/**
 * The v1 display-name recipe: profileName wins; otherwise
 * `server, database (auth)` — SqlLogin shows the user, AzureMFA the email,
 * anything else (Integrated included) the raw auth type.
 */
export function connectionDisplayLabel(facts: OeV2ConnectionLabelFacts): string {
    if (facts.profileName) {
        return facts.profileName;
    }
    const authType = facts.authenticationType ?? INTEGRATED;
    let userOrAuthType: string = authType;
    if (authType === SQL_AUTH && facts.user) {
        userOrAuthType = facts.user;
    }
    if (authType === AZURE_MFA && facts.email) {
        userOrAuthType = facts.email;
    }
    const database =
        facts.database && facts.database !== "" ? facts.database : DEFAULT_DATABASE_LABEL;
    return `${facts.server ?? ""}, ${database} (${userOrAuthType})`;
}

/** Classic getDefaultConnection() values the tooltip compares against. */
const TOOLTIP_DEFAULTS: Partial<Record<TooltipKey, unknown>> = {
    authenticationType: SQL_AUTH,
    connectTimeout: 30,
    applicationIntent: "ReadWrite",
};

type TooltipKey =
    | "profileName"
    | "server"
    | "database"
    | "authenticationType"
    | "user"
    | "port"
    | "containerName"
    | "version"
    | "applicationIntent"
    | "connectTimeout"
    | "commandTimeout"
    | "alwaysEncrypted"
    | "replication";

/** English mirrors of the classic l10n labels (locConstants.ts). */
const TOOLTIP_LABELS: Record<TooltipKey, string | undefined> = {
    profileName: undefined, // rendered bare, no label (classic excludedLabelKeys)
    server: "Server",
    database: "Database",
    authenticationType: "Authentication Type",
    user: "User",
    port: "Port",
    containerName: "SQL Container Name",
    version: "SQL Container Version",
    applicationIntent: "Application Intent",
    connectTimeout: "Connection Timeout",
    commandTimeout: "Command Timeout",
    alwaysEncrypted: "Always Encrypted",
    replication: "Replication",
};

const TOOLTIP_ORDER: readonly TooltipKey[] = [
    "profileName",
    "server",
    "database",
    "authenticationType",
    "user",
    "port",
    "containerName",
    "version",
    "applicationIntent",
    "connectTimeout",
    "commandTimeout",
    "alwaysEncrypted",
    "replication",
];

function displayValue(key: TooltipKey, value: unknown, facts: OeV2ConnectionLabelFacts): string {
    if (value === AZURE_MFA || value === INTEGRATED) {
        return facts.authenticationType === AZURE_MFA ? "Azure MFA" : "Windows Authentication";
    }
    if (value === true) {
        return "Enabled";
    }
    if (value === false) {
        return "Disabled";
    }
    return String(value);
}

function tooltipLineFor(key: TooltipKey, facts: OeV2ConnectionLabelFacts): string | undefined {
    const value = facts[key];
    if (value === undefined || value === "" || value === TOOLTIP_DEFAULTS[key]) {
        return undefined;
    }
    const rendered = displayValue(key, value, facts);
    const label = TOOLTIP_LABELS[key];
    return label === undefined ? rendered : `${label}: ${rendered}`;
}

/**
 * The v1 tooltip recipe: one line per non-default property, in classic
 * order; the user line is dropped for AzureMFA/Integrated auth (classic
 * behavior — the auth line already identifies the principal path).
 * Deviation from classic (deliberate, journaled): connectTimeout compares
 * against the REAL default (30) — classic compared against a misspelled
 * defaults key and always printed it.
 */
export function connectionTooltipLines(facts: OeV2ConnectionLabelFacts): string[] {
    const dropUser =
        facts.authenticationType === AZURE_MFA || facts.authenticationType === INTEGRATED;
    const lines: string[] = [];
    for (const key of TOOLTIP_ORDER) {
        if (key === "user" && dropUser) {
            continue;
        }
        const line = tooltipLineFor(key, facts);
        if (line !== undefined) {
            lines.push(line);
        }
    }
    return lines;
}

/**
 * Karl's K6 addition: given sibling label ties, return the tooltip lines
 * each tied profile needs so a reader can tell them apart — the properties
 * whose values DIFFER within the tie group, rendered for this profile
 * (including ones at their defaults, which the base tooltip would omit).
 */
export function disambiguationLines(
    facts: OeV2ConnectionLabelFacts,
    tiedWith: readonly OeV2ConnectionLabelFacts[],
): string[] {
    if (tiedWith.length === 0) {
        return [];
    }
    const lines: string[] = [];
    for (const key of TOOLTIP_ORDER) {
        if (key === "profileName") {
            continue;
        }
        const mine = facts[key];
        const differs = tiedWith.some((other) => other[key] !== mine);
        if (!differs) {
            continue;
        }
        const label = TOOLTIP_LABELS[key] ?? key;
        const rendered =
            mine === undefined || mine === "" ? "(not set)" : displayValue(key, mine, facts);
        lines.push(`${label}: ${rendered}`);
    }
    return lines;
}
