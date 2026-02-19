/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const flatFileConfig = {
    service: {
        downloadUrl:
            "https://github.com/microsoft/sqltoolsservice/releases/download/flatFileImport-{#version#}/flatfileimportservice-{#fileName#}",
        useDefaultLinuxRuntime: true,
        version: "0.0.12",
        downloadFileNames: {
            Windows_64: "win-x64.zip",
            Windows_86: "win-x86.zip",
            OSX: "osx-x64.tar.gz",
            Linux: "linux-x64.tar.gz",
        },
        installDir: "flatfileservice/{#platform#}/{#version#}",
        executableFiles: ["MicrosoftSqlToolsFlatFileImport", "MicrosoftSqlToolsFlatFileImport.exe"],
    },
};

export type FlatFileConfigType = typeof flatFileConfig;
