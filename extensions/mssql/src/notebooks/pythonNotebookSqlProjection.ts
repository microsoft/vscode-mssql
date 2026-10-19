/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface PythonNotebookSqlProjection {
    readonly text: string;
    readonly bodyStartLine: number;
}

export function projectPythonNotebookSql(source: string): PythonNotebookSqlProjection | undefined {
    const header = /^(?:[ \t]*\r?\n)*%%tsql(?=[ \t\r\n]|$)[^\r\n]*\r?\n/.exec(source);
    if (!header) return undefined;
    return {
        text: header[0].replace(/[^\r\n]/g, " ") + source.slice(header[0].length),
        bodyStartLine: header[0].split("\n").length - 1,
    };
}
