/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import $ from "jquery";
import { createRoot, Root } from "react-dom/client";
import * as l10n from "@vscode/l10n";
import { NotebookResultGrid, NotebookResultGridProps } from "./notebookResultGrid";

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

// Track React roots per output element for proper cleanup
const roots = new Map<string, Root>();

export const activate: ActivationFunction = (_context: RendererContext) => {
    return {
        renderOutputItem(data: OutputItem, element: HTMLElement) {
            // Clean up existing root if re-rendering
            const existingRoot = roots.get(data.id);
            if (existingRoot) {
                existingRoot.unmount();
                roots.delete(data.id);
            }

            // Clear element content
            element.innerHTML = "";

            let props: NotebookResultGridProps;
            try {
                const parsed = data.json();
                props = {
                    columnInfo: parsed.columnInfo,
                    rows: parsed.rows,
                    rowCount: parsed.rowCount,
                };
            } catch {
                element.textContent = l10n.t("Error: Failed to parse query result data.");
                return;
            }

            const root = createRoot(element);
            roots.set(data.id, root);
            root.render(<NotebookResultGrid {...props} />);
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
