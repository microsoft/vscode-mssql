/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DatabaseFacts, SqlPlatform } from "../../../sharedInterfaces/performance";
import type { DatabaseFactsResult } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { TimeRangePreset } from "../../common/timeRange/timeRange";

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

export const defaultOverviewTimeRangeId = "24h";

/** The time range presets of the overview. Labels are read when called, so they are localized. */
export function overviewTimeRangePresets(): TimeRangePreset[] {
    const text = loc.performanceDashboard;
    return [
        { id: "1h", durationMs: hourMs, label: text.pastHour },
        { id: "12h", durationMs: 12 * hourMs, label: text.past12Hours },
        { id: "24h", durationMs: dayMs, label: text.past24Hours },
        { id: "7d", durationMs: 7 * dayMs, label: text.past7Days },
        { id: "30d", durationMs: 30 * dayMs, label: text.past30Days },
    ];
}

const sqlServerYears: Readonly<Record<number, string>> = {
    13: "2016",
    14: "2017",
    15: "2019",
    16: "2022",
    17: "2025",
};

export function platformLabel(
    platform: SqlPlatform | undefined,
    majorVersion?: number,
): string | undefined {
    const text = loc.performanceDashboard;
    switch (platform) {
        case "sqlServer": {
            const year = majorVersion !== undefined ? sqlServerYears[majorVersion] : undefined;
            return year ? text.sqlServerVersion(year) : text.sqlServer;
        }
        case "azureSqlManagedInstance":
            return text.azureSqlManagedInstance;
        case "azureSqlDatabase":
            return text.azureSqlDatabase;
        case "fabricSqlDatabase":
            return text.fabricSqlDatabase;
        case "synapseDedicated":
            return text.synapseDedicated;
        case "synapseServerless":
            return text.synapseServerless;
        case "fabricWarehouse":
            return text.fabricWarehouse;
        case "fabricSqlAnalyticsEndpoint":
            return text.fabricSqlAnalyticsEndpoint;
        default:
            return undefined;
    }
}

/** "GeneralPurpose" becomes "General Purpose". An edition with spaces stays as it is. */
export function editionLabel(edition: string): string {
    return edition.includes(" ") ? edition : edition.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * The size of the database: the service objective of the DTU model and of Synapse, such as "S2"
 * or "DW100c", else the vCores, else the logical CPUs of SQL Server.
 */
export function sizeLabel(facts: DatabaseFacts): string | undefined {
    const text = loc.performanceDashboard;
    const count = new Intl.NumberFormat();
    // vCore objectives start with GP_, BC_, or HS_; the vCore count says more.
    if (facts.serviceObjective && !/^(GP|BC|HS)_/i.test(facts.serviceObjective)) {
        return facts.serviceObjective;
    }
    if (facts.vCores !== undefined) {
        return facts.vCores === 1 ? text.oneVCore : text.vCores(count.format(facts.vCores));
    }
    if (facts.logicalCpus !== undefined) {
        return facts.logicalCpus === 1
            ? text.oneLogicalCpu
            : text.logicalCpus(count.format(facts.logicalCpus));
    }
    return facts.serviceObjective;
}

/**
 * The parts of the facts line, for example "Azure SQL Database", "General Purpose", and
 * "8 vCores". Empty without facts.
 */
export function databaseFactsParts(result: DatabaseFactsResult | undefined): string[] {
    const facts = result?.facts;
    // A Synapse dedicated pool's edition is always "DataWarehouse"; its objective says more.
    const edition =
        facts?.edition && result?.platform !== "synapseDedicated"
            ? editionLabel(facts.edition)
            : undefined;
    // The Basic tier has the objective "Basic" too, so the size is left out when it repeats.
    const size = facts && sizeLabel(facts);
    return [
        platformLabel(result?.platform, result?.majorVersion),
        edition,
        size !== edition ? size : undefined,
    ].filter((part): part is string => !!part);
}

export interface DatabaseFactItem {
    readonly label: string;
    readonly value: string;
}

/** "Enterprise Developer Edition (64-bit)" becomes "Enterprise Developer". */
export function shortEditionLabel(edition: string): string {
    return editionLabel(edition)
        .replace(/\s*\(64-bit\)/i, "")
        .replace(/\s+Edition$/i, "")
        .trim();
}

/**
 * The labeled facts of the header, for example Version "SQL Server 2025 Enterprise Developer"
 * and CPUs "16", or Version "Azure SQL Database", Tier "General Purpose", and vCores "8".
 * Empty without facts.
 */
export function databaseFactsItems(result: DatabaseFactsResult | undefined): DatabaseFactItem[] {
    const text = loc.performanceDashboard;
    const facts = result?.facts;
    const platform = platformLabel(result?.platform, result?.majorVersion);
    if (!platform) {
        return [];
    }
    const count = new Intl.NumberFormat();
    // SQL Server's edition is part of its version. A cloud edition is a tier; Synapse's is
    // always "DataWarehouse", so it is left out.
    const boxEdition =
        result?.platform === "sqlServer" && facts?.edition
            ? shortEditionLabel(facts.edition)
            : undefined;
    const tier =
        result?.platform !== "sqlServer" &&
        result?.platform !== "azureSqlManagedInstance" &&
        result?.platform !== "synapseDedicated" &&
        facts?.edition
            ? editionLabel(facts.edition)
            : undefined;
    // A DTU or Synapse objective, such as "S2" or "DW100c". The Basic tier's objective repeats it.
    const objective =
        facts?.serviceObjective &&
        !/^(GP|BC|HS)_/i.test(facts.serviceObjective) &&
        facts.serviceObjective !== tier
            ? facts.serviceObjective
            : undefined;
    const items: (DatabaseFactItem | undefined)[] = [
        { label: text.versionLabel, value: boxEdition ? `${platform} ${boxEdition}` : platform },
        tier ? { label: text.tierLabel, value: tier } : undefined,
        objective ? { label: text.objectiveLabel, value: objective } : undefined,
        facts?.vCores !== undefined
            ? { label: text.vCoresLabel, value: count.format(facts.vCores) }
            : facts?.logicalCpus !== undefined
              ? { label: text.cpusLabel, value: count.format(facts.logicalCpus) }
              : undefined,
    ];
    return items.filter((item): item is DatabaseFactItem => !!item);
}
