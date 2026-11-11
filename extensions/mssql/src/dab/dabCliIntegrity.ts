/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Checks that an unpacked DAB CLI is the release this extension pins.
 *
 * The CLI is downloaded from whatever NuGet feed the machine uses, which can
 * be a mirror. The unpacked files are compared with a digest pinned here for
 * each release and platform.
 *
 * The digest covers the unpacked `tools/` files rather than the `.nupkg`:
 * nuget.org adds its own repository signature to every package it serves,
 * which changes the package bytes but not the files inside it. Hashing the
 * files therefore gives one value that matches the release on GitHub,
 * nuget.org, and any faithful mirror.
 *
 * The check runs after every download, before the install is marked complete,
 * and again every time a cached install is reused.
 */

import { createHash } from "crypto";
import { createReadStream } from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";

/**
 * Digest of the unpacked CLI for each release and runtime identifier. Each
 * covers the files of the tool package and its runtime package together.
 *
 * Computed from the packages attached to the Azure/data-api-builder GitHub
 * release, whose SHA-256 digests GitHub publishes, and checked against an
 * install downloaded from nuget.org. To add a release, unpack the `tools/`
 * entries of `Microsoft.DataApiBuilder.<version>.nupkg` and of
 * `Microsoft.DataApiBuilder.<rid>.<version>.nupkg` into one directory and run
 * {@link computeDabCliTreeDigest} on it.
 */
export const DAB_CLI_TREE_DIGESTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    "2.1.5": {
        "win-x64": "70c15e2f8882a5ecebcb2dda68b0d3a2fefadb0569e95d42b0898301814995b0",
        "linux-x64": "21504373b68255f90e524a112a468a05e0103cc93b2bd521ad5bd294f5a6eacb",
        "linux-arm64": "9efcdf7c4f2e49a64dca5020edf43eff7ac6a173ae71085f0fa76a877b4b0164",
        "osx-x64": "b509419516bdcc059a4bb41744cde96ba4780ba5e213f55c2aa15fbd7e2d8111",
        "osx-arm64": "39ea29afbb4874ab97ccee719f6c67a9fdcf0d20b0aaafc46d1a054918e3634b",
    },
};

/**
 * Files the extension writes beside the unpacked package, which are not part
 * of the release and so are left out of the digest.
 */
export const DAB_CLI_INSTALL_MARKERS: readonly string[] = [".installed"];

async function listFiles(root: string, directory: string = root): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await fsPromises.readdir(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listFiles(root, fullPath)));
        } else {
            // Anything that is not a plain directory is hashed as a file.
            files.push(path.relative(root, fullPath).split(path.sep).join("/"));
        }
    }
    return files;
}

function hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        createReadStream(filePath)
            .on("error", reject)
            .on("data", (chunk) => hash.update(chunk))
            .on("end", () => resolve(hash.digest("hex")));
    });
}

/**
 * Hashes every file under a directory, by its path and contents, into one
 * SHA-256 digest. Files are taken in sorted order of their forward-slash
 * relative paths, so the digest is the same on every platform.
 *
 * @param root Directory to hash
 * @param excludedFiles Relative paths at the root to leave out
 */
export async function computeDabCliTreeDigest(
    root: string,
    excludedFiles: readonly string[] = DAB_CLI_INSTALL_MARKERS,
): Promise<string> {
    const excluded = new Set(excludedFiles);
    const files = (await listFiles(root)).filter((file) => !excluded.has(file)).sort();

    const digest = createHash("sha256");
    for (const file of files) {
        digest.update(`${file}\n${await hashFile(path.join(root, ...file.split("/")))}\n`);
    }
    return digest.digest("hex");
}

/** The pinned digest for a release and runtime, or undefined when none is pinned. */
export function getPinnedDabCliTreeDigest(
    version: string,
    runtimeIdentifier: string,
): string | undefined {
    return DAB_CLI_TREE_DIGESTS[version]?.[runtimeIdentifier];
}

/**
 * True when the unpacked CLI matches the pinned release. A release or runtime
 * with no pinned digest never verifies: an unknown build is not run.
 *
 * @param installPath Directory the CLI was unpacked into
 * @param version Release that was unpacked
 * @param runtimeIdentifier Runtime the release was unpacked for
 */
export async function isOfficialDabCliInstallation(
    installPath: string,
    version: string,
    runtimeIdentifier: string,
): Promise<boolean> {
    const expected = getPinnedDabCliTreeDigest(version, runtimeIdentifier);
    if (!expected) {
        return false;
    }

    try {
        return (await computeDabCliTreeDigest(installPath)) === expected;
    } catch {
        return false;
    }
}
