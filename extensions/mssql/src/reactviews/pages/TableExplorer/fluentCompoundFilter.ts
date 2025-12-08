/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRoot, Root } from "react-dom/client";
import { createElement } from "react";
import { FluentProvider } from "@fluentui/react-components";
import {
    FluentCompoundFilterComponent,
    FluentCompoundFilterRef,
    FilterOperator,
} from "./FluentCompoundFilterComponent";
import { webviewTheme } from "../../common/theme";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import type {
    Column,
    FilterArguments,
    FilterCallback,
    GridOption,
    OperatorString,
    OperatorType,
    SearchTerm,
    SlickGrid,
} from "slickgrid-react";
import { locConstants } from "../../common/locConstants";

// String operators for text columns
const STRING_OPERATORS: FilterOperator[] = [
    { operator: "", desc: locConstants.slickGrid.filterContains },
    { operator: "<>", desc: locConstants.slickGrid.filterNotContains },
    { operator: "=", desc: locConstants.slickGrid.filterEquals },
    { operator: "!=", desc: locConstants.slickGrid.filterNotEqualTo },
    { operator: "a*", desc: locConstants.slickGrid.filterStartsWith },
    { operator: "*z", desc: locConstants.slickGrid.filterEndsWith },
];

export interface FluentCompoundFilterParams {
    /** Theme kind for styling */
    themeKind?: ColorThemeKind;
}

/**
 * Custom SlickGrid filter that uses Fluent UI components for a native VS Code look.
 * This filter renders a Fluent UI Dropdown for operator selection and Input for the search value.
 */
export class FluentCompoundFilter {
    // Required Filter interface properties
    grid!: SlickGrid;
    columnDef!: Column;
    callback!: FilterCallback;
    operator: OperatorType | OperatorString = "";
    searchTerms: SearchTerm[] = [];

    // Internal state
    private _filterContainerElm!: HTMLElement;
    private _reactRoot: Root | null = null;
    private _filterComponentRef: FluentCompoundFilterRef | null = null;
    private _currentValue: string = "";
    private _currentOperator: string = "";
    private _themeKind: ColorThemeKind = ColorThemeKind.Dark;

    /** Getter for the Grid Options */
    get gridOptions(): GridOption {
        return this.grid?.getOptions() ?? {};
    }

    /** Getter for the Column Filter options */
    get columnFilter() {
        return this.columnDef?.filter ?? {};
    }

    /**
     * Initialize the Filter
     */
    init(args: FilterArguments): void {
        this.grid = args.grid;
        this.callback = args.callback;
        this.columnDef = args.columnDef;
        this.operator = args.operator || "";
        this.searchTerms = args.searchTerms ?? [];
        this._filterContainerElm = args.filterContainerElm;

        // Get theme from params if provided
        const params = this.columnFilter.params as FluentCompoundFilterParams | undefined;
        if (params?.themeKind !== undefined) {
            this._themeKind = params.themeKind;
        } else {
            // Try to determine theme from grid options
            this._themeKind = this.gridOptions.darkMode
                ? ColorThemeKind.Dark
                : ColorThemeKind.Light;
        }

        // Get initial value from searchTerms
        const initialValue =
            Array.isArray(this.searchTerms) && this.searchTerms.length > 0
                ? String(this.searchTerms[0])
                : "";

        this._currentValue = initialValue;
        this._currentOperator = String(this.operator || "");

        // Create and mount the React component
        this.createDomFilterElement();
    }

    /**
     * Create the DOM filter element and mount the React component
     */
    private createDomFilterElement(): void {
        // Clear existing content
        this._filterContainerElm.innerHTML = "";

        // Create a container for the React component
        const container = document.createElement("div");
        container.className = "fluent-compound-filter-container";
        container.style.width = "100%";
        container.style.height = "100%";
        this._filterContainerElm.appendChild(container);

        // Create React root and render the component
        this._reactRoot = createRoot(container);
        this.renderFilterComponent();
    }

    /**
     * Render the React filter component
     */
    private renderFilterComponent(): void {
        if (!this._reactRoot) {
            return;
        }

        const columnId = String(this.columnDef?.id ?? "");

        // Create a ref callback to capture the component ref
        const refCallback = (ref: FluentCompoundFilterRef | null) => {
            this._filterComponentRef = ref;
        };

        const filterElement = createElement(
            FluentProvider,
            {
                theme: webviewTheme(this._themeKind),
                style: { height: "100%", width: "100%", background: "transparent" },
            },
            createElement(FluentCompoundFilterComponent, {
                ref: refCallback,
                operators: STRING_OPERATORS,
                initialOperator: this._currentOperator,
                initialValue: this._currentValue,
                placeholder: this.columnFilter.placeholder || "",
                columnId: columnId,
                onChange: this.handleFilterChange.bind(this),
            }),
        );

        this._reactRoot.render(filterElement);
    }

    /**
     * Handle filter value or operator changes from the React component
     */
    private handleFilterChange(operator: string, value: string): void {
        this._currentOperator = operator;
        this._currentValue = value;
        this.operator = operator as OperatorType | OperatorString;

        // Update filled class for styling
        this.updateFilterStyle(value !== "");

        // Trigger the filter callback
        this.callback(undefined, {
            columnDef: this.columnDef,
            operator: this.operator,
            searchTerms: value ? [value] : null,
            shouldTriggerQuery: true,
        });
    }

    /**
     * Clear the filter
     */
    clear(shouldTriggerQuery = true): void {
        this._currentValue = "";
        this._currentOperator = "";
        this.operator = "";
        this.searchTerms = [];

        // Clear the React component
        if (this._filterComponentRef) {
            this._filterComponentRef.clear();
        }

        this.updateFilterStyle(false);

        if (shouldTriggerQuery) {
            this.callback(undefined, {
                columnDef: this.columnDef,
                clearFilterTriggered: true,
                shouldTriggerQuery: true,
            });
        }
    }

    /**
     * Destroy the filter and cleanup
     */
    destroy(): void {
        // Unmount React component
        if (this._reactRoot) {
            this._reactRoot.unmount();
            this._reactRoot = null;
        }
        this._filterComponentRef = null;
    }

    /**
     * Get the current filter value
     */
    getValues(): SearchTerm | SearchTerm[] | undefined {
        return this._filterComponentRef?.getValue() ?? this._currentValue;
    }

    /**
     * Set filter values programmatically
     */
    setValues(
        values: SearchTerm | SearchTerm[],
        operator?: OperatorType | OperatorString,
        triggerChange = false,
    ): void {
        const searchValue = Array.isArray(values) ? String(values[0] ?? "") : String(values ?? "");
        const operatorValue = operator ? String(operator) : this._currentOperator;

        this._currentValue = searchValue;
        this._currentOperator = operatorValue;
        this.operator = operatorValue as OperatorType | OperatorString;

        // Update the React component
        if (this._filterComponentRef) {
            this._filterComponentRef.setValue(searchValue, operatorValue);
        }

        this.updateFilterStyle(searchValue !== "");

        if (triggerChange) {
            this.handleFilterChange(operatorValue, searchValue);
        }
    }

    /**
     * Update the filter container styling based on whether it has a value
     */
    private updateFilterStyle(isFilled: boolean): void {
        if (this._filterContainerElm) {
            this._filterContainerElm.classList.toggle("filled", isFilled);
        }
    }
}
