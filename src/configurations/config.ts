/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const config = {
    service: {
        downloadUrl:
            "https://github.com/Microsoft/sqltoolsservice/releases/download/{#version#}/microsoft.sqltools.servicelayer-{#fileName#}",
        version: "5.0.20251103.1",
        downloadFileNames: {
            Windows_86: "win-x86-net8.0.zip",
            Windows_64: "win-x64-net8.0.zip",
            Windows_ARM64: "win-arm64-net8.0.zip",
            OSX_10_11_64: "osx-x64-net8.0.tar.gz",
            OSX_ARM64: "osx-arm64-net8.0.tar.gz",
            CentOS_7: "linux-x64-net8.0.tar.gz",
            Debian_8: "linux-x64-net8.0.tar.gz",
            Fedora_23: "linux-x64-net8.0.tar.gz",
            OpenSUSE_13_2: "linux-x64-net8.0.tar.gz",
            SLES_12_2: "linux-x64-net8.0.tar.gz",
            RHEL_7: "linux-x64-net8.0.tar.gz",
            Ubuntu_14: "linux-x64-net8.0.tar.gz",
            Ubuntu_16: "linux-x64-net8.0.tar.gz",
            Linux_ARM64: "linux-arm64-net8.0.tar.gz",
        },
        installDir: "./sqltoolsservice/{#version#}/{#platform#}",
        executableFiles: [
            "MicrosoftSqlToolsServiceLayer.exe",
            "MicrosoftSqlToolsServiceLayer",
            "MicrosoftSqlToolsServiceLayer.dll",
        ],
    },
};

export type ConfigType = typeof config;
