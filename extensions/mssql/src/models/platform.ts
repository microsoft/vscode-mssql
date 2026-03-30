/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child_process from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as semver from "semver";
import * as plist from "plist";

const unknown = "unknown";

export enum Runtime {
    Unknown = "Unknown",
    // Windows
    Windows_64 = "Windows_64",
    Windows_ARM64 = "Windows_ARM64",
    // macOS
    OSX = "OSX",
    OSX_ARM64 = "OSX_ARM64",
    // Linux distributions
    Linux = "Linux",
    Linux_ARM64 = "Linux_ARM64",
    // OS-agnostic (framework-dependent)
    Portable = "Portable",
}

export function getRuntimeDisplayName(runtime: Runtime | undefined): string {
    switch (runtime) {
        case Runtime.Windows_64:
        case Runtime.Windows_ARM64:
            return "Windows";
        case Runtime.OSX:
        case Runtime.OSX_ARM64:
            return "OSX";
        case Runtime.Linux:
        case Runtime.Linux_ARM64:
            return "Linux";
        case Runtime.Portable:
            return "Portable";
        default:
            return "Unknown";
    }
}

/**
 * There is no standard way on Linux to find the distribution name and version.
 * Recently, systemd has pushed to standardize the os-release file. This has
 * seen adoption in "recent" versions of all major distributions.
 * https://www.freedesktop.org/software/systemd/man/os-release.html
 */
export class LinuxDistribution {
    public constructor(
        public name: string,
        public version: string,
        public idLike?: string[],
    ) {}

    public static async getCurrent(): Promise<LinuxDistribution> {
        // Try /etc/os-release and fallback to /usr/lib/os-release per the synopsis
        // at https://www.freedesktop.org/software/systemd/man/os-release.html.
        try {
            return await LinuxDistribution.fromFilePath("/etc/os-release");
        } catch {
            try {
                return await LinuxDistribution.fromFilePath("/usr/lib/os-release");
            } catch {
                return new LinuxDistribution(unknown, unknown);
            }
        }
    }

    public toString(): string {
        return `name=${this.name}, version=${this.version}`;
    }

    private static async fromFilePath(filePath: string): Promise<LinuxDistribution> {
        const fileData = await fs.readFile(filePath, "utf8");
        return LinuxDistribution.fromReleaseInfo(fileData);
    }

    public static fromReleaseInfo(releaseInfo: string, eol: string = os.EOL): LinuxDistribution {
        let name = unknown;
        let version = unknown;
        let idLike: string[] = undefined;

        const lines = releaseInfo.split(eol);
        for (let line of lines) {
            line = line.trim();

            let equalsIndex = line.indexOf("=");
            if (equalsIndex >= 0) {
                let key = line.substring(0, equalsIndex);
                let value = line.substring(equalsIndex + 1);

                // Strip quotes if necessary
                if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                } else if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) {
                    value = value.substring(1, value.length - 1);
                }

                if (key === "ID") {
                    name = value;
                } else if (key === "VERSION_ID") {
                    version = value;
                } else if (key === "ID_LIKE") {
                    idLike = value.split(" ");
                }

                if (name !== unknown && version !== unknown && idLike !== undefined) {
                    break;
                }
            }
        }

        return new LinuxDistribution(name, version, idLike);
    }
}
export class PlatformInformation {
    public runtimeId: Runtime;

    public constructor(
        public platform: string,
        public architecture: string,
        public distribution: LinuxDistribution = undefined,
    ) {
        try {
            this.runtimeId = PlatformInformation.getRuntimeId(platform, architecture, distribution);
        } catch (err) {
            this.runtimeId = undefined;
        }
    }

    public get isWindows(): boolean {
        return this.platform === "win32";
    }

    public get isMacOS(): boolean {
        return this.platform === "darwin";
    }

    public get isLinux(): boolean {
        return this.platform === "linux";
    }

    public get isValidRuntime(): boolean {
        return this.runtimeId !== undefined && this.runtimeId !== Runtime.Unknown;
    }

    public getRuntimeDisplayName(): string {
        return getRuntimeDisplayName(this.runtimeId);
    }

    public async isMacVersionLessThan(version: string): Promise<boolean> {
        if (this.isMacOS) {
            try {
                const systemVersion = await fs.readFile(
                    "/System/Library/CoreServices/SystemVersion.plist",
                    "utf-8",
                );
                let versionInfo = plist.parse(systemVersion);
                if (
                    versionInfo &&
                    versionInfo["ProductVersion"] &&
                    semver.lt(versionInfo["ProductVersion"], version)
                ) {
                    return true;
                }
            } catch (e) {
                // do nothing for now. Assume version is supported
            }
        }
        return false;
    }

    public toString(): string {
        let result = this.platform;

        if (this.architecture) {
            if (result) {
                result += ", ";
            }

            result += this.architecture;
        }

        if (this.distribution) {
            if (result) {
                result += ", ";
            }

            result += this.distribution.toString();
        }

        return result;
    }

    /**
     * Gets the current platform information.
     * @returns A promise that resolves to a PlatformInformation object containing details about the current platform, including a supported .NET Core Runtime ID (RID) for the platform.
     */
    public static async getCurrent(): Promise<PlatformInformation> {
        let platform = os.platform();
        let arch: string | undefined;
        let distro: LinuxDistribution | undefined;

        switch (platform) {
            case "win32":
                arch = this.getWindowsArchitecture();
                distro = undefined;
                break;

            case "darwin":
                arch = await PlatformInformation.getUnixArchitecture();
                distro = undefined;
                break;

            case "linux":
                arch = await PlatformInformation.getUnixArchitecture();
                distro = await LinuxDistribution.getCurrent();
                break;

            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }

        return new PlatformInformation(platform, arch, distro);
    }

    private static getWindowsArchitecture(): string {
        if (process.env.PROCESSOR_ARCHITECTURE === "ARM64") {
            return "arm64";
        } else if (
            process.env.PROCESSOR_ARCHITECTURE === "x86" &&
            process.env.PROCESSOR_ARCHITEW6432 === undefined
        ) {
            return "x86";
        } else {
            return "x86_64";
        }
    }

    private static async getUnixArchitecture(): Promise<string | undefined> {
        const arch = await PlatformInformation.execChildProcess("uname -m");
        return arch?.trim() ?? undefined;
    }

    private static execChildProcess(process: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            child_process.exec(
                process,
                { maxBuffer: 500 * 1024 },
                (error: Error, stdout: string, stderr: string) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    if (stderr && stderr.length > 0) {
                        reject(new Error(stderr));
                        return;
                    }

                    resolve(stdout);
                },
            );
        });
    }

    /**
     * Returns a supported .NET Core Runtime ID (RID) for the current platform. The list of Runtime IDs
     * is available at https://github.com/dotnet/corefx/tree/master/pkg/Microsoft.NETCore.Platforms.
     */
    private static getRuntimeId(
        platform: string,
        architecture: string,
        distribution: LinuxDistribution,
    ): Runtime {
        // Note: We could do much better here. Currently, we only return a limited number of RIDs that
        // are officially supported.

        switch (platform) {
            case "win32":
                switch (architecture) {
                    case "x86_64":
                        return Runtime.Windows_64;
                    case "arm64":
                        return Runtime.Windows_ARM64;
                    default:
                }

                throw new Error(`Unsupported Windows architecture: ${architecture}`);

            case "darwin":
                switch (architecture) {
                    // Note: We return the El Capitan RID for Sierra
                    case "x86_64":
                        return Runtime.OSX;
                    case "arm64":
                        return Runtime.OSX_ARM64;
                    default:
                }

                throw new Error(`Unsupported macOS architecture: ${architecture}`);

            case "linux":
                if (architecture === "x86_64") {
                    return Runtime.Linux;
                } else if (architecture === "aarch64") {
                    return Runtime.Linux_ARM64;
                }

                // If we got here, this is not a Linux distro or architecture that we currently support.
                throw new Error(
                    `Unsupported Linux distro: ${distribution.name}, ${distribution.version}, ${architecture}`,
                );
            default:
                // If we got here, we've ended up with a platform we don't support  like 'freebsd' or 'sunos'.
                // Chances are, VS Code doesn't support these platforms either.
                throw Error("Unsupported platform " + platform);
        }
    }
}
