/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import { targetPlatformToVersion } from "./projectUtils";

export interface AgreementInfoLink {
    text: string;
    url: string;
}
export interface AgreementInfo {
    link: AgreementInfoLink;
}
export interface DockerImageInfo {
    name: string;
    displayName: string;
    agreementInfo: AgreementInfo;
    tagsUrl: string;
    defaultTag: string;
}

/**
 * Returns SQL version number from docker image name which is in the beginning of the image name
 * @param imageName docker image name
 * @returns SQL server version
 */
function findSqlVersionInImageName(imageName: string, regex?: RegExp): number | undefined {
    // Regex to find the version in the beginning of the image name
    // e.g. 2017-CU16-ubuntu, 2019-latest
    if (!regex) {
        regex = new RegExp("^([0-9]+)[-].+$");
    }

    if (regex.test(imageName)) {
        const finds = regex.exec(imageName);
        if (finds) {
            // 0 is the full match and 1 is the number with pattern inside the first ()
            return +finds[1];
        }
    }
    return undefined;
}

// Extract a version year from a target platform string
function findSqlVersionInTargetPlatform(target: string | undefined): number | undefined {
    if (!target) {
        return undefined;
    }
    const regex = new RegExp("([0-9]+)$");
    return findSqlVersionInImageName(target, regex);
}

export function getTargetPlatformFromVersion(version: string): string {
    return Array.from(targetPlatformToVersion.keys()).filter(
        (k) => targetPlatformToVersion.get(k) === version,
    )[0];
}

/**
 * Returns the list of image tags for given target
 * @param rawTags docker image tags info
 * @param target project target version
 * @param defaultTagFirst whether the default tag should be the first entry in the array
 * @returns image tags
 */
export function filterAndSortTags(
    rawTags: string[],
    imageInfo: DockerImageInfo,
    target: string,
    defaultTagFirst?: boolean,
): string[] {
    const versionToImageTags: Map<number, string[]> = new Map<number, string[]>();
    let imageTags: string[] | undefined = [];
    if (rawTags) {
        // Create a map for version and tags and find the max version in the list
        let defaultVersion = 0;
        let maxVersionNumber: number = defaultVersion;
        (rawTags as string[]).forEach((imageTag) => {
            const version = findSqlVersionInImageName(imageTag) || defaultVersion;
            let tags = versionToImageTags.has(version) ? versionToImageTags.get(version) : [];
            tags = tags ?? [];
            tags = tags?.concat(imageTag);
            versionToImageTags.set(version, tags);
            maxVersionNumber = version && version > maxVersionNumber ? version : maxVersionNumber;
        });

        // Find the version maps to the target framework and default to max version in the tags
        const targetVersion =
            findSqlVersionInTargetPlatform(getTargetPlatformFromVersion(target)) ||
            maxVersionNumber;

        // Get the image tags with no version of the one that matches project platform
        versionToImageTags.forEach((tags: string[], version: number) => {
            if (version === defaultVersion || version >= targetVersion) {
                imageTags = imageTags?.concat(tags);
            }
        });

        imageTags = imageTags ?? [];
        imageTags = imageTags.sort((a, b) =>
            a.indexOf(constants.dockerImageDefaultTag) > 0 ? -1 : a.localeCompare(b),
        );

        if (defaultTagFirst) {
            const defaultIndex = imageTags.findIndex((i) => i === imageInfo.defaultTag);
            if (defaultIndex > -1) {
                imageTags.splice(defaultIndex, 1);
                imageTags.unshift(imageInfo.defaultTag);
            }
        }
    }
    return imageTags;
}

export function getDockerBaseImage(target: string, azureTargetVersion?: string): DockerImageInfo {
    return {
        name: `${constants.sqlServerDockerRegistry}/${constants.sqlServerDockerRepository}`,
        displayName:
            azureTargetVersion && target === azureTargetVersion
                ? constants.AzureSqlDbFullDockerImageName
                : constants.SqlServerDockerImageName,
        agreementInfo: {
            link: {
                text: "Microsoft SQL Server License Agreement",
                url: constants.sqlServerEulaLink,
            },
        },
        tagsUrl: `https://${constants.sqlServerDockerRegistry}/v2/${constants.sqlServerDockerRepository}/tags/list`,
        defaultTag: constants.dockerImageDefaultTag,
    };
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
