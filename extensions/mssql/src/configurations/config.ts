/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const config = {
    service: {
        dotnetRuntimeVersion: "10.0",
        downloadUrl:
            "https://github.com/Microsoft/sqltoolsservice/releases/download/{#version#}/microsoft.sqltools.servicelayer-{#fileName#}",
        version: "6.0.20260422.4",
        downloadFileNames: {
            Windows_64: "win-x64-net10.0.zip",
            Windows_ARM64: "win-arm64-net10.0.zip",
            OSX: "osx-x64-net10.0.tar.gz",
            OSX_ARM64: "osx-arm64-net10.0.tar.gz",
            Linux: "linux-x64-net10.0.tar.gz",
            Linux_ARM64: "linux-arm64-net10.0.tar.gz",
            Portable: "portable-net10.0.zip",
        },
        installDir: "./sqltoolsservice/{#version#}/{#platform#}",
    },
};

export type ConfigType = typeof config;
