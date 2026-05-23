/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Field,
    InfoLabel,
    Input,
    makeStyles,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    OverlayDrawer,
    Radio,
    RadioGroup,
    Tab,
    TabList,
    Text,
    Textarea,
    tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular, Table16Regular } from "@fluentui/react-icons";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Dab } from "../../../../sharedInterfaces/dab";
import { locConstants } from "../../../common/locConstants";
import { StoredProcedureIcon16Regular } from "../../../common/icons/storedProcedure";
import { ViewIcon16Regular } from "../../../common/icons/view";

const useStyles = makeStyles({
    drawer: {
        width: "720px",
        maxWidth: "calc(100vw - 32px)",
        backgroundColor: "var(--vscode-editor-background)",
    },
    drawerHeader: {
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
    },
    drawerBody: {
        display: "flex",
        flexDirection: "column",
        rowGap: "18px",
        overflowY: "auto",
        backgroundColor: "var(--vscode-editor-background)",
        paddingTop: 0,
        paddingBottom: "18px",
    },
    headerTitleContent: {
        display: "flex",
        flexDirection: "column",
        rowGap: "4px",
    },
    headerObjectRow: {
        display: "flex",
        alignItems: "center",
        columnGap: "6px",
    },
    headerObjectName: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
        fontFamily: tokens.fontFamilyMonospace,
    },
    headerSubtitle: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
        fontWeight: tokens.fontWeightRegular,
    },
    sourceIcon: {
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
    },
    tabs: {
        position: "sticky",
        top: 0,
        zIndex: 3,
        backgroundColor: "var(--vscode-editor-background)",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    tabPanel: {
        display: "flex",
        flexDirection: "column",
        rowGap: "18px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        rowGap: "10px",
    },
    sectionTitle: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    sectionBody: {
        display: "flex",
        flexDirection: "column",
        rowGap: "10px",
    },
    twoColumnGrid: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        columnGap: "10px",
        rowGap: "10px",
    },
    disabledMessageBar: {
        border: `1px solid ${tokens.colorPaletteYellowBorder2}`,
        backgroundColor: "transparent",
    },
    disabledMessageBarTitle: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground2,
    },
    disabledMessageBarText: {
        fontSize: tokens.fontSizeBase100,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground2,
    },
    fieldHint: {
        color: tokens.colorNeutralForeground4,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
    },
    roleCard: {
        display: "flex",
        flexDirection: "column",
        rowGap: "8px",
        padding: "10px 12px",
        borderRadius: "4px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: "var(--vscode-editorWidget-background, transparent)",
    },
    roleHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        columnGap: "8px",
    },
    actionRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "8px 12px",
        paddingLeft: "24px",
    },
    methodGroup: {
        display: "flex",
        flexWrap: "wrap",
        gap: "10px",
    },
    metadataTable: {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: tokens.fontSizeBase200,
    },
    metadataViewport: {
        maxHeight: "300px",
        overflowY: "auto",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "4px",
    },
    metadataGridHeader: {
        display: "grid",
        position: "sticky",
        top: 0,
        zIndex: 1,
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
        fontWeight: tokens.fontWeightSemibold,
    },
    metadataGridBody: {
        position: "relative",
        width: "100%",
    },
    metadataGridRow: {
        display: "grid",
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        alignItems: "center",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        fontSize: tokens.fontSizeBase200,
    },
    columnMetadataGrid: {
        gridTemplateColumns:
            "64px 56px minmax(140px, 1fr) 120px minmax(120px, 1fr) minmax(140px, 1.4fr)",
        columnGap: "8px",
    },
    parameterMetadataGrid: {
        gridTemplateColumns:
            "minmax(160px, 1fr) 120px 88px minmax(120px, 1fr) minmax(160px, 1.4fr)",
        columnGap: "8px",
    },
    metadataGridCell: {
        minWidth: 0,
        padding: "6px 8px",
        outline: "none",
        "&:focus-visible": {
            outline: "1px solid var(--vscode-focusBorder)",
            outlineOffset: "-1px",
        },
    },
    tableHeaderCell: {
        padding: "6px 8px",
        textAlign: "left",
        color: tokens.colorNeutralForeground3,
        fontWeight: tokens.fontWeightSemibold,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        whiteSpace: "nowrap",
    },
    tableCell: {
        padding: "6px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        verticalAlign: "middle",
    },
    tableNameCell: {
        fontFamily: tokens.fontFamilyMonospace,
        color: tokens.colorNeutralForeground1,
        whiteSpace: "nowrap",
    },
    tableTypeCell: {
        fontFamily: tokens.fontFamilyMonospace,
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
    },
    compactInput: {
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
    },
    emptyMetadata: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        padding: "8px 0",
    },
    drawerFooter: {
        alignSelf: "stretch",
        columnGap: "12px",
        paddingTop: "12px",
        marginTop: 0,
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderTop: "1px solid var(--vscode-editorGroup-border)",
    },
    actionButton: {
        minWidth: "132px",
        whiteSpace: "nowrap",
    },
    deepLinkFocus: {
        outline: "1px solid var(--vscode-focusBorder)",
        outlineOffset: "2px",
        borderRadius: "3px",
    },
});

type DabSettingsTab = "identity" | "permissions" | "rest" | "graphql" | "mcp" | "schema";
type MetadataGridKind = "columns" | "parameters";

const COLUMN_METADATA_GRID_COLUMN_COUNT = 6;
const PARAMETER_METADATA_GRID_COLUMN_COUNT = 5;

interface DabEntitySettingsDialogProps {
    entity: Dab.DabEntityConfig;
    existingEntityNames: string[];
    isRestEnabled: boolean;
    isGraphQLEnabled: boolean;
    isMcpEnabled: boolean;
    initialTab?: DabSettingsTab;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onApply: (entity: Dab.DabEntityConfig) => void;
    onEnableApiType: (apiType: Dab.ApiType) => void;
}

function cloneEntityForEditing(entity: Dab.DabEntityConfig): Dab.DabEntityConfig {
    const fields =
        entity.sourceType === Dab.EntitySourceType.StoredProcedure
            ? undefined
            : entity.columns.map((column) => {
                  const field = Dab.getFieldForColumn(entity, column.name);
                  return {
                      name: column.name,
                      alias: field?.alias,
                      description: field?.description,
                      isPrimaryKey:
                          field !== undefined ? field.isPrimaryKey === true : column.isPrimaryKey,
                  };
              });

    return {
        ...entity,
        enabledActions: [...entity.enabledActions],
        columns: entity.columns.map((column) => ({ ...column })),
        fields,
        parameters: entity.parameters?.map((parameter) => ({
            ...parameter,
            name: parameter.name.replace(/^@/, ""),
            isRequired: parameter.isRequired ?? true,
        })),
        advancedSettings: {
            ...entity.advancedSettings,
            permissions: Dab.getEntityPermissions(entity).map((permission) => ({
                role: permission.role,
                actions: [...permission.actions],
            })),
            restEnabled: Dab.isEntityRestEnabled(entity),
            graphQLEnabled: Dab.isEntityGraphQLEnabled(entity),
            mcpEnabled: Dab.isEntityMcpEnabled(entity),
            mcpDmlToolsEnabled: Dab.isEntityMcpDmlToolsEnabled(entity),
            mcpCustomToolEnabled: Dab.isEntityMcpCustomToolEnabled(entity),
            exposeAsMcpCustomTool: Dab.isEntityMcpCustomToolEnabled(entity),
        },
    };
}

function getStoredProcedureRestMethod(settings: Dab.EntityAdvancedSettings): Dab.RestMethod {
    return (
        settings.storedProcedureRestMethods?.find((method) =>
            Dab.storedProcedureAllowedRestMethods.some((allowedMethod) => allowedMethod === method),
        ) ?? Dab.RestMethod.Post
    );
}

function getAllowedActions(sourceType?: Dab.EntitySourceType): Dab.EntityAction[] {
    return sourceType === Dab.EntitySourceType.StoredProcedure
        ? [Dab.EntityAction.Execute]
        : [
              Dab.EntityAction.Create,
              Dab.EntityAction.Read,
              Dab.EntityAction.Update,
              Dab.EntityAction.Delete,
          ];
}

function getActionLabel(action: Dab.EntityAction): string {
    switch (action) {
        case Dab.EntityAction.Create:
            return locConstants.schemaDesigner.create;
        case Dab.EntityAction.Read:
            return locConstants.schemaDesigner.read;
        case Dab.EntityAction.Update:
            return locConstants.schemaDesigner.update;
        case Dab.EntityAction.Delete:
            return locConstants.common.delete;
        case Dab.EntityAction.Execute:
            return locConstants.schemaDesigner.execute;
    }
}

function getDefaultActionsForRole(
    sourceType: Dab.EntitySourceType | undefined,
    role: Dab.AuthorizationRole,
): Dab.EntityAction[] {
    const configuredDefault =
        Dab.getDefaultPermissionsForSource(sourceType).find(
            (permission) => permission.role === role,
        )?.actions ?? [];
    return configuredDefault.length > 0 ? configuredDefault : getAllowedActions(sourceType);
}

export function DabEntitySettingsDialog({
    entity,
    existingEntityNames,
    isRestEnabled,
    isGraphQLEnabled,
    isMcpEnabled,
    initialTab,
    open,
    onOpenChange,
    onApply,
    onEnableApiType,
}: DabEntitySettingsDialogProps) {
    const classes = useStyles();
    const [localEntity, setLocalEntity] = useState<Dab.DabEntityConfig>(() =>
        cloneEntityForEditing(entity),
    );
    const [selectedTab, setSelectedTab] = useState<DabSettingsTab>("identity");
    const [activeTab, setActiveTab] = useState<DabSettingsTab>("identity");
    const drawerBodyRef = useRef<HTMLDivElement | null>(null);
    const tabsRef = useRef<HTMLDivElement | null>(null);
    const metadataScrollRef = useRef<HTMLDivElement | null>(null);
    const identitySectionRef = useRef<HTMLElement | null>(null);
    const permissionsSectionRef = useRef<HTMLElement | null>(null);
    const restSectionRef = useRef<HTMLElement | null>(null);
    const graphQLSectionRef = useRef<HTMLElement | null>(null);
    const mcpSectionRef = useRef<HTMLElement | null>(null);
    const schemaSectionRef = useRef<HTMLDivElement | null>(null);
    const deepLinkFocusRef = useRef<HTMLElement | null>(null);

    const getSectionElement = (value: DabSettingsTab): HTMLElement | null => {
        switch (value) {
            case "identity":
                return identitySectionRef.current;
            case "permissions":
                return permissionsSectionRef.current;
            case "rest":
                return restSectionRef.current;
            case "graphql":
                return graphQLSectionRef.current;
            case "mcp":
                return mcpSectionRef.current;
            case "schema":
                return schemaSectionRef.current;
        }
    };

    const focusSectionControl = (value: DabSettingsTab) => {
        const section = getSectionElement(value);
        const focusTarget = section?.querySelector<HTMLElement>(
            [
                "input:not([disabled])",
                "textarea:not([disabled])",
                "button:not([disabled])",
                "[role='checkbox']:not([aria-disabled='true'])",
                "[role='radio']:not([aria-disabled='true'])",
                "[tabindex]:not([tabindex='-1'])",
            ].join(","),
        );
        deepLinkFocusRef.current?.classList.remove(classes.deepLinkFocus);
        deepLinkFocusRef.current = null;

        if (!focusTarget) {
            return;
        }

        focusTarget.focus({ preventScroll: true });
        focusTarget.classList.add(classes.deepLinkFocus);
        deepLinkFocusRef.current = focusTarget;
        focusTarget.addEventListener(
            "blur",
            () => {
                focusTarget.classList.remove(classes.deepLinkFocus);
                if (deepLinkFocusRef.current === focusTarget) {
                    deepLinkFocusRef.current = null;
                }
            },
            { once: true },
        );
    };

    const scrollToSelectedTab = (value: DabSettingsTab, behavior: ScrollBehavior = "smooth") => {
        window.setTimeout(() => {
            if (value === "schema") {
                const drawerBody = drawerBodyRef.current;
                const schemaSection = schemaSectionRef.current;
                if (!drawerBody || !schemaSection) {
                    return;
                }

                drawerBody.scrollTo({
                    top: Math.max(
                        0,
                        schemaSection.offsetTop - (tabsRef.current?.offsetHeight ?? 0),
                    ),
                    behavior,
                });
            } else {
                drawerBodyRef.current?.scrollTo({ top: 0, behavior });
            }

            window.setTimeout(() => focusSectionControl(value), behavior === "auto" ? 0 : 180);
        }, 0);
    };

    const handleTabSelect = (value: DabSettingsTab) => {
        setSelectedTab(value);
        setActiveTab(value);
        scrollToSelectedTab(value);
    };

    useEffect(() => {
        if (open) {
            setLocalEntity(cloneEntityForEditing(entity));
            const tab = initialTab ?? "identity";
            setSelectedTab(tab);
            setActiveTab(tab);
            scrollToSelectedTab(tab, "auto");
        }
    }, [entity, initialTab, open]);

    useEffect(() => {
        const drawerBody = drawerBodyRef.current;
        if (!open || !drawerBody) {
            return;
        }

        const handleScroll = () => {
            const schemaSection = schemaSectionRef.current;
            if (!schemaSection) {
                setActiveTab(selectedTab);
                return;
            }

            const stickyTabsHeight = tabsRef.current?.offsetHeight ?? 0;
            const activationOffset = Math.max(0, schemaSection.offsetTop - stickyTabsHeight - 12);
            setActiveTab(drawerBody.scrollTop >= activationOffset ? "schema" : selectedTab);
        };

        handleScroll();
        drawerBody.addEventListener("scroll", handleScroll, { passive: true });
        return () => drawerBody.removeEventListener("scroll", handleScroll);
    }, [open, selectedTab]);

    const settings = localEntity.advancedSettings;
    const isStoredProcedure = localEntity.sourceType === Dab.EntitySourceType.StoredProcedure;
    const sourceObjectName = `${localEntity.schemaName}.${
        localEntity.sourceName ?? localEntity.tableName
    }`;
    const entityName = settings.entityName.trim();
    const description = settings.description?.trim() ?? "";
    const customRestPath = settings.customRestPath?.trim() ?? "";
    const customGraphQLSingularType =
        (settings.customGraphQLSingularType ?? settings.customGraphQLType)?.trim() ?? "";
    const customGraphQLPluralType = settings.customGraphQLPluralType?.trim() ?? "";
    const storedProcedureRestMethod = getStoredProcedureRestMethod(settings);
    const storedProcedureGraphQLOperation =
        settings.storedProcedureGraphQLOperation ?? Dab.GraphQLOperation.Mutation;
    const isEntityRestEnabled = settings.restEnabled !== false;
    const isEntityGraphQLEnabled = settings.graphQLEnabled !== false;
    const isEntityMcpDmlToolsEnabled = settings.mcpDmlToolsEnabled !== false;
    const isEntityMcpCustomToolEnabled =
        settings.mcpCustomToolEnabled ?? settings.exposeAsMcpCustomTool ?? false;
    const isEntityMcpEnabled = Dab.isEntityMcpEnabled(localEntity);
    const permissions = useMemo(() => Dab.getEntityPermissions(localEntity), [localEntity]);
    const parameters = localEntity.parameters ?? [];
    const columnVirtualizer = useVirtualizer({
        count: localEntity.columns.length,
        getScrollElement: () => metadataScrollRef.current,
        estimateSize: () => 41,
        overscan: 8,
    });
    const parameterVirtualizer = useVirtualizer({
        count: parameters.length,
        getScrollElement: () => metadataScrollRef.current,
        estimateSize: () => 41,
        overscan: 8,
    });
    const isLocallyExposed = Dab.isEntityExposed(localEntity);

    const focusMetadataCell = (kind: MetadataGridKind, rowIndex: number, columnIndex: number) => {
        const rowCount = kind === "columns" ? localEntity.columns.length : parameters.length;
        const columnCount =
            kind === "columns"
                ? COLUMN_METADATA_GRID_COLUMN_COUNT
                : PARAMETER_METADATA_GRID_COLUMN_COUNT;
        const nextRow = Math.min(Math.max(rowIndex, 0), Math.max(rowCount - 1, 0));
        const nextColumn = Math.min(Math.max(columnIndex, 0), columnCount - 1);
        const virtualizer = kind === "columns" ? columnVirtualizer : parameterVirtualizer;
        virtualizer.scrollToIndex(nextRow, { align: "auto" });

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                metadataScrollRef.current
                    ?.querySelector<HTMLElement>(
                        `[data-dab-metadata-kind="${kind}"][data-dab-row-index="${nextRow}"][data-dab-column-index="${nextColumn}"]`,
                    )
                    ?.focus();
            });
        });
    };

    const focusCellControl = (cell: HTMLElement) => {
        cell.querySelector<HTMLElement>(
            [
                "input:not([disabled])",
                "textarea:not([disabled])",
                "button:not([disabled])",
                "[role='checkbox']:not([aria-disabled='true'])",
                "[role='radio']:not([aria-disabled='true'])",
            ].join(","),
        )?.focus();
    };

    const handleMetadataGridKeyDown = (
        event: KeyboardEvent<HTMLElement>,
        kind: MetadataGridKind,
        rowCount: number,
        columnCount: number,
    ) => {
        const target = event.target as HTMLElement;
        const cell = target.closest<HTMLElement>("[data-dab-metadata-cell]");
        if (!cell) {
            return;
        }

        const rowIndex = Number(cell.dataset.dabRowIndex);
        const columnIndex = Number(cell.dataset.dabColumnIndex);
        if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) {
            return;
        }

        const isTextInput =
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target.isContentEditable;
        const key = event.key;

        if (isTextInput && key !== "ArrowUp" && key !== "ArrowDown" && key !== "Escape") {
            return;
        }

        let nextRow = rowIndex;
        let nextColumn = columnIndex;
        switch (key) {
            case "ArrowDown":
                nextRow += 1;
                break;
            case "ArrowUp":
                nextRow -= 1;
                break;
            case "ArrowRight":
                nextColumn += 1;
                break;
            case "ArrowLeft":
                nextColumn -= 1;
                break;
            case "Home":
                nextColumn = 0;
                break;
            case "End":
                nextColumn = columnCount - 1;
                break;
            case "PageDown":
                nextRow += 8;
                break;
            case "PageUp":
                nextRow -= 8;
                break;
            case "Enter":
                if (target === cell) {
                    event.preventDefault();
                    focusCellControl(cell);
                }
                return;
            case "Escape":
                if (target !== cell) {
                    event.preventDefault();
                    cell.focus();
                }
                return;
            default:
                return;
        }

        event.preventDefault();
        focusMetadataCell(
            kind,
            Math.min(Math.max(nextRow, 0), Math.max(rowCount - 1, 0)),
            Math.min(Math.max(nextColumn, 0), columnCount - 1),
        );
    };

    const getMetadataCellProps = (
        kind: MetadataGridKind,
        rowIndex: number,
        columnIndex: number,
    ) => ({
        role: "gridcell",
        tabIndex: 0,
        "data-dab-metadata-cell": true,
        "data-dab-metadata-kind": kind,
        "data-dab-row-index": rowIndex,
        "data-dab-column-index": columnIndex,
        "aria-colindex": columnIndex + 1,
    });

    const normalizedExistingEntityNames = useMemo(
        () => new Set(existingEntityNames.map(Dab.normalizeDabIdentifier)),
        [existingEntityNames],
    );

    const entityNameValidationMessage =
        entityName.length === 0
            ? "entityName must be a non-empty string."
            : normalizedExistingEntityNames.has(Dab.normalizeDabIdentifier(entityName))
              ? `entityName must be unique across entities. Duplicate: ${entityName}`
              : Dab.validateDabEntityName(entityName);
    const customRestPathValidationMessage =
        customRestPath.length > 0 ? Dab.validateDabCustomRestPath(customRestPath) : undefined;
    const customGraphQLSingularTypeValidationMessage =
        customGraphQLPluralType.length > 0 && customGraphQLSingularType.length === 0
            ? "customGraphQLSingularType is required when customGraphQLPluralType is set."
            : customGraphQLSingularType.length > 0
              ? Dab.validateDabCustomGraphQLType(
                    customGraphQLSingularType,
                    "customGraphQLSingularType",
                )
              : undefined;
    const customGraphQLPluralTypeValidationMessage =
        customGraphQLPluralType.length > 0
            ? Dab.validateDabCustomGraphQLType(customGraphQLPluralType, "customGraphQLPluralType")
            : undefined;
    const missingLogicalKeyValidationMessage =
        isLocallyExposed && !isStoredProcedure && !Dab.hasLogicalKey(localEntity)
            ? locConstants.schemaDesigner.missingLogicalKeyRequired
            : undefined;
    const hasValidationError =
        !!entityNameValidationMessage ||
        !!customRestPathValidationMessage ||
        !!customGraphQLSingularTypeValidationMessage ||
        !!customGraphQLPluralTypeValidationMessage ||
        !!missingLogicalKeyValidationMessage;

    const updateAdvancedSettings = (patch: Partial<Dab.EntityAdvancedSettings>) => {
        setLocalEntity((prev) => ({
            ...prev,
            advancedSettings: {
                ...prev.advancedSettings,
                ...patch,
            },
        }));
    };

    const updateMcpParentEnabled = (enabled: boolean) => {
        updateAdvancedSettings({
            mcpEnabled: enabled,
            mcpDmlToolsEnabled: enabled,
            ...(isStoredProcedure
                ? {
                      exposeAsMcpCustomTool: false,
                      mcpCustomToolEnabled: false,
                  }
                : {}),
        });
    };

    const updateMcpDmlToolsEnabled = (enabled: boolean) => {
        updateAdvancedSettings({
            mcpEnabled: isStoredProcedure ? enabled || isEntityMcpCustomToolEnabled : enabled,
            mcpDmlToolsEnabled: enabled,
        });
    };

    const updateMcpCustomToolEnabled = (enabled: boolean) => {
        updateAdvancedSettings({
            mcpEnabled: enabled || isEntityMcpDmlToolsEnabled,
            exposeAsMcpCustomTool: enabled,
            mcpCustomToolEnabled: enabled,
        });
    };

    const updatePermissions = (updatedPermissions: Dab.EntityPermissionConfig[]) => {
        setLocalEntity((prev) => {
            const activePermission =
                updatedPermissions.find(
                    (permission) =>
                        permission.role === prev.advancedSettings.authorizationRole &&
                        permission.actions.length > 0,
                ) ??
                updatedPermissions.find((permission) => permission.actions.length > 0) ??
                updatedPermissions[0];

            return {
                ...prev,
                enabledActions: activePermission ? [...activePermission.actions] : [],
                advancedSettings: {
                    ...prev.advancedSettings,
                    authorizationRole:
                        activePermission?.role ?? prev.advancedSettings.authorizationRole,
                    permissions: updatedPermissions.map((permission) => ({
                        role: permission.role,
                        actions: [...permission.actions],
                    })),
                },
            };
        });
    };

    const updateRoleEnabled = (role: Dab.AuthorizationRole, enabled: boolean) => {
        const updatedPermissions = permissions.map((permission) =>
            permission.role === role
                ? {
                      ...permission,
                      actions: enabled
                          ? permission.actions.length > 0
                              ? permission.actions
                              : getDefaultActionsForRole(localEntity.sourceType, role)
                          : [],
                  }
                : permission,
        );
        updatePermissions(updatedPermissions);
    };

    const updateRoleAction = (
        role: Dab.AuthorizationRole,
        action: Dab.EntityAction,
        enabled: boolean,
    ) => {
        const updatedPermissions = permissions.map((permission) => {
            if (permission.role !== role) {
                return permission;
            }

            const actions = enabled
                ? [...new Set([...permission.actions, action])]
                : permission.actions.filter((a) => a !== action);
            return { ...permission, actions };
        });
        updatePermissions(updatedPermissions);
    };

    const updateField = (
        column: Dab.DabColumnConfig,
        patch: Partial<Omit<Dab.DabFieldConfig, "name">>,
    ) => {
        setLocalEntity((prev) => {
            const currentFields =
                prev.fields ??
                prev.columns.map((c) => ({
                    name: c.name,
                    isPrimaryKey: c.isPrimaryKey,
                }));
            const fields = currentFields.map((field) =>
                Dab.normalizeDabIdentifier(field.name) === Dab.normalizeDabIdentifier(column.name)
                    ? { ...field, ...patch }
                    : field,
            );
            const logicalKey = patch.isPrimaryKey ?? Dab.isLogicalKeyColumn(prev, column);
            return {
                ...prev,
                fields,
                columns: prev.columns.map((c) =>
                    c.id === column.id && logicalKey ? { ...c, isExposed: true } : c,
                ),
            };
        });
    };

    const updateColumnExposure = (column: Dab.DabColumnConfig, isExposed: boolean) => {
        setLocalEntity((prev) => {
            if (!isExposed && Dab.isLogicalKeyColumn(prev, column)) {
                return prev;
            }

            return {
                ...prev,
                columns: prev.columns.map((c) => (c.id === column.id ? { ...c, isExposed } : c)),
            };
        });
    };

    const updateParameter = (
        parameterName: string,
        patch: Partial<Dab.DabParameterConfig> & { clearDefault?: boolean },
    ) => {
        setLocalEntity((prev) => ({
            ...prev,
            parameters: prev.parameters?.map((parameter) => {
                if (
                    Dab.normalizeDabIdentifier(parameter.name.replace(/^@/, "")) !==
                    Dab.normalizeDabIdentifier(parameterName.replace(/^@/, ""))
                ) {
                    return parameter;
                }

                const updated: Dab.DabParameterConfig = { ...parameter, ...patch };
                if (patch.clearDefault) {
                    delete updated.defaultValue;
                }
                return updated;
            }),
        }));
    };

    const renderSourceIcon = () => {
        switch (localEntity.sourceType ?? Dab.EntitySourceType.Table) {
            case Dab.EntitySourceType.View:
                return <ViewIcon16Regular className={classes.sourceIcon} />;
            case Dab.EntitySourceType.StoredProcedure:
                return <StoredProcedureIcon16Regular className={classes.sourceIcon} />;
            case Dab.EntitySourceType.Table:
            default:
                return <Table16Regular className={classes.sourceIcon} />;
        }
    };

    const renderSectionTitle = (title: string) => (
        <Text className={classes.sectionTitle}>{title}</Text>
    );

    const renderInfoLabel = (label: string, infoText: string) => (
        <InfoLabel size="small" info={infoText}>
            {label}
        </InfoLabel>
    );

    const renderDisabledBanner = (apiType: Dab.ApiType, label: string, helpText?: string) => (
        <MessageBar
            intent="warning"
            layout="multiline"
            shape="rounded"
            className={classes.disabledMessageBar}>
            <MessageBarBody>
                <MessageBarTitle className={classes.disabledMessageBarTitle}>
                    {locConstants.schemaDesigner.apiTypeNotEnabledGlobally(label)}
                </MessageBarTitle>
                <span className={classes.disabledMessageBarText}>
                    {helpText ?? locConstants.schemaDesigner.enableApiTypeForEntity(label)}
                </span>
            </MessageBarBody>
            <MessageBarActions>
                <Button appearance="outline" size="small" onClick={() => onEnableApiType(apiType)}>
                    {locConstants.schemaDesigner.enableApiTypeGlobally(label)}
                </Button>
            </MessageBarActions>
        </MessageBar>
    );

    const renderPermissionRole = (role: Dab.AuthorizationRole) => {
        const permission = permissions.find((p) => p.role === role);
        const actions = permission?.actions ?? [];
        const enabled = actions.length > 0;
        const roleLabel =
            role === Dab.AuthorizationRole.Anonymous
                ? locConstants.schemaDesigner.anonymous
                : locConstants.schemaDesigner.authenticated;
        const allowedActions = getAllowedActions(localEntity.sourceType);
        const allSelected = enabled && allowedActions.every((action) => actions.includes(action));
        const toggleAllForRole = () => {
            const updatedPermissions = permissions.map((p) =>
                p.role === role ? { ...p, actions: allSelected ? [] : [...allowedActions] } : p,
            );
            updatePermissions(updatedPermissions);
        };

        return (
            <div className={classes.roleCard} key={role}>
                <div className={classes.roleHeader}>
                    <Checkbox
                        checked={enabled}
                        label={roleLabel}
                        onChange={(_, data) => updateRoleEnabled(role, data.checked === true)}
                    />
                    <Button
                        appearance="outline"
                        size="small"
                        onClick={toggleAllForRole}
                        aria-label={
                            allSelected ? locConstants.common.none : locConstants.schemaDesigner.all
                        }>
                        {allSelected ? locConstants.common.none : locConstants.schemaDesigner.all}
                    </Button>
                </div>
                {enabled && (
                    <div className={classes.actionRow}>
                        {allowedActions.map((action) => (
                            <Checkbox
                                key={action}
                                checked={actions.includes(action)}
                                label={getActionLabel(action)}
                                onChange={(_, data) =>
                                    updateRoleAction(role, action, data.checked === true)
                                }
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const renderColumnsSection = () => {
        if (isStoredProcedure) {
            return undefined;
        }

        return (
            <section className={classes.section}>
                {renderSectionTitle(locConstants.schemaDesigner.columns)}
                {missingLogicalKeyValidationMessage && (
                    <MessageBar intent="error" layout="multiline" shape="rounded">
                        <MessageBarBody>{missingLogicalKeyValidationMessage}</MessageBarBody>
                    </MessageBar>
                )}
                {localEntity.columns.length === 0 ? (
                    <Text className={classes.emptyMetadata}>
                        {locConstants.schemaDesigner.noColumnsDiscovered}
                    </Text>
                ) : (
                    <div
                        className={classes.metadataViewport}
                        ref={metadataScrollRef}
                        role="grid"
                        aria-rowcount={localEntity.columns.length + 1}
                        aria-colcount={COLUMN_METADATA_GRID_COLUMN_COUNT}
                        onKeyDown={(event) =>
                            handleMetadataGridKeyDown(
                                event,
                                "columns",
                                localEntity.columns.length,
                                COLUMN_METADATA_GRID_COLUMN_COUNT,
                            )
                        }>
                        <div
                            role="row"
                            aria-rowindex={1}
                            className={`${classes.metadataGridHeader} ${classes.columnMetadataGrid}`}>
                            <div
                                role="columnheader"
                                aria-colindex={1}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.expose}
                            </div>
                            <div
                                role="columnheader"
                                aria-colindex={2}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.key}
                            </div>
                            <div
                                role="columnheader"
                                aria-colindex={3}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.entityName}
                            </div>
                            <div
                                role="columnheader"
                                aria-colindex={4}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.dataType}
                            </div>
                            <div
                                role="columnheader"
                                aria-colindex={5}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.alias}
                            </div>
                            <div
                                role="columnheader"
                                aria-colindex={6}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.description}
                            </div>
                        </div>
                        <div
                            className={classes.metadataGridBody}
                            style={{ height: `${columnVirtualizer.getTotalSize()}px` }}>
                            {columnVirtualizer.getVirtualItems().map((virtualRow) => {
                                const column = localEntity.columns[virtualRow.index];
                                const field = Dab.getFieldForColumn(localEntity, column.name);
                                const isLogicalKey = Dab.isLogicalKeyColumn(localEntity, column);
                                return (
                                    <div
                                        key={column.id}
                                        role="row"
                                        aria-rowindex={virtualRow.index + 2}
                                        className={`${classes.metadataGridRow} ${classes.columnMetadataGrid}`}
                                        style={{
                                            height: `${virtualRow.size}px`,
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}>
                                        <div
                                            {...getMetadataCellProps(
                                                "columns",
                                                virtualRow.index,
                                                0,
                                            )}
                                            className={classes.metadataGridCell}>
                                            <Checkbox
                                                checked={isLogicalKey || column.isExposed}
                                                disabled={isLogicalKey}
                                                onChange={(_, data) =>
                                                    updateColumnExposure(
                                                        column,
                                                        data.checked === true,
                                                    )
                                                }
                                                aria-label={locConstants.schemaDesigner.exposeColumn(
                                                    column.name,
                                                )}
                                            />
                                        </div>
                                        <div
                                            {...getMetadataCellProps(
                                                "columns",
                                                virtualRow.index,
                                                1,
                                            )}
                                            className={classes.metadataGridCell}>
                                            <Checkbox
                                                checked={isLogicalKey}
                                                onChange={(_, data) =>
                                                    updateField(column, {
                                                        isPrimaryKey: data.checked === true,
                                                    })
                                                }
                                                aria-label={locConstants.schemaDesigner.logicalKey}
                                            />
                                        </div>
                                        <div
                                            {...getMetadataCellProps(
                                                "columns",
                                                virtualRow.index,
                                                2,
                                            )}
                                            className={`${classes.metadataGridCell} ${classes.tableNameCell}`}>
                                            {column.name}
                                        </div>
                                        <div
                                            {...getMetadataCellProps(
                                                "columns",
                                                virtualRow.index,
                                                3,
                                            )}
                                            className={`${classes.metadataGridCell} ${classes.tableTypeCell}`}>
                                            {column.dataType}
                                        </div>
                                        <div
                                            {...getMetadataCellProps(
                                                "columns",
                                                virtualRow.index,
                                                4,
                                            )}
                                            className={classes.metadataGridCell}>
                                            <Input
                                                className={classes.compactInput}
                                                size="small"
                                                value={field?.alias ?? ""}
                                                onChange={(_, data) =>
                                                    updateField(column, {
                                                        alias: data.value || undefined,
                                                    })
                                                }
                                            />
                                        </div>
                                        <div
                                            {...getMetadataCellProps(
                                                "columns",
                                                virtualRow.index,
                                                5,
                                            )}
                                            className={classes.metadataGridCell}>
                                            <Input
                                                className={classes.compactInput}
                                                size="small"
                                                value={field?.description ?? ""}
                                                onChange={(_, data) =>
                                                    updateField(column, {
                                                        description: data.value || undefined,
                                                    })
                                                }
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </section>
        );
    };

    const renderParametersSection = () => {
        if (!isStoredProcedure) {
            return undefined;
        }

        return (
            <section className={classes.section}>
                {renderSectionTitle(locConstants.schemaDesigner.parameters)}
                {parameters.length === 0 ? (
                    <Text className={classes.emptyMetadata}>
                        {locConstants.schemaDesigner.noParametersDiscovered}
                    </Text>
                ) : (
                    <div
                        className={classes.metadataViewport}
                        ref={metadataScrollRef}
                        role="grid"
                        aria-rowcount={parameters.length + 1}
                        aria-colcount={PARAMETER_METADATA_GRID_COLUMN_COUNT}
                        onKeyDown={(event) =>
                            handleMetadataGridKeyDown(
                                event,
                                "parameters",
                                parameters.length,
                                PARAMETER_METADATA_GRID_COLUMN_COUNT,
                            )
                        }>
                        <div
                            role="row"
                            aria-rowindex={1}
                            className={`${classes.metadataGridHeader} ${classes.parameterMetadataGrid}`}>
                            <div
                                role="columnheader"
                                aria-colindex={1}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.entityName}
                            </div>
                            <div
                                role="columnheader"
                                aria-colindex={2}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.dataType}
                            </div>
                            <div
                                role="columnheader"
                                aria-colindex={3}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.required}
                            </div>
                            <div
                                role="columnheader"
                                aria-colindex={4}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.defaultValue}
                            </div>
                            <div
                                role="columnheader"
                                aria-colindex={5}
                                className={classes.metadataGridCell}>
                                {locConstants.schemaDesigner.description}
                            </div>
                        </div>
                        <div
                            className={classes.metadataGridBody}
                            style={{ height: `${parameterVirtualizer.getTotalSize()}px` }}>
                            {parameterVirtualizer.getVirtualItems().map((virtualRow) => {
                                const parameter = parameters[virtualRow.index];
                                return (
                                    <div
                                        key={parameter.name}
                                        role="row"
                                        aria-rowindex={virtualRow.index + 2}
                                        className={`${classes.metadataGridRow} ${classes.parameterMetadataGrid}`}
                                        style={{
                                            height: `${virtualRow.size}px`,
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}>
                                        <div
                                            {...getMetadataCellProps(
                                                "parameters",
                                                virtualRow.index,
                                                0,
                                            )}
                                            className={`${classes.metadataGridCell} ${classes.tableNameCell}`}>
                                            @{parameter.name.replace(/^@/, "")}
                                        </div>
                                        <div
                                            {...getMetadataCellProps(
                                                "parameters",
                                                virtualRow.index,
                                                1,
                                            )}
                                            className={`${classes.metadataGridCell} ${classes.tableTypeCell}`}>
                                            {parameter.dataType ?? ""}
                                        </div>
                                        <div
                                            {...getMetadataCellProps(
                                                "parameters",
                                                virtualRow.index,
                                                2,
                                            )}
                                            className={classes.metadataGridCell}>
                                            <Checkbox
                                                checked={parameter.isRequired !== false}
                                                onChange={(_, data) =>
                                                    updateParameter(parameter.name, {
                                                        isRequired: data.checked === true,
                                                    })
                                                }
                                            />
                                        </div>
                                        <div
                                            {...getMetadataCellProps(
                                                "parameters",
                                                virtualRow.index,
                                                3,
                                            )}
                                            className={classes.metadataGridCell}>
                                            <Input
                                                className={classes.compactInput}
                                                size="small"
                                                value={
                                                    parameter.defaultValue === undefined ||
                                                    parameter.defaultValue === null
                                                        ? ""
                                                        : String(parameter.defaultValue)
                                                }
                                                onChange={(_, data) =>
                                                    updateParameter(parameter.name, {
                                                        defaultValue: data.value || undefined,
                                                        clearDefault: data.value.length === 0,
                                                    })
                                                }
                                            />
                                        </div>
                                        <div
                                            {...getMetadataCellProps(
                                                "parameters",
                                                virtualRow.index,
                                                4,
                                            )}
                                            className={classes.metadataGridCell}>
                                            <Input
                                                className={classes.compactInput}
                                                size="small"
                                                value={parameter.description ?? ""}
                                                onChange={(_, data) =>
                                                    updateParameter(parameter.name, {
                                                        description: data.value || undefined,
                                                    })
                                                }
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </section>
        );
    };

    const handleCancel = () => {
        onOpenChange(false);
    };

    const handleApply = () => {
        if (hasValidationError) {
            return;
        }

        const sanitizedPermissions = Dab.getEntityPermissions(localEntity).map((permission) => ({
            role: permission.role,
            actions: [...permission.actions],
        }));
        const activePermission =
            sanitizedPermissions.find(
                (permission) =>
                    permission.role === settings.authorizationRole && permission.actions.length > 0,
            ) ??
            sanitizedPermissions.find((permission) => permission.actions.length > 0) ??
            sanitizedPermissions[0];

        const sanitizedEntity: Dab.DabEntityConfig = {
            ...localEntity,
            isEnabled: Dab.isEntityExposed(localEntity),
            enabledActions: activePermission ? [...activePermission.actions] : [],
            columns: localEntity.columns.map((column) =>
                Dab.isLogicalKeyColumn(localEntity, column)
                    ? { ...column, isExposed: true }
                    : { ...column },
            ),
            fields: isStoredProcedure
                ? undefined
                : localEntity.columns.map((column) => {
                      const field = Dab.getFieldForColumn(localEntity, column.name);
                      return {
                          name: column.name,
                          ...(field?.alias?.trim() ? { alias: field.alias.trim() } : {}),
                          ...(field?.description?.trim()
                              ? { description: field.description.trim() }
                              : {}),
                          isPrimaryKey: field?.isPrimaryKey === true,
                      };
                  }),
            parameters: localEntity.parameters?.map((parameter) => ({
                name: parameter.name.replace(/^@/, ""),
                dataType: parameter.dataType,
                isRequired: parameter.isRequired !== false,
                ...(parameter.defaultValue !== undefined && parameter.defaultValue !== ""
                    ? { defaultValue: String(parameter.defaultValue) }
                    : {}),
                ...(parameter.description?.trim()
                    ? { description: parameter.description.trim() }
                    : {}),
            })),
            advancedSettings: {
                ...settings,
                entityName,
                description: description.length > 0 ? description : undefined,
                authorizationRole: activePermission?.role ?? settings.authorizationRole,
                permissions: sanitizedPermissions,
                customRestPath: customRestPath.length > 0 ? customRestPath : undefined,
                customGraphQLType: undefined,
                customGraphQLSingularType:
                    customGraphQLSingularType.length > 0 ? customGraphQLSingularType : undefined,
                customGraphQLPluralType:
                    customGraphQLPluralType.length > 0 ? customGraphQLPluralType : undefined,
                storedProcedureRestMethods: isStoredProcedure
                    ? [storedProcedureRestMethod]
                    : undefined,
                storedProcedureGraphQLOperation: isStoredProcedure
                    ? storedProcedureGraphQLOperation
                    : undefined,
                mcpEnabled: isEntityMcpEnabled,
                mcpDmlToolsEnabled: isEntityMcpEnabled && isEntityMcpDmlToolsEnabled,
                exposeAsMcpCustomTool: isStoredProcedure ? isEntityMcpCustomToolEnabled : undefined,
                mcpCustomToolEnabled: isStoredProcedure ? isEntityMcpCustomToolEnabled : undefined,
            },
        };

        onApply(sanitizedEntity);
    };

    return (
        <OverlayDrawer
            position="end"
            open={open}
            onOpenChange={(_, { open }) => onOpenChange(open)}
            className={classes.drawer}>
            <DrawerHeader className={classes.drawerHeader}>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label={locConstants.common.close}
                            icon={<Dismiss24Regular />}
                            onClick={handleCancel}
                        />
                    }>
                    <div className={classes.headerTitleContent}>
                        <div className={classes.headerObjectRow}>
                            {renderSourceIcon()}
                            <span className={classes.headerObjectName}>{sourceObjectName}</span>
                        </div>
                        <span className={classes.headerSubtitle}>
                            {locConstants.schemaDesigner.advancedEntityConfiguration}
                        </span>
                    </div>
                </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody className={classes.drawerBody} ref={drawerBodyRef}>
                <TabList
                    ref={tabsRef}
                    className={classes.tabs}
                    selectedValue={activeTab}
                    onTabSelect={(_, data) => handleTabSelect(data.value as DabSettingsTab)}>
                    <Tab value="identity">{locConstants.schemaDesigner.identity}</Tab>
                    <Tab value="permissions">{locConstants.schemaDesigner.authorizationRole}</Tab>
                    <Tab value="rest">{locConstants.schemaDesigner.rest}</Tab>
                    <Tab value="graphql">{locConstants.schemaDesigner.graphql}</Tab>
                    <Tab value="mcp">{locConstants.schemaDesigner.mcp}</Tab>
                    <Tab value="schema">
                        {isStoredProcedure
                            ? locConstants.schemaDesigner.parameters
                            : locConstants.schemaDesigner.columns}
                    </Tab>
                </TabList>
                <div className={classes.tabPanel}>
                    <section
                        ref={identitySectionRef}
                        className={classes.section}
                        hidden={selectedTab !== "identity"}>
                        {renderSectionTitle(locConstants.schemaDesigner.identity)}
                        <div className={classes.sectionBody}>
                            <Field
                                label={locConstants.schemaDesigner.entityName}
                                required
                                validationState={entityNameValidationMessage ? "error" : undefined}
                                validationMessage={entityNameValidationMessage}>
                                <Input
                                    value={settings.entityName}
                                    onChange={(_, data) =>
                                        updateAdvancedSettings({ entityName: data.value })
                                    }
                                />
                            </Field>
                            <Field label={locConstants.schemaDesigner.description}>
                                <Textarea
                                    value={settings.description ?? ""}
                                    onChange={(_, data) =>
                                        updateAdvancedSettings({
                                            description: data.value || undefined,
                                        })
                                    }
                                />
                            </Field>
                        </div>
                    </section>

                    <section
                        ref={permissionsSectionRef}
                        className={classes.section}
                        hidden={selectedTab !== "permissions"}>
                        {renderSectionTitle(locConstants.schemaDesigner.authorizationRole)}
                        <div className={classes.sectionBody}>
                            {renderPermissionRole(Dab.AuthorizationRole.Anonymous)}
                            {renderPermissionRole(Dab.AuthorizationRole.Authenticated)}
                        </div>
                    </section>

                    <section
                        ref={restSectionRef}
                        className={classes.section}
                        hidden={selectedTab !== "rest"}>
                        {renderSectionTitle(locConstants.schemaDesigner.rest)}
                        <div className={classes.sectionBody}>
                            {!isRestEnabled ? (
                                renderDisabledBanner(
                                    Dab.ApiType.Rest,
                                    locConstants.schemaDesigner.rest,
                                )
                            ) : (
                                <>
                                    <Checkbox
                                        checked={isEntityRestEnabled}
                                        onChange={(_, data) =>
                                            updateAdvancedSettings({
                                                restEnabled: data.checked === true,
                                            })
                                        }
                                        label={locConstants.schemaDesigner.enableRestForEntity}
                                    />
                                    {isEntityRestEnabled && (
                                        <>
                                            <Field
                                                label={renderInfoLabel(
                                                    locConstants.schemaDesigner.customRestPath,
                                                    locConstants.schemaDesigner.customRestPathHelp,
                                                )}
                                                validationState={
                                                    customRestPathValidationMessage
                                                        ? "error"
                                                        : undefined
                                                }
                                                validationMessage={customRestPathValidationMessage}>
                                                <Input
                                                    value={settings.customRestPath ?? ""}
                                                    placeholder={(
                                                        localEntity.sourceName ??
                                                        localEntity.tableName
                                                    ).toLowerCase()}
                                                    onChange={(_, data) =>
                                                        updateAdvancedSettings({
                                                            customRestPath: data.value || undefined,
                                                        })
                                                    }
                                                />
                                            </Field>

                                            {isStoredProcedure && (
                                                <Field
                                                    label={renderInfoLabel(
                                                        locConstants.schemaDesigner
                                                            .storedProcedureRestMethods,
                                                        locConstants.schemaDesigner
                                                            .storedProcedureRestMethodsHelp,
                                                    )}
                                                    required>
                                                    <RadioGroup
                                                        className={classes.methodGroup}
                                                        value={storedProcedureRestMethod}
                                                        layout="horizontal"
                                                        onChange={(_, data) =>
                                                            updateAdvancedSettings({
                                                                storedProcedureRestMethods: [
                                                                    data.value as Dab.RestMethod,
                                                                ],
                                                            })
                                                        }>
                                                        {Dab.storedProcedureAllowedRestMethods.map(
                                                            (method) => (
                                                                <Radio
                                                                    key={method}
                                                                    value={method}
                                                                    label={method.toUpperCase()}
                                                                />
                                                            ),
                                                        )}
                                                    </RadioGroup>
                                                </Field>
                                            )}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </section>

                    <section
                        ref={graphQLSectionRef}
                        className={classes.section}
                        hidden={selectedTab !== "graphql"}>
                        {renderSectionTitle(locConstants.schemaDesigner.graphql)}
                        <div className={classes.sectionBody}>
                            {!isGraphQLEnabled ? (
                                renderDisabledBanner(
                                    Dab.ApiType.GraphQL,
                                    locConstants.schemaDesigner.graphql,
                                )
                            ) : (
                                <>
                                    <Checkbox
                                        checked={isEntityGraphQLEnabled}
                                        onChange={(_, data) =>
                                            updateAdvancedSettings({
                                                graphQLEnabled: data.checked === true,
                                            })
                                        }
                                        label={locConstants.schemaDesigner.enableGraphQLForEntity}
                                    />
                                    {isEntityGraphQLEnabled && (
                                        <>
                                            <div className={classes.twoColumnGrid}>
                                                <Field
                                                    label={renderInfoLabel(
                                                        locConstants.schemaDesigner
                                                            .customGraphQLSingularType,
                                                        locConstants.schemaDesigner
                                                            .customGraphQLSingularTypeHelp,
                                                    )}
                                                    required={customGraphQLPluralType.length > 0}
                                                    validationState={
                                                        customGraphQLSingularTypeValidationMessage
                                                            ? "error"
                                                            : undefined
                                                    }
                                                    validationMessage={
                                                        customGraphQLSingularTypeValidationMessage
                                                    }>
                                                    <Input
                                                        value={customGraphQLSingularType}
                                                        placeholder={
                                                            localEntity.sourceName ??
                                                            localEntity.tableName
                                                        }
                                                        onChange={(_, data) =>
                                                            updateAdvancedSettings({
                                                                customGraphQLType: undefined,
                                                                customGraphQLSingularType:
                                                                    data.value || undefined,
                                                            })
                                                        }
                                                    />
                                                </Field>
                                                {!isStoredProcedure && (
                                                    <Field
                                                        label={renderInfoLabel(
                                                            locConstants.schemaDesigner
                                                                .customGraphQLPluralType,
                                                            locConstants.schemaDesigner
                                                                .customGraphQLPluralTypeHelp,
                                                        )}
                                                        validationState={
                                                            customGraphQLPluralTypeValidationMessage
                                                                ? "error"
                                                                : undefined
                                                        }
                                                        validationMessage={
                                                            customGraphQLPluralTypeValidationMessage
                                                        }>
                                                        <Input
                                                            value={customGraphQLPluralType}
                                                            placeholder={`${
                                                                localEntity.sourceName ??
                                                                localEntity.tableName
                                                            }s`}
                                                            onChange={(_, data) =>
                                                                updateAdvancedSettings({
                                                                    customGraphQLPluralType:
                                                                        data.value || undefined,
                                                                })
                                                            }
                                                        />
                                                    </Field>
                                                )}
                                            </div>

                                            {isStoredProcedure && (
                                                <Field
                                                    label={renderInfoLabel(
                                                        locConstants.schemaDesigner
                                                            .storedProcedureGraphQLOperation,
                                                        locConstants.schemaDesigner
                                                            .storedProcedureGraphQLOperationHelp,
                                                    )}
                                                    required>
                                                    <RadioGroup
                                                        value={storedProcedureGraphQLOperation}
                                                        layout="horizontal"
                                                        onChange={(_, data) =>
                                                            updateAdvancedSettings({
                                                                storedProcedureGraphQLOperation:
                                                                    data.value as Dab.GraphQLOperation,
                                                            })
                                                        }>
                                                        <Radio
                                                            value={Dab.GraphQLOperation.Mutation}
                                                            label={
                                                                locConstants.schemaDesigner
                                                                    .graphqlMutation
                                                            }
                                                        />
                                                        <Radio
                                                            value={Dab.GraphQLOperation.Query}
                                                            label={
                                                                locConstants.schemaDesigner
                                                                    .graphqlQuery
                                                            }
                                                        />
                                                    </RadioGroup>
                                                </Field>
                                            )}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </section>

                    <section
                        ref={mcpSectionRef}
                        className={classes.section}
                        hidden={selectedTab !== "mcp"}>
                        {renderSectionTitle(locConstants.schemaDesigner.mcp)}
                        <div className={classes.sectionBody}>
                            {!isMcpEnabled ? (
                                renderDisabledBanner(
                                    Dab.ApiType.Mcp,
                                    locConstants.schemaDesigner.mcp,
                                    locConstants.schemaDesigner.enableMcpForEntityHelp,
                                )
                            ) : (
                                <>
                                    <Checkbox
                                        checked={isEntityMcpEnabled}
                                        onChange={(_, data) =>
                                            updateMcpParentEnabled(data.checked === true)
                                        }
                                        label={
                                            isStoredProcedure
                                                ? locConstants.schemaDesigner.enableMcpForEntity
                                                : renderInfoLabel(
                                                      locConstants.schemaDesigner
                                                          .enableMcpForEntity,
                                                      locConstants.schemaDesigner.mcpDmlToolsHelp,
                                                  )
                                        }
                                    />
                                    {isEntityMcpEnabled && isStoredProcedure && (
                                        <div className={classes.sectionBody}>
                                            <Checkbox
                                                checked={isEntityMcpDmlToolsEnabled}
                                                onChange={(_, data) =>
                                                    updateMcpDmlToolsEnabled(data.checked === true)
                                                }
                                                label={renderInfoLabel(
                                                    locConstants.schemaDesigner.mcpDmlTools,
                                                    locConstants.schemaDesigner
                                                        .mcpStoredProcedureDmlToolsHelp,
                                                )}
                                            />
                                            <Checkbox
                                                checked={isEntityMcpCustomToolEnabled}
                                                onChange={(_, data) =>
                                                    updateMcpCustomToolEnabled(
                                                        data.checked === true,
                                                    )
                                                }
                                                label={renderInfoLabel(
                                                    locConstants.schemaDesigner.mcpCustomTool,
                                                    locConstants.schemaDesigner.mcpCustomToolHelp,
                                                )}
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </section>
                </div>
                <div ref={schemaSectionRef}>
                    {renderColumnsSection()}
                    {renderParametersSection()}
                </div>
            </DrawerBody>
            <DrawerFooter className={classes.drawerFooter}>
                <Button
                    appearance="secondary"
                    className={classes.actionButton}
                    onClick={handleCancel}>
                    {locConstants.common.cancel}
                </Button>
                <Button
                    appearance="primary"
                    className={classes.actionButton}
                    disabled={hasValidationError}
                    onClick={handleApply}>
                    {locConstants.schemaDesigner.applyChanges}
                </Button>
            </DrawerFooter>
        </OverlayDrawer>
    );
}
