/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";
import { useEffect, useState, type CSSProperties } from "react";
import type {
    NotebookSaveAsFormat,
    NotebookSaveAsMessage,
} from "../../../sharedInterfaces/notebookQueryResult";
import type { DbCellValue, IDbColumn } from "../../../sharedInterfaces/queryResult";
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
            label: l10n.t("Save as CSV"),
            iconLight: saveCsvIcon,
            iconDark: saveCsvIconInverse,
        },
        {
            id: "excel",
            label: l10n.t("Save as Excel"),
            iconLight: saveExcelIcon,
            iconDark: saveExcelIconInverse,
        },
        {
            id: "json",
            label: l10n.t("Save as JSON"),
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
    transition: "background 0.1s ease",
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
    const [isLight, setIsLight] = useState(isLightTheme());

    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsLight(isLightTheme());
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ["class"],
        });

        return () => observer.disconnect();
    }, []);

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

    const toolbarLabel = l10n.t({
        message: "Export toolbar for result set {0}",
        args: [resultSetIndex + 1],
        comment: ["{0} is the result set number (1-based index)"],
    });

    return (
        <div
            className="notebook-results-toolbar"
            style={toolbarStyle}
            role="toolbar"
            aria-label={toolbarLabel}>
            {actions.map((action) => (
                <button
                    key={action.id}
                    type="button"
                    title={action.label}
                    aria-label={action.label}
                    className="notebook-results-toolbar-button"
                    style={buttonStyle}
                    disabled={!postMessage}
                    onClick={() => onClick(action.id)}>
                    <img
                        src={isLight ? action.iconLight : action.iconDark}
                        alt=""
                        style={iconStyle}
                    />
                </button>
            ))}
        </div>
    );
}
