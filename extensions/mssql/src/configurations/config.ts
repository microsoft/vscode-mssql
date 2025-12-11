/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const config = {
    service: {
        downloadUrl:
            "https://github.com/Microsoft/sqltoolsservice/releases/download/{#version#}/microsoft.sqltools.servicelayer-{#fileName#}",
        version: "5.0.20251210.3",
        downloadFileNames: {
            Windows_64: "win-x64-net8.0.zip",
            Windows_ARM64: "win-arm64-net8.0.zip",
            OSX: "osx-x64-net8.0.tar.gz",
            OSX_ARM64: "osx-arm64-net8.0.tar.gz",
            Linux: "linux-x64-net8.0.tar.gz",
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
