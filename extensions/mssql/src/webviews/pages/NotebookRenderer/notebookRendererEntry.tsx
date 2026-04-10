/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import $ from "jquery";
import { createRoot, Root } from "react-dom/client";
import * as l10n from "@vscode/l10n";
import { NotebookResultGrid, NotebookResultGridProps } from "./notebookResultGrid";
import { NotebookResultsOutput } from "./notebookResultsOutput";
import type {
    NotebookQueryResultOutputData,
    SavedNotebookResultSetOutputData,
} from "../../../sharedInterfaces/notebookQueryResult";

window.jQuery = $ as any;
require("slickgrid/lib/jquery.event.drag-2.3.0.js");
require("slickgrid/lib/jquery-1.11.2.min.js");
require("slickgrid/slick.core.js");
require("slickgrid/slick.grid.js");
require("slickgrid/plugins/slick.cellrangedecorator.js");

declare global {
    interface Window {
        $: any;
        jQuery: any;
    }
}

// VS Code notebook renderer types (inline to avoid adding @types/vscode-notebook-renderer dependency)
interface OutputItem {
    readonly id: string;
    readonly mime: string;
    text(): string;
    json(): any;
    data(): Uint8Array;
}

interface RendererContext {
    readonly workspace: { readonly isTrusted: boolean };
    readonly settings: { readonly lineLimit: number };
}

interface RenderOutputInfo {
    renderOutputItem(data: OutputItem, element: HTMLElement): void;
    disposeOutputItem?(id?: string): void;
}

type ActivationFunction = (
    context: RendererContext,
) => RenderOutputInfo | Promise<RenderOutputInfo>;

function isNotebookResultsOutputData(data: unknown): data is NotebookQueryResultOutputData {
    return (
        !!data &&
        typeof data === "object" &&
        (data as { version?: unknown }).version === 1 &&
        Array.isArray((data as { blocks?: unknown }).blocks)
    );
}

function isSavedNotebookResultSetOutputData(
    data: unknown,
): data is SavedNotebookResultSetOutputData {
    if (!data || typeof data !== "object") {
        return false;
    }

    const candidate = data as Partial<NotebookResultGridProps>;
    return (
        Array.isArray(candidate.columnInfo) &&
        Array.isArray(candidate.rows) &&
        typeof candidate.rowCount === "number"
    );
}

// Track React roots per output element for proper cleanup
const roots = new Map<string, Root>();

export const activate: ActivationFunction = (_context: RendererContext) => {
    return {
        renderOutputItem(data: OutputItem, element: HTMLElement) {
            const existingRoot = roots.get(data.id);
            if (existingRoot) {
                existingRoot.unmount();
                roots.delete(data.id);
            }

            // Clear element content
            element.innerHTML = "";

            let parsedData: NotebookQueryResultOutputData | SavedNotebookResultSetOutputData;
            try {
                parsedData = data.json();
            } catch {
                element.textContent = l10n.t("Error: Failed to parse query result data.");
                return;
            }

            if (isNotebookResultsOutputData(parsedData)) {
                const root = createRoot(element);
                roots.set(data.id, root);
                root.render(<NotebookResultsOutput blocks={parsedData.blocks} />);
            } else if (isSavedNotebookResultSetOutputData(parsedData)) {
                const root = createRoot(element);
                roots.set(data.id, root);
                root.render(
                    <NotebookResultGrid
                        columnInfo={parsedData.columnInfo}
                        rows={parsedData.rows}
                        rowCount={parsedData.rowCount}
                        addBottomSpacing={parsedData.addBottomSpacing}
                    />,
                );
            } else {
                element.textContent = l10n.t("Error: Unrecognized query result data.");
            }
        },

        disposeOutputItem(id?: string) {
            if (id) {
                const root = roots.get(id);
                if (root) {
                    root.unmount();
                    roots.delete(id);
                }
            } else {
                // Dispose all
                for (const root of roots.values()) {
                    root.unmount();
                }
                roots.clear();
            }
        },
    };
};
