/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Field,
    Input,
    makeStyles,
    tokens,
    Tooltip,
} from "@fluentui/react-components";
import {
    FormEvent,
    KeyboardEvent,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import { ObjectExplorerFilterContext } from "./ObjectExplorerFilterStateProvider";
import { useObjectExplorerFilterSelector } from "./objectExplorerFilterSelector";
import type { NodeFilter, NodeFilterChoiceProperty, NodeFilterProperty } from "vscode-mssql";
import {
    NodeFilterOperator,
    NodeFilterPropertyDataType,
    ObjectExplorerPageFilter,
    ObjectExplorerFilterPreset,
} from "../../../sharedInterfaces/objectExplorerFilter";
import { locConstants } from "../../common/locConstants";
import { DialogPageShell } from "../../common/dialogPageShell";
import { FilterFunnelIcon16Regular } from "../../common/icons/filterFunnel";
import { ObjectExplorerFilterContent } from "./ObjectExplorerFilterContent";
import { ObjectExplorerFilterPresets } from "./ObjectExplorerFilterPresets";

const useStyles = makeStyles({
    form: {
        height: "100vh",
    },
    saveOptions: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: tokens.spacingVerticalXS,
        marginBottom: tokens.spacingVerticalXS,
    },
    saveName: {
        width: "320px",
        maxWidth: "100%",
    },
    contentLayout: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 280px",
        alignItems: "stretch",
        gap: tokens.spacingHorizontalXXL,
        minHeight: "calc(100vh - 172px)",
        "@media (max-width: 760px)": {
            gridTemplateColumns: "minmax(0, 1fr)",
            minHeight: "auto",
        },
    },
    editorColumn: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        minWidth: 0,
    },
    reusableFiltersColumn: {
        minWidth: 0,
        "@media (max-width: 760px)": {
            order: -1,
            marginBottom: tokens.spacingVerticalXXL,
        },
    },
    previewFooter: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
        marginTop: tokens.spacingVerticalS,
        paddingTop: tokens.spacingVerticalM,
        borderTop: "1px solid var(--vscode-editorGroup-border)",
    },
    footerButtons: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    breadcrumb: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        color: "var(--vscode-descriptionForeground)",
    },
    breadcrumbSegment: {
        color: "var(--vscode-foreground)",
    },
    breadcrumbSeparator: {
        marginLeft: tokens.spacingHorizontalXS,
        marginRight: tokens.spacingHorizontalXS,
        color: "var(--vscode-descriptionForeground)",
    },
});

export const ObjectExplorerFilterPage = () => {
    const classes = useStyles();
    const context = useContext(ObjectExplorerFilterContext);
    const filterProperties = useObjectExplorerFilterSelector((s) => s?.filterProperties);
    const existingFilters = useObjectExplorerFilterSelector((s) => s?.existingFilters);
    const filterPresets = useObjectExplorerFilterSelector((s) => s?.filterPresets);
    const nodePath = useObjectExplorerFilterSelector((s) => s?.nodePath);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
    const [uiFilters, setUiFilters] = useState<ObjectExplorerPageFilter[]>([]);
    const [saveFilter, setSaveFilter] = useState(false);
    const [saveName, setSaveName] = useState("");
    const [focusRequest, setFocusRequest] = useState(0);
    const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>();
    const primaryFilterElementRef = useRef<HTMLElement | null>(null);
    const setPrimaryFilterElement = useCallback((element: HTMLElement | null) => {
        primaryFilterElementRef.current = element;
    }, []);

    const primaryFilterIndex = (() => {
        if (!filterProperties?.length) {
            return -1;
        }

        const primaryFilter =
            filterProperties.find((property) => property.name.toLocaleLowerCase() === "name") ??
            filterProperties.find(
                (property) => property.type === NodeFilterPropertyDataType.String,
            ) ??
            filterProperties[0];
        return filterProperties.indexOf(primaryFilter);
    })();
    const filterPropertiesKey = JSON.stringify(filterProperties);
    const existingFiltersKey = JSON.stringify(existingFilters);

    const isBetweenOperator = (operator: NodeFilterOperator): boolean => {
        return (
            operator === NodeFilterOperator.Between || operator === NodeFilterOperator.NotBetween
        );
    };

    const toRawString = (value: unknown): string => {
        if (typeof value === "string") {
            return value.trim();
        }
        if (value === undefined) {
            return "";
        }
        return String(value).trim();
    };

    const parseNumericFilterValue = (value: string): number | undefined => {
        if (value === "") {
            return undefined;
        }

        const parsedValue = Number(value);
        return Number.isNaN(parsedValue) ? undefined : parsedValue;
    };

    const operatorLabels: Record<NodeFilterOperator, string> = {
        [NodeFilterOperator.Contains]: locConstants.objectExplorerFiltering.contains,
        [NodeFilterOperator.NotContains]: locConstants.objectExplorerFiltering.notContains,
        [NodeFilterOperator.StartsWith]: locConstants.objectExplorerFiltering.startsWith,
        [NodeFilterOperator.NotStartsWith]: locConstants.objectExplorerFiltering.notStartsWith,
        [NodeFilterOperator.EndsWith]: locConstants.objectExplorerFiltering.endsWith,
        [NodeFilterOperator.NotEndsWith]: locConstants.objectExplorerFiltering.notEndsWith,
        [NodeFilterOperator.Equals]: locConstants.objectExplorerFiltering.equals,
        [NodeFilterOperator.NotEquals]: locConstants.objectExplorerFiltering.notEquals,
        [NodeFilterOperator.LessThan]: locConstants.objectExplorerFiltering.lessThan,
        [NodeFilterOperator.LessThanOrEquals]:
            locConstants.objectExplorerFiltering.lessThanOrEquals,
        [NodeFilterOperator.GreaterThan]: locConstants.objectExplorerFiltering.greaterThan,
        [NodeFilterOperator.GreaterThanOrEquals]:
            locConstants.objectExplorerFiltering.greaterThanOrEquals,
        [NodeFilterOperator.Between]: locConstants.objectExplorerFiltering.between,
        [NodeFilterOperator.NotBetween]: locConstants.objectExplorerFiltering.notBetween,
    };

    function getFilterOperatorString(operator: NodeFilterOperator | undefined): string {
        if (operator === undefined) {
            return "";
        }
        return operatorLabels[operator] ?? "";
    }

    function getFilterOperators(property: NodeFilterProperty): NodeFilterOperator[] {
        switch (property.type) {
            case NodeFilterPropertyDataType.Boolean:
                return [NodeFilterOperator.Equals, NodeFilterOperator.NotEquals];
            case NodeFilterPropertyDataType.String:
                return [
                    NodeFilterOperator.Contains,
                    NodeFilterOperator.NotContains,
                    NodeFilterOperator.StartsWith,
                    NodeFilterOperator.NotStartsWith,
                    NodeFilterOperator.EndsWith,
                    NodeFilterOperator.NotEndsWith,
                    NodeFilterOperator.Equals,
                    NodeFilterOperator.NotEquals,
                ];
            case NodeFilterPropertyDataType.Number:
                return [
                    NodeFilterOperator.Equals,
                    NodeFilterOperator.NotEquals,
                    NodeFilterOperator.LessThan,
                    NodeFilterOperator.LessThanOrEquals,
                    NodeFilterOperator.GreaterThan,
                    NodeFilterOperator.GreaterThanOrEquals,
                    NodeFilterOperator.Between,
                    NodeFilterOperator.NotBetween,
                ];
            case NodeFilterPropertyDataType.Date:
                return [
                    NodeFilterOperator.Equals,
                    NodeFilterOperator.NotEquals,
                    NodeFilterOperator.LessThan,
                    NodeFilterOperator.LessThanOrEquals,
                    NodeFilterOperator.GreaterThan,
                    NodeFilterOperator.GreaterThanOrEquals,
                    NodeFilterOperator.Between,
                    NodeFilterOperator.NotBetween,
                ];
            case NodeFilterPropertyDataType.Choice:
                return [NodeFilterOperator.Equals, NodeFilterOperator.NotEquals];
            default:
                return [];
        }
    }

    function getFilterChoices(property: NodeFilterChoiceProperty | NodeFilterProperty):
        | {
              name: string;
              displayName: string;
          }[]
        | undefined {
        switch (property.type) {
            case NodeFilterPropertyDataType.Choice:
                return (property as NodeFilterChoiceProperty).choices.map((choice) => {
                    return {
                        name: choice.value,
                        displayName: choice.displayName ?? choice.value,
                    };
                });
            case NodeFilterPropertyDataType.Boolean:
                return [
                    {
                        name: "true",
                        displayName: locConstants.objectExplorerFiltering.true,
                    },
                    {
                        name: "false",
                        displayName: locConstants.objectExplorerFiltering.false,
                    },
                ];
            default:
                return undefined;
        }
    }

    const createUiFilters = (filters: NodeFilter[] | undefined): ObjectExplorerPageFilter[] => {
        return (
            filterProperties?.map((property, index) => {
                const filter = filters?.find((candidate) => candidate.name === property.name);
                const operatorOptions = getFilterOperators(property);
                const defaultOperator = operatorOptions[0] ?? NodeFilterOperator.Equals;
                const selectedOperator =
                    filter?.operator !== undefined ? filter.operator : defaultOperator;
                const betweenOperator = isBetweenOperator(selectedOperator);
                let value: ObjectExplorerPageFilter["value"] = "";

                if (filter?.value !== undefined) {
                    if (betweenOperator) {
                        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
                        value = [toRawString(values[0]), toRawString(values[1])];
                    } else {
                        value = toRawString(filter.value);
                    }
                } else if (betweenOperator) {
                    value = ["", ""];
                }

                return {
                    index,
                    name: property.name,
                    displayName: property.displayName,
                    value,
                    type: property.type,
                    choices: getFilterChoices(property) ?? [],
                    operatorOptions,
                    selectedOperator,
                };
            }) ?? []
        );
    };

    const requestPrimaryFilterFocus = () => {
        setFocusRequest((currentRequest) => currentRequest + 1);
    };

    useEffect(() => {
        setUiFilters(createUiFilters(existingFilters));
        setSaveFilter(false);
        setSaveName("");
        setSelectedPresetId(undefined);
        setErrorMessage(undefined);
        requestPrimaryFilterFocus();
    }, [filterPropertiesKey, existingFiltersKey, nodePath]);

    useEffect(() => {
        if (focusRequest === 0 || primaryFilterIndex < 0) {
            return;
        }

        let animationFrame: number | undefined;
        const attemptFocus = () => {
            animationFrame = undefined;
            const element = primaryFilterElementRef.current;
            if (!element || !document.hasFocus()) {
                return;
            }

            element.focus();
            if (document.activeElement === element || element.contains(document.activeElement)) {
                window.removeEventListener("focus", scheduleFocus);
            }
        };
        const scheduleFocus = () => {
            if (animationFrame !== undefined) {
                cancelAnimationFrame(animationFrame);
            }
            animationFrame = requestAnimationFrame(attemptFocus);
        };

        window.addEventListener("focus", scheduleFocus);
        scheduleFocus();

        return () => {
            window.removeEventListener("focus", scheduleFocus);
            if (animationFrame !== undefined) {
                cancelAnimationFrame(animationFrame);
            }
        };
    }, [focusRequest, primaryFilterIndex]);

    useEffect(() => {
        if (!saveFilter) {
            return;
        }

        const animationFrame = requestAnimationFrame(() => {
            document.getElementById("save-filter-name")?.focus();
        });
        return () => cancelAnimationFrame(animationFrame);
    }, [saveFilter]);

    if (!context || !filterProperties || !filterPresets) {
        return undefined;
    }

    const clearAllFilters = () => {
        setUiFilters(
            uiFilters.map((filter) => ({
                ...filter,
                value: isBetweenOperator(filter.selectedOperator) ? ["", ""] : "",
            })),
        );
        setErrorMessage(undefined);
        setSelectedPresetId(undefined);
        requestPrimaryFilterFocus();
    };

    const updateUiFilters = (filters: ObjectExplorerPageFilter[]) => {
        setUiFilters(filters);
        setSelectedPresetId(undefined);
    };

    const submitFilters = (event?: FormEvent<HTMLFormElement>) => {
        event?.preventDefault();
        const filters: NodeFilter[] = [];
        let errorText = "";

        for (const filter of uiFilters) {
            const betweenOperator = isBetweenOperator(filter.selectedOperator);

            if (filter.type === NodeFilterPropertyDataType.Number) {
                if (betweenOperator) {
                    const rawValues = Array.isArray(filter.value)
                        ? (filter.value as string[])
                        : [toRawString(filter.value), ""];
                    const value1Raw = toRawString(rawValues[0]);
                    const value2Raw = toRawString(rawValues[1]);

                    // Skip empty numeric range filters before any conversion.
                    if (value1Raw === "" && value2Raw === "") {
                        continue;
                    }

                    const value1 = parseNumericFilterValue(value1Raw);
                    const value2 = parseNumericFilterValue(value2Raw);

                    if (value1 === undefined && value2 !== undefined) {
                        errorText = locConstants.objectExplorerFiltering.firstValueEmptyError(
                            getFilterOperatorString(filter.selectedOperator),
                            filter.name,
                        );
                        break;
                    }

                    if (value2 === undefined && value1 !== undefined) {
                        errorText = locConstants.objectExplorerFiltering.secondValueEmptyError(
                            getFilterOperatorString(filter.selectedOperator),
                            filter.name,
                        );
                        break;
                    }

                    // Treat NaN/invalid numeric values as unset.
                    if (value1 === undefined && value2 === undefined) {
                        continue;
                    }

                    if (value1! > value2!) {
                        errorText =
                            locConstants.objectExplorerFiltering.firstValueLessThanSecondError(
                                getFilterOperatorString(filter.selectedOperator),
                                filter.name,
                            );
                        break;
                    }

                    filters.push({
                        name: filter.name,
                        value: [value1!, value2!],
                        operator: filter.selectedOperator,
                    });
                    continue;
                }

                const rawValue = toRawString(filter.value);
                if (rawValue === "") {
                    continue;
                }

                const numericValue = parseNumericFilterValue(rawValue);
                if (numericValue === undefined) {
                    continue;
                }

                filters.push({
                    name: filter.name,
                    value: numericValue,
                    operator: filter.selectedOperator,
                });
                continue;
            }

            if (betweenOperator) {
                const rawValues = Array.isArray(filter.value)
                    ? (filter.value as string[])
                    : [toRawString(filter.value), ""];
                const value1 = toRawString(rawValues[0]);
                const value2 = toRawString(rawValues[1]);

                if (value1 === "" && value2 === "") {
                    continue;
                }

                if (value1 === "" && value2 !== "") {
                    errorText = locConstants.objectExplorerFiltering.firstValueEmptyError(
                        getFilterOperatorString(filter.selectedOperator),
                        filter.name,
                    );
                    break;
                }

                if (value2 === "" && value1 !== "") {
                    errorText = locConstants.objectExplorerFiltering.secondValueEmptyError(
                        getFilterOperatorString(filter.selectedOperator),
                        filter.name,
                    );
                    break;
                }

                if (value1 > value2) {
                    errorText = locConstants.objectExplorerFiltering.firstValueLessThanSecondError(
                        getFilterOperatorString(filter.selectedOperator),
                        filter.name,
                    );
                    break;
                }

                filters.push({
                    name: filter.name,
                    value: [value1, value2],
                    operator: filter.selectedOperator,
                });
                continue;
            }

            let value: string | undefined;
            switch (filter.type) {
                case NodeFilterPropertyDataType.Boolean:
                case NodeFilterPropertyDataType.Choice:
                    if (filter.value === "" || filter.value === undefined) {
                        value = undefined;
                    } else {
                        value = toRawString(filter.value);
                    }
                    break;
                case NodeFilterPropertyDataType.String:
                case NodeFilterPropertyDataType.Date:
                    value = filter.value as string;
                    break;
                default:
                    value = undefined;
                    break;
            }

            if (value === "" || value === undefined) {
                continue;
            }

            filters.push({
                name: filter.name,
                value,
                operator: filter.selectedOperator,
            });
        }

        if (errorText) {
            setErrorMessage(errorText);
            return;
        }

        const normalizedSaveName = saveName.trim();
        if (saveFilter && !normalizedSaveName) {
            setErrorMessage(locConstants.objectExplorerFiltering.filterNameRequired);
            requestAnimationFrame(() => document.getElementById("save-filter-name")?.focus());
            return;
        }

        if (saveFilter && filters.length === 0) {
            setErrorMessage(locConstants.objectExplorerFiltering.filterValueRequiredToSave);
            requestPrimaryFilterFocus();
            return;
        }

        context.submit(filters, saveFilter ? normalizedSaveName : undefined);
    };

    const getFilterDisplayValue = (filter: NodeFilter): string => {
        const property = filterProperties.find((candidate) => candidate.name === filter.name);
        const choices = property ? getFilterChoices(property) : undefined;
        const getSingleValue = (value: unknown) => {
            const rawValue = toRawString(value);
            return choices?.find((choice) => choice.name === rawValue)?.displayName ?? rawValue;
        };

        return Array.isArray(filter.value)
            ? filter.value.map(getSingleValue).join(` ${locConstants.objectExplorerFiltering.and} `)
            : getSingleValue(filter.value);
    };

    const getPresetDetails = (preset: ObjectExplorerFilterPreset): string[] => {
        return preset.filters.map((filter) => {
            const property = filterProperties.find((candidate) => candidate.name === filter.name);
            return locConstants.objectExplorerFiltering.filterClauseSummary(
                property?.displayName ?? filter.name,
                getFilterOperatorString(filter.operator),
                getFilterDisplayValue(filter),
            );
        });
    };

    const selectPreset = (preset: ObjectExplorerFilterPreset) => {
        setUiFilters(createUiFilters(preset.filters));
        setSelectedPresetId(preset.id);
        setErrorMessage(undefined);
        setSaveFilter(false);
        setSaveName("");
        requestPrimaryFilterFocus();
    };

    const deletePreset = (presetId: string) => {
        if (selectedPresetId === presetId) {
            setSelectedPresetId(undefined);
        }
        context.deletePreset(presetId);
    };

    const nodePathSegments =
        nodePath
            ?.split(/[\\/]/)
            .map((segment) => segment.trim())
            .filter(Boolean) ?? [];

    const nodePathBreadcrumb =
        nodePathSegments.length > 0 ? (
            <span className={classes.breadcrumb} aria-label={nodePath}>
                {nodePathSegments.map((segment, index) => (
                    <span key={`${segment}-${index}`}>
                        {index > 0 && (
                            <span className={classes.breadcrumbSeparator} aria-hidden="true">
                                ›
                            </span>
                        )}
                        <span className={classes.breadcrumbSegment}>{segment}</span>
                    </span>
                ))}
            </span>
        ) : undefined;

    const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
        if (event.key !== "Escape" || event.defaultPrevented) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        context.cancel();
    };

    const clearButton = (
        <Button type="button" appearance="secondary" onClick={clearAllFilters}>
            {locConstants.objectExplorerFiltering.clearAll}
        </Button>
    );
    const dialogButtons = (
        <div className={classes.footerButtons}>
            <Tooltip
                content={locConstants.objectExplorerFiltering.closeTooltip(
                    locConstants.objectExplorerFiltering.escape,
                )}
                relationship="description">
                <Button
                    type="button"
                    appearance="secondary"
                    aria-keyshortcuts="Escape"
                    onClick={() => context.cancel()}>
                    {locConstants.common.close}
                </Button>
            </Tooltip>
            <Tooltip
                content={
                    saveFilter
                        ? locConstants.objectExplorerFiltering.saveAndApplyTooltip(
                              locConstants.objectExplorerFiltering.enter,
                          )
                        : locConstants.objectExplorerFiltering.applyTooltip(
                              locConstants.objectExplorerFiltering.enter,
                          )
                }
                relationship="description">
                <Button
                    type="submit"
                    appearance="primary"
                    aria-keyshortcuts="Enter"
                    disabled={saveFilter && !saveName.trim()}
                    title={
                        saveFilter && !saveName.trim()
                            ? locConstants.objectExplorerFiltering.filterNameRequired
                            : undefined
                    }>
                    {saveFilter
                        ? locConstants.objectExplorerFiltering.saveAndApply
                        : locConstants.objectExplorerFiltering.apply}
                </Button>
            </Tooltip>
        </div>
    );

    return (
        <form className={classes.form} onSubmit={submitFilters} onKeyDown={handleFormKeyDown}>
            <DialogPageShell
                icon={<FilterFunnelIcon16Regular />}
                title={locConstants.objectExplorerFiltering.filterSettings}
                subtitle={nodePathBreadcrumb}
                errorMessage={errorMessage}
                maxContentWidth={1120}
                iconSize={18}
                compactHeader>
                <div className={classes.contentLayout}>
                    <div className={classes.editorColumn}>
                        <div className={classes.saveOptions}>
                            <Checkbox
                                checked={saveFilter}
                                label={locConstants.objectExplorerFiltering.saveThisFilter}
                                onChange={(_event, data) => setSaveFilter(data.checked === true)}
                            />
                            {saveFilter && (
                                <Field
                                    label={locConstants.objectExplorerFiltering.filterName}
                                    required>
                                    <Input
                                        id="save-filter-name"
                                        className={classes.saveName}
                                        value={saveName}
                                        placeholder={
                                            locConstants.objectExplorerFiltering
                                                .filterNamePlaceholder
                                        }
                                        onChange={(_event, data) => setSaveName(data.value)}
                                    />
                                </Field>
                            )}
                        </div>
                        <ObjectExplorerFilterContent
                            uiFilters={uiFilters}
                            setUiFilters={updateUiFilters}
                            getFilterOperatorString={getFilterOperatorString}
                            primaryFilterIndex={primaryFilterIndex}
                            setPrimaryFilterElement={setPrimaryFilterElement}
                        />
                        <div className={classes.previewFooter}>
                            {clearButton}
                            {dialogButtons}
                        </div>
                    </div>
                    <aside className={classes.reusableFiltersColumn}>
                        <ObjectExplorerFilterPresets
                            presets={filterPresets}
                            selectedPresetId={selectedPresetId}
                            getDetails={getPresetDetails}
                            onSelect={selectPreset}
                            onSetPinned={context.setPresetPinned}
                            onDelete={deletePreset}
                            onRename={context.renamePreset}
                        />
                    </aside>
                </div>
            </DialogPageShell>
        </form>
    );
};
