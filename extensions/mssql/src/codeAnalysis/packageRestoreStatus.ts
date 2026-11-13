/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";

/** A NuGet package referenced by the .sqlproj. */
export interface ProjectPackageReference {
    name: string;
    /** Version or version range from the .sqlproj; undefined when it isn't set on the reference. */
    version?: string;
}

/** Subset of NuGet's obj/project.assets.json that restore-status detection reads. */
interface ProjectAssets {
    libraries?: Record<string, { type?: string }>;
    project?: {
        frameworks?: Record<
            string,
            { dependencies?: Record<string, { target?: string; version?: string }> }
        >;
    };
    logs?: { level?: string }[];
}

/**
 * Reads the NuGet assets file that restore writes for a project, the same file STS reads to find
 * custom code analysis rule assemblies.
 * @returns the file contents, or undefined if the project hasn't been restored
 */
export async function readProjectAssetsFile(projectFilePath: string): Promise<string | undefined> {
    const assetsFilePath = path.join(path.dirname(projectFilePath), "obj", "project.assets.json");
    try {
        return await fs.promises.readFile(assetsFilePath, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}

/**
 * Determines whether the last NuGet restore is out of sync with the package references in the
 * .sqlproj, meaning custom code analysis rules from analyzer packages may be missing or stale.
 * @param packageReferences NuGet packages referenced by the .sqlproj
 * @param assetsFileContents contents of obj/project.assets.json, or undefined if it doesn't exist
 * @returns true if a restore is needed to bring the packages in line with the .sqlproj
 */
export function isPackageRestoreOutOfSync(
    packageReferences: ProjectPackageReference[],
    assetsFileContents: string | undefined,
): boolean {
    // References without a name (e.g. <PackageReference Update="..."/>) can't be matched.
    packageReferences = packageReferences.filter((reference) => reference.name?.trim());
    if (packageReferences.length === 0) {
        return false;
    }
    if (assetsFileContents === undefined) {
        return true;
    }

    let assets: ProjectAssets;
    try {
        // Strip a UTF-8 BOM if present; JSON.parse rejects it.
        assets = JSON.parse(assetsFileContents.replace(/^\uFEFF/, "")) as ProjectAssets;
    } catch {
        return true;
    }

    // NuGet still writes the assets file when restore fails (e.g. NU1102), recording the errors.
    if ((assets.logs ?? []).some((log) => log.level?.toLowerCase() === "error")) {
        return true;
    }

    const frameworks = Object.values(assets.project?.frameworks ?? {});
    const resolvedPackageNames = new Set(
        Object.entries(assets.libraries ?? {})
            .filter(([, library]) => library.type?.toLowerCase() === "package")
            .map(([key]) => key.split("/")[0].toLowerCase()),
    );

    return packageReferences.some((reference) => {
        const name = reference.name.toLowerCase();
        if (!resolvedPackageNames.has(name)) {
            return true;
        }
        const expectedRange = normalizeVersionRange(reference.version);
        return frameworks.some((framework) => {
            const dependency = Object.entries(framework.dependencies ?? {}).find(
                ([dependencyName]) => dependencyName.toLowerCase() === name,
            )?.[1];
            if (!dependency) {
                return true;
            }
            // Only compare versions that can be normalized; floating versions, MSBuild properties,
            // and centrally managed versions aren't comparable to what the assets file records.
            const restoredRange = normalizeVersionRange(dependency.version);
            return (
                expectedRange !== undefined &&
                restoredRange !== undefined &&
                expectedRange !== restoredRange
            );
        });
    });
}

/**
 * Normalizes a NuGet version or version range so a .sqlproj Version can be compared with the range
 * NuGet records in project.assets.json (a plain "1.0" is recorded as "[1.0.0, )").
 * @returns the normalized range, or undefined if it can't be compared reliably
 */
function normalizeVersionRange(versionSpec: string | undefined): string | undefined {
    const spec = versionSpec?.trim();
    if (!spec || spec.includes("*") || spec.includes("$")) {
        return undefined;
    }

    const open = spec[0];
    const close = spec[spec.length - 1];
    if ((open === "[" || open === "(") && (close === "]" || close === ")")) {
        const bounds = spec.slice(1, -1).split(",");
        if (bounds.length === 1) {
            // "[1.0]" is an exact version
            const exact = normalizeVersion(bounds[0]);
            return exact ? `[${exact}, ${exact}]` : undefined;
        }
        if (bounds.length !== 2) {
            return undefined;
        }
        const [lower, upper] = bounds.map((bound) =>
            bound.trim() === "" ? "" : normalizeVersion(bound),
        );
        if (lower === undefined || upper === undefined) {
            return undefined;
        }
        return `${open}${lower}, ${upper}${close}`;
    }

    const minimum = normalizeVersion(spec);
    return minimum ? `[${minimum}, )` : undefined;
}

/**
 * Normalizes a NuGet version the way NuGet does: at least three numeric parts, a fourth part only
 * when non-zero, a case-insensitive prerelease label, and no build metadata.
 */
function normalizeVersion(version: string): string | undefined {
    const match =
        /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
            version.trim(),
        );
    if (!match) {
        return undefined;
    }
    const [, major, minor, patch, revision, prerelease] = match;
    const parts = [major, minor ?? "0", patch ?? "0"].map((part) => Number(part));
    if (revision !== undefined && Number(revision) !== 0) {
        parts.push(Number(revision));
    }
    return `${parts.join(".")}${prerelease?.toLowerCase() ?? ""}`;
}
