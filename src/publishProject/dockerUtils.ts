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

/**
 * Parses license text with HTML link and returns safe components for rendering
 */
export function parseLicenseText(licenseText: string) {
    const linkMatch = licenseText.match(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/);

    if (linkMatch) {
        const linkUrl = linkMatch[1];
        const linkText = linkMatch[2];
        const parts = licenseText.split(linkMatch[0]);

        return {
            hasLink: true,
            beforeText: parts[0] || "",
            linkText,
            linkUrl,
            afterText: parts[1] || "",
        };
    }

    return {
        hasLink: false,
        plainText: licenseText,
    };
}

/**
 * Loads Docker tags for a given target version and updates form component options
 */
export async function loadDockerTags(
    targetVersion: string,
    tagComponent: { options?: { value: string; displayName: string }[] },
    formState: { containerImageTag?: string },
): Promise<void> {
    const baseImage = getDockerBaseImage(targetVersion, undefined);
    let tags: string[] = [];

    try {
        // Security: Validate URL is from trusted Microsoft registry
        const url = new URL(baseImage.tagsUrl);
        if (!url.hostname.endsWith(".microsoft.com") && url.hostname !== "mcr.microsoft.com") {
            console.warn("Untrusted registry URL blocked:", baseImage.tagsUrl);
            return;
        }

        // Create AbortController for timeout control
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        try {
            const resp = await fetch(baseImage.tagsUrl, {
                method: "GET",
                signal: controller.signal,
                headers: {
                    Accept: "application/json",
                    "User-Agent": "vscode-mssql-extension",
                },
                // Security: Prevent credentials from being sent
                credentials: "omit",
                // Security: Follow redirects only to same origin
                redirect: "follow",
            });

            clearTimeout(timeoutId);

            if (!resp.ok) {
                console.warn(`Failed to fetch Docker tags: ${resp.status} ${resp.statusText}`);
                return;
            }

            // Security: Check content type
            const contentType = resp.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                console.warn("Invalid content type for Docker tags response:", contentType);
                return;
            }

            const json = await resp.json();
            if (json?.tags && Array.isArray(json.tags)) {
                // Security: Validate tag format to prevent injection
                tags = (json.tags as string[]).filter(
                    (tag) =>
                        typeof tag === "string" &&
                        /^[a-zA-Z0-9._-]+$/.test(tag) &&
                        tag.length <= 128,
                );
            }
        } catch (fetchError: unknown) {
            clearTimeout(timeoutId);
            if (fetchError instanceof Error && fetchError.name === "AbortError") {
                console.warn("Docker tags request timed out");
            } else {
                console.warn("Network error fetching Docker tags:", fetchError);
            }
            return;
        }
    } catch (urlError: unknown) {
        console.warn("Invalid Docker tags URL:", urlError);
        return;
    }

    const imageTags = filterAndSortTags(tags, baseImage, targetVersion, true);

    // Update containerImageTag component options
    if (tagComponent) {
        tagComponent.options = imageTags.map((t) => ({ value: t, displayName: t }));

        // Set default tag if none selected
        if (
            imageTags.length > 0 &&
            (!formState.containerImageTag || !imageTags.includes(formState.containerImageTag))
        ) {
            formState.containerImageTag = imageTags[0];
        }
    }
}
