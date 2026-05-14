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
            iconLight: require("../../media/saveCsv.svg"),
            iconDark: require("../../media/saveCsv_inverse.svg"),
        },
        {
            id: "json",
            label: l10n.t("Save As JSON"),
            iconLight: require("../../media/saveJson.svg"),
            iconDark: require("../../media/saveJson_inverse.svg"),
        },
        {
            id: "excel",
            label: l10n.t("Save As Excel"),
            iconLight: require("../../media/saveExcel.svg"),
            iconDark: require("../../media/saveExcel_inverse.svg"),
        },
        {
            id: "insert",
            label: l10n.t("Save As INSERT INTO"),
            iconLight: require("../../media/saveInsert.svg"),
            iconDark: require("../../media/saveInsert_inverse.svg"),
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
