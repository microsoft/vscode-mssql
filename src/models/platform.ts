/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as semver from "semver";
import * as plist from "plist";

const unknown = "unknown";

export enum Runtime {
    UnknownRuntime = "Unknown",
    Windows_86 = "Windows_86",
    Windows_64 = "Windows_64",
    Windows_ARM64 = "Windows_ARM64",
    OSX_10_11_64 = "OSX_10_11_64",
    OSX_ARM64 = "OSX_ARM64",
    CentOS_7 = "CentOS_7",
    Debian_8 = "Debian_8",
    Fedora_23 = "Fedora_23",
    OpenSUSE_13_2 = "OpenSUSE_13_2",
    SLES_12_2 = "SLES_12_2",
    RHEL_7 = "RHEL_7",
    Ubuntu_14 = "Ubuntu_14",
    Ubuntu_16 = "Ubuntu_16",
    Linux_ARM64 = "Linux_ARM64",
}

export function getRuntimeDisplayName(runtime: Runtime): string {
    switch (runtime) {
        case Runtime.Windows_64:
        case Runtime.Windows_86:
        case Runtime.Windows_ARM64:
            return "Windows";
        case Runtime.OSX_10_11_64:
        case Runtime.OSX_ARM64:
            return "OSX";
        case Runtime.CentOS_7:
            return "CentOS";
        case Runtime.Debian_8:
            return "Debian";
        case Runtime.Fedora_23:
            return "Fedora";
        case Runtime.OpenSUSE_13_2:
            return "OpenSUSE";
        case Runtime.SLES_12_2:
            return "SLES";
        case Runtime.RHEL_7:
            return "RHEL";
        case Runtime.Ubuntu_14:
            return "Ubuntu14";
        case Runtime.Ubuntu_16:
            return "Ubuntu16";
        case Runtime.Linux_ARM64:
            return "Linux";
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

    public static getCurrent(): Promise<LinuxDistribution> {
        // Try /etc/os-release and fallback to /usr/lib/os-release per the synopsis
        // at https://www.freedesktop.org/software/systemd/man/os-release.html.
        return LinuxDistribution.fromFilePath("/etc/os-release")
            .catch(() => LinuxDistribution.fromFilePath("/usr/lib/os-release"))
            .catch(() => Promise.resolve(new LinuxDistribution(unknown, unknown)));
    }

    public toString(): string {
        return `name=${this.name}, version=${this.version}`;
    }

    private static fromFilePath(filePath: string): Promise<LinuxDistribution> {
        return new Promise<LinuxDistribution>((resolve, reject) => {
            fs.readFile(filePath, "utf8", (error, data) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(LinuxDistribution.fromReleaseInfo(data));
                }
            });
        });
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
        return this.runtimeId !== undefined && this.runtimeId !== Runtime.UnknownRuntime;
    }

    public getRuntimeDisplayName(): string {
        return getRuntimeDisplayName(this.runtimeId);
    }

    public isMacVersionLessThan(version: string): boolean {
        if (this.isMacOS) {
            try {
                let versionInfo = plist.parse(
                    fs.readFileSync("/System/Library/CoreServices/SystemVersion.plist", "utf-8"),
                );
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

    public static getCurrent(): Promise<PlatformInformation> {
        let platform = os.platform();
        let architecturePromise: Promise<string>;
        let distributionPromise: Promise<LinuxDistribution>;

        switch (platform) {
            case "win32":
                architecturePromise = PlatformInformation.getWindowsArchitecture();
                distributionPromise = Promise.resolve(undefined);
                break;

            case "darwin":
                architecturePromise = PlatformInformation.getUnixArchitecture();
                distributionPromise = Promise.resolve(undefined);
                break;

            case "linux":
                architecturePromise = PlatformInformation.getUnixArchitecture();
                distributionPromise = LinuxDistribution.getCurrent();
                break;

            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }

        return architecturePromise.then((arch) => {
            return distributionPromise.then((distro) => {
                return new PlatformInformation(platform, arch, distro);
            });
        });
    }

    private static getWindowsArchitecture(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            if (process.env.PROCESSOR_ARCHITECTURE === "ARM64") {
                resolve("arm64");
            } else if (
                process.env.PROCESSOR_ARCHITECTURE === "x86" &&
                process.env.PROCESSOR_ARCHITEW6432 === undefined
            ) {
                resolve("x86");
            } else {
                resolve("x86_64");
            }
        });
    }

    private static getUnixArchitecture(): Promise<string> {
        return PlatformInformation.execChildProcess("uname -m").then((architecture) => {
            if (architecture) {
                return architecture.trim();
            }

            return undefined;
        });
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
                    case "x86":
                        return Runtime.Windows_86;
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
                        return Runtime.OSX_10_11_64;
                    case "arm64":
                        return Runtime.OSX_ARM64;
                    default:
                }

                throw new Error(`Unsupported macOS architecture: ${architecture}`);

            case "linux":
                if (architecture === "x86_64") {
                    // First try the distribution name
                    let runtimeId = PlatformInformation.getRuntimeIdHelper(
                        distribution.name,
                        distribution.version,
                    );

                    // If the distribution isn't one that we understand, but the 'ID_LIKE' field has something that we understand, use that
                    //
                    // NOTE: 'ID_LIKE' doesn't specify the version of the 'like' OS. So we will use the 'VERSION_ID' value. This will restrict
                    // how useful ID_LIKE will be since it requires the version numbers to match up, but it is the best we can do.
                    if (
                        runtimeId === Runtime.UnknownRuntime &&
                        distribution.idLike &&
                        distribution.idLike.length > 0
                    ) {
                        for (let id of distribution.idLike) {
                            runtimeId = PlatformInformation.getRuntimeIdHelper(
                                id,
                                distribution.version,
                            );
                            if (runtimeId !== Runtime.UnknownRuntime) {
                                break;
                            }
                        }
                    }

                    if (runtimeId !== Runtime.UnknownRuntime) {
                        return runtimeId;
                    }
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

    private static getRuntimeIdHelper(
        distributionName: string,
        distributionVersion: string,
    ): Runtime {
        switch (distributionName) {
            case "arch":
            case "antergos":
                // NOTE: currently Arch Linux seems to be compatible enough with Ubuntu 16 that this works,
                // though in the future this may need to change as Arch follows a rolling release model.
                return Runtime.Ubuntu_16;
            case "ubuntu":
                if (distributionVersion.startsWith("14")) {
                    // This also works for Linux Mint
                    return Runtime.Ubuntu_14;
                } else if (distributionVersion.startsWith("16")) {
                    return Runtime.Ubuntu_16;
                }

                break;
            case "elementary":
            case "elementary OS":
                if (distributionVersion.startsWith("0.3")) {
                    // Elementary OS 0.3 Freya is binary compatible with Ubuntu 14.04
                    return Runtime.Ubuntu_14;
                } else if (distributionVersion.startsWith("0.4")) {
                    // Elementary OS 0.4 Loki is binary compatible with Ubuntu 16.04
                    return Runtime.Ubuntu_16;
                }

                break;
            case "linuxmint":
                if (distributionVersion.startsWith("18") || distributionVersion.startsWith("19")) {
                    // Linux Mint 18 is binary compatible with Ubuntu 16.04
                    return Runtime.Ubuntu_16;
                }

                break;
            case "centos":
            case "ol":
                // Oracle Linux is binary compatible with CentOS
                return Runtime.CentOS_7;
            case "fedora":
                return Runtime.Fedora_23;
            case "opensuse":
                return Runtime.OpenSUSE_13_2;
            case "sles":
                return Runtime.SLES_12_2;
            case "rhel":
                return Runtime.RHEL_7;
            case "debian":
            case "deepin":
                return Runtime.Debian_8;
            case "galliumos":
                if (distributionVersion.startsWith("2.0")) {
                    return Runtime.Ubuntu_16;
                }
                break;
            default:
                return Runtime.Ubuntu_16;
        }

        return Runtime.Ubuntu_16;
    }
}
