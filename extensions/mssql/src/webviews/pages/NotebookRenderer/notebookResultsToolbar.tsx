/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";
import type { CSSProperties } from "react";
import type {
    NotebookSaveAsFormat,
    NotebookSaveAsMessage,
} from "../../../sharedInterfaces/notebookQueryResult";
import type { DbCellValue, IDbColumn } from "../../../sharedInterfaces/queryResult";
// Static ESM imports so esbuild's "dataurl" loader replaces these with the
// inlined data: URI strings at bundle time. require() with format=esm wraps
// the result in a namespace object and breaks <img src>.
import saveCsvIcon from "../../media/saveCsv.svg";
import saveCsvIconInverse from "../../media/saveCsv_inverse.svg";
import saveJsonIcon from "../../media/saveJson.svg";
import saveJsonIconInverse from "../../media/saveJson_inverse.svg";
import saveExcelIcon from "../../media/saveExcel.svg";
import saveExcelIconInverse from "../../media/saveExcel_inverse.svg";

export interface NotebookResultsToolbarProps {
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
    resultSetIndex: number;
    postMessage: ((message: unknown) => void) | undefined;
}

// The notebook renderer iframe doesn't load Fluent UI / theme provider, so we
// pick the inverse (light-on-dark) icon when VS Code applies a dark theme. VS
// Code stamps these classes on the body element of the renderer iframe.
function isLightTheme(): boolean {
    if (typeof document === "undefined") {
        return false;
    }
    const cls = document.body.classList;
    return cls.contains("vscode-light") || cls.contains("vscode-high-contrast-light");
}

interface ToolbarAction {
    id: NotebookSaveAsFormat;
    label: string;
    iconLight: string;
    iconDark: string;
}

function buildActions(): ToolbarAction[] {
    return [
        {
            id: "csv",
            label: l10n.t("Save As CSV"),
            iconLight: saveCsvIcon,
            iconDark: saveCsvIconInverse,
        },
        {
            id: "excel",
            label: l10n.t("Save As Excel"),
            iconLight: saveExcelIcon,
            iconDark: saveExcelIconInverse,
        },
        {
            id: "json",
            label: l10n.t("Save As JSON"),
            iconLight: saveJsonIcon,
            iconDark: saveJsonIconInverse,
        },
    ];
}

const toolbarStyle: CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "4px",
    padding: "4px 0",
    marginBottom: "4px",
};

const buttonStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    padding: "4px",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: "4px",
    cursor: "pointer",
    color: "var(--vscode-foreground)",
};

const iconStyle: CSSProperties = {
    width: "16px",
    height: "16px",
    display: "block",
};

export function NotebookResultsToolbar({
    columnInfo,
    rows,
    resultSetIndex,
    postMessage,
}: NotebookResultsToolbarProps) {
    const actions = buildActions();
    const light = isLightTheme();

    const onClick = (format: NotebookSaveAsFormat) => {
        if (!postMessage) {
            return;
        }
        const msg: NotebookSaveAsMessage = {
            type: "saveAs",
            format,
            columnInfo,
            rows,
            resultSetIndex,
        };
        postMessage(msg);
    };

    return (
        <div className="notebook-results-toolbar" style={toolbarStyle} role="toolbar">
            {actions.map((action) => (
                <button
                    key={action.id}
                    type="button"
                    title={action.label}
                    aria-label={action.label}
                    style={buttonStyle}
                    disabled={!postMessage}
                    onClick={() => onClick(action.id)}
                    onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background =
                            "var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15))";
                    }}
                    onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    }}>
                    <img
                        src={light ? action.iconLight : action.iconDark}
                        alt=""
                        style={iconStyle}
                    />
                </button>
            ))}
        </div>
    );
}
