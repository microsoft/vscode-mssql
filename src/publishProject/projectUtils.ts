/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import * as constants from "../constants/constants";
import { SqlProjectsService } from "../services/sqlProjectsService";

// Shape returned by sqlProjectsService.getProjectProperties (partial, only fields we use)
export interface ProjectProperties {
    projectGuid?: string;
    configuration?: string;
    outputPath: string;
    databaseSource?: string;
    defaultCollation: string;
    databaseSchemaProvider: string;
    projectStyle: unknown;
    targetVersion?: string;
}

/**
 * Target platforms for a sql project
 */
export const enum SqlTargetPlatform {
    sqlServer2012 = "SQL Server 2012",
    sqlServer2014 = "SQL Server 2014",
    sqlServer2016 = "SQL Server 2016",
    sqlServer2017 = "SQL Server 2017",
    sqlServer2019 = "SQL Server 2019",
    sqlServer2022 = "SQL Server 2022",
    sqlAzure = "Azure SQL Database",
    sqlDW = "Azure Synapse SQL Pool",
    sqlEdge = "Azure SQL Edge",
    sqlDwServerless = "Azure Synapse Serverless SQL Pool",
    sqlDwUnified = "Synapse Data Warehouse in Microsoft Fabric",
    sqlDbFabric = "SQL database in Fabric (preview)",
}

/**
 * SQL target platforms Map to their corresponding version numbers
 * Note: the values here must match values from Microsoft.Data.Tools.Schema.SchemaModel.SqlPlatformNames
 */
export const targetPlatformToVersion: Map<string, string> = new Map<string, string>([
    [SqlTargetPlatform.sqlServer2012, "110"],
    [SqlTargetPlatform.sqlServer2014, "120"],
    [SqlTargetPlatform.sqlServer2016, "130"],
    [SqlTargetPlatform.sqlServer2017, "140"],
    [SqlTargetPlatform.sqlServer2019, "150"],
    [SqlTargetPlatform.sqlServer2022, "160"],
    [SqlTargetPlatform.sqlAzure, "AzureV12"],
    [SqlTargetPlatform.sqlDW, "Dw"],
    [SqlTargetPlatform.sqlDwServerless, "Serverless"],
    [SqlTargetPlatform.sqlDwUnified, "DwUnified"],
    [SqlTargetPlatform.sqlDbFabric, "DbFabric"],
]);

/**
 * Get project properties from the tools service and extract the target platform version portion
 * of the DatabaseSchemaProvider (e.g. 130, 150, 160, AzureV12, AzureDw, etc.).
 * Returns undefined if it cannot be determined or the service call fails.
 */
export async function getProjectTargetVersion(
    sqlProjectsService: SqlProjectsService | mssql.ISqlProjectsService,
    projectFilePath: string,
): Promise<string | undefined> {
    try {
        if (!projectFilePath) {
            return undefined;
        }
        const result = await sqlProjectsService.getProjectProperties(projectFilePath);
        if (!result?.success) {
            return undefined;
        }
        const dsp = result.databaseSchemaProvider;
        if (!dsp || !dsp.startsWith(constants.DSP_PREFIX) || !dsp.endsWith(constants.DSP_SUFFIX)) {
            return undefined;
        }
        const version = dsp.substring(
            constants.DSP_PREFIX.length,
            dsp.length - constants.DSP_SUFFIX.length,
        );
        // Basic sanity check: version should be non-empty and alphanumeric-ish
        if (!version || /[^A-Za-z0-9]/.test(version)) {
            return undefined;
        }
        return version;
    } catch {
        return undefined; // swallow errors to keep publish dialog resilient
    }
}

/**
 * Reads full project properties and augments with extracted targetVersion.
 * Returns undefined if retrieval fails.
 */
export async function readProjectProperties(
    sqlProjectsService: SqlProjectsService | mssql.ISqlProjectsService,
    projectFilePath: string,
): Promise<ProjectProperties | undefined> {
    try {
        if (!projectFilePath) {
            return undefined;
        }
        const result = await sqlProjectsService.getProjectProperties(projectFilePath as string);
        if (!result?.success) {
            return undefined;
        }
        const version = await getProjectTargetVersion(sqlProjectsService, projectFilePath);
        const props: ProjectProperties = {
            projectGuid: result.projectGuid,
            configuration: result.configuration,
            outputPath: result.outputPath,
            databaseSource: result.databaseSource,
            defaultCollation: result.defaultCollation,
            databaseSchemaProvider: result.databaseSchemaProvider,
            projectStyle: result.projectStyle,
            targetVersion: version,
        };
        return props;
    } catch {
        return undefined;
    }
}

export function getPublishServerName(target: string) {
    return target ===
        targetPlatformToVersion.get("Azure SQL Database" /* SqlTargetPlatform.sqlAzure */)
        ? constants.AzureSqlServerName
        : constants.SqlServerName;
}

/**
 * Checks if preview features are enabled in VS Code settings for SQL Database Projects.
 * @returns true if preview features are enabled, false otherwise
 */
export function isPreviewFeaturesEnabled(): boolean {
    return (
        vscode.workspace
            .getConfiguration(constants.DBProjectConfigurationKey)
            .get<boolean>(constants.enablePreviewFeaturesKey) ?? false
    );
}

/*
 * Validates the SQL Server port number.
 */
export function validateSqlServerPortNumber(port: string | number | undefined): boolean {
    if (port === undefined) {
        return false;
    }
    const str = String(port).trim();
    if (str.length === 0) {
        return false;
    }
    // Must be all digits
    if (!/^[0-9]+$/.test(str)) {
        return false;
    }
    const n = Number(str);
    return n >= 1 && n <= constants.MAX_PORT_NUMBER;
}

/**
 * Returns true if password meets SQL complexity (length 8-128, does not contain login name,
 * and contains at least 3 of 4 categories: upper, lower, digit, symbol).
 */
export function isValidSqlAdminPassword(password: string, userName = "sa"): boolean {
    if (!password) {
        return false;
    }
    const containsUserName = !!userName && password.toUpperCase().includes(userName.toUpperCase());
    if (containsUserName) {
        return false;
    }
    if (password.length < 8 || password.length > 128) {
        return false;
    }
    const hasUpper = /[A-Z]/.test(password) ? 1 : 0;
    const hasLower = /[a-z]/.test(password) ? 1 : 0;
    const hasDigit = /\d/.test(password) ? 1 : 0;
    const hasSymbol = /\W/.test(password) ? 1 : 0;
    return hasUpper + hasLower + hasDigit + hasSymbol >= 3;
}

/**
 * Parses HTML string with anchor tags into a structured format suitable for React rendering.
 * Converts <a href="url" ...>text</a> tags into React-compatible elements.
 *
 * @param html - HTML string potentially containing anchor tags
 * @returns Object with parts array (text/link segments) or undefined if no HTML
 *
 * @example
 * const result = parseHtmlLabel('I accept the <a href="https://example.com">Terms</a>');
 * // Returns: { parts: ['I accept the ', { href: 'https://example.com', text: 'Terms' }] }
 */
export function parseHtmlLabel(
    html: string | undefined,
): { parts: Array<string | { href: string; text: string }> } | undefined {
    if (!html) return undefined;

    // Simple parser for anchor tags - matches <a href="url" ...>text</a>
    const anchorRegex = /<a\s+([^>]*?)href="([^"]*)"([^>]*?)>(.*?)<\/a>/gi;

    const parts: Array<string | { href: string; text: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | undefined;

    while ((match = anchorRegex.exec(html) ?? undefined)) {
        // Add text before the link
        if (match.index > lastIndex) {
            parts.push(html.substring(lastIndex, match.index));
        }

        // Add the link metadata
        const href = match[2];
        const linkText = match[4];
        parts.push({ href, text: linkText });

        lastIndex = anchorRegex.lastIndex;
    }

    // Add remaining text after last link
    if (lastIndex < html.length) {
        parts.push(html.substring(lastIndex));
    }

    return parts.length > 0 ? { parts } : undefined;
}
