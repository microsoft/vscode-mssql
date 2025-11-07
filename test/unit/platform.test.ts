/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Runtime, PlatformInformation, LinuxDistribution } from "../../src/models/platform";

function getPlatform(): Promise<Runtime> {
    return PlatformInformation.getCurrent().then((platformInfo) => {
        return platformInfo.runtimeId;
    });
}

suite("Platform Tests", () => {
    test("getCurrentPlatform should return valid value", (done) => {
        void getPlatform().then((platform) => {
            expect(platform).to.not.equal(Runtime.UnknownRuntime);
            done();
        });
    });

    test("Retrieve correct information for Ubuntu 14.04", () => {
        const dist = distro_ubuntu_14_04();
        expect(dist.name).to.equal("ubuntu");
        expect(dist.version).to.equal("14.04");
    });

    test("Retrieve correct information for Ubuntu 14.04 with quotes", () => {
        const dist = distro_ubuntu_14_04_with_quotes();
        expect(dist.name).to.equal("ubuntu");
        expect(dist.version).to.equal("14.04");
    });

    test("Retrieve correct information for Fedora 23", () => {
        const dist = distro_fedora_23();
        expect(dist.name).to.equal("fedora");
        expect(dist.version).to.equal("23");
    });

    test("Retrieve correct information for Debian 8", () => {
        const dist = distro_debian_8();

        expect(dist.name).to.equal("debian");
        expect(dist.version).to.equal("8");
    });

    test("Retrieve correct information for CentOS 7", () => {
        const dist = distro_centos_7();

        expect(dist.name).to.equal("centos");
        expect(dist.version).to.equal("7");
    });

    test("Compute correct RID for Windows 64-bit", () => {
        const platformInfo = new PlatformInformation("win32", "x86_64");

        expect(platformInfo.runtimeId).to.equal(Runtime.Windows_64.toString());
    });

    test("Compute correct RID for Windows 86-bit", () => {
        const platformInfo = new PlatformInformation("win32", "x86");

        expect(platformInfo.runtimeId).to.equal(Runtime.Windows_86.toString());
    });

    test("Compute correct RID for Windows ARM 64-bit", () => {
        const platformInfo = new PlatformInformation("win32", "arm64");

        expect(platformInfo.runtimeId).to.equal(Runtime.Windows_ARM64.toString());
    });

    test("Compute no RID for Windows with bad architecture", () => {
        const platformInfo = new PlatformInformation("win32", "bad");

        expect(platformInfo.runtimeId).to.equal(undefined);
    });

    test("Compute correct RID for MacOS Intel", () => {
        const platformInfo = new PlatformInformation("darwin", "x86_64");

        expect(platformInfo.runtimeId).to.equal(Runtime.OSX_10_11_64.toString());
    });

    test("Compute correct RID for MacOS ARM", () => {
        const platformInfo = new PlatformInformation("darwin", "arm64");

        expect(platformInfo.runtimeId).to.equal(Runtime.OSX_ARM64.toString());
    });

    test("Compute no RID for OSX with 32-bit architecture", () => {
        const platformInfo = new PlatformInformation("darwin", "x86");

        expect(platformInfo.runtimeId, undefined);
    });

    test("Compute correct RID for Ubuntu 14.04", () => {
        const platformInfo = new PlatformInformation("linux", "x86_64", distro_ubuntu_14_04());

        expect(platformInfo.runtimeId).to.equal(Runtime.Ubuntu_14.toString());
    });

    test("Compute correct RID for Fedora 23", () => {
        const platformInfo = new PlatformInformation("linux", "x86_64", distro_fedora_23());

        expect(platformInfo.runtimeId).to.equal(Runtime.Fedora_23.toString());
    });

    test("Compute correct RID for Debian 8", () => {
        const platformInfo = new PlatformInformation("linux", "x86_64", distro_debian_8());

        expect(platformInfo.runtimeId).to.equal(Runtime.Debian_8.toString());
    });

    test("Compute correct RID for CentOS 7", () => {
        const platformInfo = new PlatformInformation("linux", "x86_64", distro_centos_7());

        expect(platformInfo.runtimeId).to.equal(Runtime.CentOS_7.toString());
    });

    test("Compute correct RID for KDE neon", () => {
        const platformInfo = new PlatformInformation("linux", "x86_64", distro_kde_neon_5_8());

        expect(platformInfo.runtimeId).to.equal(Runtime.Ubuntu_16.toString());
    });

    test("Compute no RID for CentOS 7 with 32-bit architecture", () => {
        const platformInfo = new PlatformInformation("linux", "x86", distro_centos_7());

        expect(platformInfo.runtimeId).to.equal(undefined);
    });

    test("Compute default (Ubuntu_16) RID for fake distro with no ID_LIKE", () => {
        const platformInfo = new PlatformInformation(
            "linux",
            "x86_64",
            distro_unknown_no_id_like(),
        );

        expect(platformInfo.runtimeId).to.equal(Runtime.Ubuntu_16.toString());
    });
});

function distro_ubuntu_14_04(): LinuxDistribution {
    // Copied from /etc/os-release on Ubuntu 14.04
    const input = `
NAME="Ubuntu"
VERSION="14.04.5 LTS, Trusty Tahr"
ID=ubuntu
ID_LIKE=debian
PRETTY_NAME="Ubuntu 14.04.5 LTS"
VERSION_ID="14.04"
HOME_URL="http://www.ubuntu.com/"
SUPPORT_URL="http://help.ubuntu.com/"
BUG_REPORT_URL="http://bugs.launchpad.net/ubuntu/"`;

    return LinuxDistribution.fromReleaseInfo(input, "\n");
}

function distro_ubuntu_14_04_with_quotes(): LinuxDistribution {
    // Copied from /etc/os-release on Ubuntu 14.04
    const input = `
NAME='Ubuntu'
VERSION='14.04.5 LTS, Trusty Tahr'
ID=ubuntu
ID_LIKE=debian
PRETTY_NAME='Ubuntu 14.04.5 LTS'
VERSION_ID='14.04'
HOME_URL='http://www.ubuntu.com/'
SUPPORT_URL='http://help.ubuntu.com/'
BUG_REPORT_URL='http://bugs.launchpad.net/ubuntu/'`;

    return LinuxDistribution.fromReleaseInfo(input, "\n");
}

function distro_fedora_23(): LinuxDistribution {
    // Copied from /etc/os-release on Fedora 23
    const input = `
NAME=Fedora
VERSION="23 (Workstation Edition)"
ID=fedora
VERSION_ID=23
PRETTY_NAME="Fedora 23 (Workstation Edition)"
ANSI_COLOR="0;34"
CPE_NAME="cpe:/o:fedoraproject:fedora:23"
HOME_URL="https://fedoraproject.org/"
BUG_REPORT_URL="https://bugzilla.redhat.com/"
REDHAT_BUGZILLA_PRODUCT="Fedora"
REDHAT_BUGZILLA_PRODUCT_VERSION=23
REDHAT_SUPPORT_PRODUCT="Fedora"
REDHAT_SUPPORT_PRODUCT_VERSION=23
PRIVACY_POLICY_URL=https://fedoraproject.org/wiki/Legal:PrivacyPolicy
VARIANT="Workstation Edition"
VARIANT_ID=workstation`;

    return LinuxDistribution.fromReleaseInfo(input, "\n");
}

function distro_debian_8(): LinuxDistribution {
    // Copied from /etc/os-release on Debian 8
    const input = `
PRETTY_NAME="Debian GNU/Linux 8 (jessie)"
NAME="Debian GNU/Linux"
VERSION_ID="8"
VERSION="8 (jessie)"
ID=debian
HOME_URL="http://www.debian.org/"
SUPPORT_URL="http://www.debian.org/support"
BUG_REPORT_URL="https://bugs.debian.org/"`;

    return LinuxDistribution.fromReleaseInfo(input, "\n");
}

function distro_centos_7(): LinuxDistribution {
    // Copied from /etc/os-release on CentOS 7
    const input = `
NAME="CentOS Linux"
VERSION="7 (Core)"
ID="centos"
ID_LIKE="rhel fedora"
VERSION_ID="7"
PRETTY_NAME="CentOS Linux 7 (Core)"
ANSI_COLOR="0;31"
CPE_NAME="cpe:/o:centos:centos:7"
HOME_URL="https://www.centos.org/"
BUG_REPORT_URL="https://bugs.centos.org/"

CENTOS_MANTISBT_PROJECT="CentOS-7"
CENTOS_MANTISBT_PROJECT_VERSION="7"
REDHAT_SUPPORT_PRODUCT="centos"
REDHAT_SUPPORT_PRODUCT_VERSION="7"`;

    return LinuxDistribution.fromReleaseInfo(input, "\n");
}

function distro_kde_neon_5_8(): LinuxDistribution {
    // Copied from /etc/os-release on KDE Neon 5.8
    const input = `
NAME="KDE neon"
VERSION="5.8"
ID=neon
ID_LIKE="ubuntu debian"
PRETTY_NAME="KDE neon User Edition 5.8"
VERSION_ID="16.04"
HOME_URL="http://neon.kde.org/"
SUPPORT_URL="http://neon.kde.org/"
BUG_REPORT_URL="http://bugs.kde.org/"
VERSION_CODENAME=xenial
UBUNTU_CODENAME=xenial`;

    return LinuxDistribution.fromReleaseInfo(input, "\n");
}

function distro_unknown_no_id_like(): LinuxDistribution {
    const input = `
PRETTY_NAME="Make believe 1.0"
NAME="Make believe"
VERSION_ID="1.0"
VERSION="1.0 (rogers)"
ID=MakeBelieve`;

    return LinuxDistribution.fromReleaseInfo(input, "\n");
}
