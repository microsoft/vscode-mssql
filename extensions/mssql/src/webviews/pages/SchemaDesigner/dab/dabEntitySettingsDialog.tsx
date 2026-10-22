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
    Text,
    Textarea,
    Tooltip,
    tokens,
    useArrowNavigationGroup,
} from "@fluentui/react-components";
import { Dismiss24Regular, Search16Regular, Table16Regular } from "@fluentui/react-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Dab } from "../../../../sharedInterfaces/dab";
import { locConstants } from "../../../common/locConstants";
import { StoredProcedureIcon16Regular } from "../../../common/icons/storedProcedure";
import { ViewIcon16Regular } from "../../../common/icons/view";

const useStyles = makeStyles({
    drawer: {
        width: "960px",
        maxWidth: "calc(100vw - 32px)",
        backgroundColor: "var(--vscode-editor-background)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--vscode-font-family)",
        fontSize: tokens.fontSizeBase300,
        "& input, & textarea, & button": {
            fontFamily: "var(--vscode-font-family)",
        },
        "& .fui-Field__label, & .fui-Checkbox__label, & .fui-Radio__label, & .fui-Button, & .fui-Input__input, & .fui-Textarea__textarea":
            {
                fontSize: "13px",
                lineHeight: "18px",
            },
    },
    drawerHeader: {
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
        padding: "16px 24px",
    },
    drawerBody: {
        flex: 1,
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        backgroundColor: "var(--vscode-editor-background)",
        padding: 0,
        boxSizing: "border-box",
    },
    settingsLayout: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        padding: "0 24px 24px",
        boxSizing: "border-box",
    },
    headerTitleContent: {
        display: "flex",
        flexDirection: "column",
        rowGap: "6px",
    },
    headerObjectRow: {
        display: "flex",
        alignItems: "center",
        columnGap: "6px",
    },
    headerObjectName: {
        fontSize: "13px",
        fontWeight: tokens.fontWeightRegular,
        color: tokens.colorNeutralForeground3,
    },
    headerSubtitle: {
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        color: tokens.colorNeutralForeground1,
        fontWeight: tokens.fontWeightSemibold,
    },
    sourceIcon: {
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
    },
    settingsContent: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        height: "100%",
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        scrollPaddingBottom: "96px",
        paddingTop: "24px",
        paddingBottom: "96px",
        boxSizing: "border-box",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        rowGap: "14px",
        paddingBottom: "28px",
    },
    sectionWithDivider: {
        marginLeft: "-24px",
        marginRight: "-24px",
        paddingLeft: "24px",
        paddingRight: "24px",
        paddingTop: "28px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    sectionHeading: {
        display: "flex",
        alignItems: "center",
        minWidth: 0,
    },
    sectionTitle: {
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    sectionBody: {
        display: "flex",
        flexDirection: "column",
        rowGap: "14px",
    },
    identityFields: {
        display: "flex",
        flexDirection: "column",
        rowGap: "18px",
    },
    identityFieldRow: {
        display: "grid",
        gridTemplateColumns: "180px minmax(0, 1fr)",
        columnGap: "24px",
        alignItems: "start",
        "@media (max-width: 720px)": {
            gridTemplateColumns: "1fr",
            rowGap: "6px",
        },
    },
    identityFieldLabel: {
        display: "flex",
        flexDirection: "column",
        rowGap: "2px",
        paddingTop: "5px",
    },
    identityLabelText: {
        color: tokens.colorNeutralForeground1,
        fontSize: "13px",
        lineHeight: "18px",
        fontWeight: tokens.fontWeightSemibold,
    },
    requiredIndicator: {
        color: tokens.colorPaletteRedForeground1,
    },
    identityControl: {
        minWidth: 0,
    },
    twoColumnGrid: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        columnGap: "16px",
        rowGap: "14px",
        "@media (max-width: 720px)": {
            gridTemplateColumns: "1fr",
        },
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
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
    },
    roleCard: {
        display: "flex",
        flexDirection: "column",
        rowGap: "8px",
        padding: "10px 12px",
        border: `1px solid ${tokens.colorNeutralStroke3}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    permissionRoles: {
        display: "flex",
        flexDirection: "column",
        rowGap: "10px",
    },
    roleToggle: {
        alignItems: "center",
        "& .fui-Checkbox__label": {
            fontWeight: tokens.fontWeightSemibold,
        },
    },
    roleHeader: {
        display: "flex",
        alignItems: "center",
        columnGap: "8px",
    },
    roleDetails: {
        display: "flex",
        flexDirection: "column",
        rowGap: "8px",
        paddingLeft: "28px",
    },
    permissionMainRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        "@media (max-width: 700px)": {
            alignItems: "flex-end",
            flexWrap: "wrap",
        },
    },
    permissionRow: {
        display: "grid",
        gridTemplateColumns: "72px minmax(0, 1fr)",
        alignItems: "center",
        columnGap: "12px",
        minHeight: "28px",
        flex: 1,
        "@media (max-width: 620px)": {
            gridTemplateColumns: "1fr",
            rowGap: "6px",
        },
    },
    permissionRowLabel: {
        color: tokens.colorNeutralForeground1,
        fontSize: "13px",
        lineHeight: "18px",
        fontWeight: tokens.fontWeightSemibold,
    },
    actionRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "8px 16px",
    },
    permissionGrid: {
        display: "flex",
        flexDirection: "column",
        maxHeight: "220px",
        overflowY: "auto",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    permissionCustomization: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    columnFilter: {
        width: "min(320px, 100%)",
    },
    permissionGridHeader: {
        display: "grid",
        gridTemplateColumns: "minmax(140px, 1fr) repeat(4, 72px)",
        position: "sticky",
        top: 0,
        zIndex: 1,
        backgroundColor: tokens.colorNeutralBackground3,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    permissionGridRow: {
        display: "grid",
        gridTemplateColumns: "minmax(140px, 1fr) repeat(4, 72px)",
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        alignItems: "center",
        minHeight: "34px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    permissionGridBody: {
        position: "relative",
        width: "100%",
    },
    permissionGridCell: {
        minWidth: 0,
        padding: "5px 8px",
    },
    permissionGridNameCell: {
        color: tokens.colorNeutralForeground1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    columnCustomizeAction: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
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
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        boxSizing: "border-box",
    },
    metadataGridHeader: {
        display: "grid",
        position: "sticky",
        top: 0,
        zIndex: 1,
        backgroundColor: tokens.colorNeutralBackground3,
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
        backgroundColor: tokens.colorNeutralBackground1,
    },
    columnMetadataGrid: {
        gridTemplateColumns:
            "56px 76px minmax(140px, 1fr) 120px minmax(120px, 1fr) minmax(140px, 1.4fr)",
        columnGap: "8px",
    },
    parameterMetadataGrid: {
        gridTemplateColumns:
            "minmax(160px, 1fr) 120px 88px minmax(120px, 1fr) minmax(160px, 1.4fr)",
        columnGap: "8px",
    },
    metadataGridCell: {
        minWidth: 0,
        padding: "7px 8px",
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
        color: tokens.colorNeutralForeground1,
        whiteSpace: "nowrap",
    },
    tableTypeCell: {
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
        justifyContent: "flex-end",
        columnGap: "12px",
        padding: "12px 24px",
        marginTop: 0,
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderTop: "1px solid var(--vscode-editorGroup-border)",
    },
    actionButton: {
        minWidth: "112px",
        whiteSpace: "nowrap",
    },
    deepLinkFocus: {
        outline: "1px solid var(--vscode-focusBorder)",
        outlineOffset: "2px",
        borderRadius: "3px",
    },
});

type DabSettingsSection = "identity" | "permissions" | "rest" | "graphql" | "mcp" | "schema";
type MetadataGridKind = "columns" | "parameters";

const COLUMN_METADATA_GRID_COLUMN_COUNT = 6;
const PARAMETER_METADATA_GRID_COLUMN_COUNT = 5;
const COLUMN_GRID_OVERSCAN = 20;
const TABLE_PERMISSION_ACTIONS = [
    Dab.EntityAction.Create,
    Dab.EntityAction.Read,
    Dab.EntityAction.Update,
    Dab.EntityAction.Delete,
] as const;

interface DabEntitySettingsDialogProps {
    entity: Dab.DabEntityConfig;
    existingEntityNames: string[];
    isRestEnabled: boolean;
    isGraphQLEnabled: boolean;
    isMcpEnabled: boolean;
    initialSection?: DabSettingsSection;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onApply: (entity: Dab.DabEntityConfig) => void;
    onEnableApiType: (apiType: Dab.ApiType) => void;
}

interface PermissionColumnAccessGridProps {
    classes: ReturnType<typeof useStyles>;
    role: Dab.AuthorizationRole;
    permission: Dab.EntityPermissionConfig;
    actions: Dab.EntityAction[];
    columns: Dab.DabColumnConfig[];
    entity: Dab.DabEntityConfig;
    getPermissionActionFields: (
        permission: Dab.EntityPermissionConfig,
        action: Dab.EntityAction,
    ) => string[];
    onChange: (
        role: Dab.AuthorizationRole,
        column: Dab.DabColumnConfig,
        action: Dab.EntityAction,
        enabled: boolean,
    ) => void;
}

function PermissionColumnAccessGrid({
    classes,
    role,
    permission,
    actions,
    columns,
    entity,
    getPermissionActionFields,
    onChange,
}: PermissionColumnAccessGridProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [columnFilter, setColumnFilter] = useState("");
    const filteredColumns = useMemo(() => {
        const normalizedFilter = columnFilter.trim().toLocaleLowerCase();
        if (!normalizedFilter) {
            return columns;
        }
        return columns.filter((column) =>
            column.name.toLocaleLowerCase().includes(normalizedFilter),
        );
    }, [columnFilter, columns]);
    const virtualizer = useVirtualizer({
        count: filteredColumns.length,
        getScrollElement: () => scrollRef.current,
        getItemKey: (index) => filteredColumns[index]?.id ?? index,
        estimateSize: () => 34,
        overscan: COLUMN_GRID_OVERSCAN,
        useFlushSync: false,
    });

    return (
        <div className={classes.permissionCustomization}>
            <Input
                className={classes.columnFilter}
                size="small"
                value={columnFilter}
                placeholder={locConstants.schemaDesigner.filterColumns}
                aria-label={locConstants.schemaDesigner.filterColumns}
                contentBefore={<Search16Regular />}
                onChange={(_, data) => setColumnFilter(data.value)}
            />
            {filteredColumns.length === 0 ? (
                <Text className={classes.emptyMetadata}>
                    {locConstants.schemaDesigner.noColumnsMatchFilter}
                </Text>
            ) : (
                <div
                    className={classes.permissionGrid}
                    role="grid"
                    ref={scrollRef}
                    aria-rowcount={filteredColumns.length + 1}>
                    <div className={classes.permissionGridHeader} role="row">
                        <div className={classes.permissionGridCell} role="columnheader">
                            {locConstants.schemaDesigner.columnName}
                        </div>
                        {TABLE_PERMISSION_ACTIONS.map((action) => (
                            <div
                                key={action}
                                className={classes.permissionGridCell}
                                role="columnheader">
                                {getActionLabel(action)}
                            </div>
                        ))}
                    </div>
                    <div
                        className={classes.permissionGridBody}
                        style={{ height: `${virtualizer.getTotalSize()}px` }}>
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                            const column = filteredColumns[virtualRow.index];
                            const isLogicalKey = Dab.isLogicalKeyColumn(entity, column);
                            return (
                                <div
                                    className={classes.permissionGridRow}
                                    role="row"
                                    key={column.id}
                                    style={{
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}>
                                    <div
                                        className={`${classes.permissionGridCell} ${classes.permissionGridNameCell}`}
                                        role="gridcell"
                                        title={column.name}>
                                        {column.name}
                                    </div>
                                    {TABLE_PERMISSION_ACTIONS.map((action) => {
                                        const actionEnabled = actions.includes(action);
                                        const checked =
                                            actionEnabled &&
                                            (isLogicalKey ||
                                                getPermissionActionFields(permission, action).some(
                                                    (field) =>
                                                        Dab.normalizeDabIdentifier(field) ===
                                                        Dab.normalizeDabIdentifier(column.name),
                                                ));
                                        return (
                                            <div
                                                key={action}
                                                className={classes.permissionGridCell}
                                                role="gridcell">
                                                <Checkbox
                                                    checked={checked}
                                                    disabled={!actionEnabled || isLogicalKey}
                                                    onChange={(_, data) =>
                                                        onChange(
                                                            role,
                                                            column,
                                                            action,
                                                            data.checked === true,
                                                        )
                                                    }
                                                    aria-label={`${role} ${action} ${column.name}`}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
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
                fieldAccess: permission.fieldAccess?.map((access) => ({
                    action: access.action,
                    fields: [...access.fields],
                })),
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
    initialSection,
    open,
    onOpenChange,
    onApply,
    onEnableApiType,
}: DabEntitySettingsDialogProps) {
    const classes = useStyles();
    const metadataKeyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });
    const [localEntity, setLocalEntity] = useState<Dab.DabEntityConfig>(() =>
        cloneEntityForEditing(entity),
    );
    const [columnFilter, setColumnFilter] = useState("");
    const [expandedColumnAccessRoles, setExpandedColumnAccessRoles] = useState<
        Set<Dab.AuthorizationRole>
    >(new Set());
    const drawerBodyRef = useRef<HTMLDivElement | null>(null);
    const metadataScrollRef = useRef<HTMLDivElement | null>(null);
    const identitySectionRef = useRef<HTMLElement | null>(null);
    const permissionsSectionRef = useRef<HTMLElement | null>(null);
    const restSectionRef = useRef<HTMLElement | null>(null);
    const graphQLSectionRef = useRef<HTMLElement | null>(null);
    const mcpSectionRef = useRef<HTMLElement | null>(null);
    const schemaSectionRef = useRef<HTMLDivElement | null>(null);
    const deepLinkFocusRef = useRef<HTMLElement | null>(null);

    const getSectionElement = (value: DabSettingsSection): HTMLElement | null => {
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

    const focusSectionControl = (value: DabSettingsSection) => {
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

    const scrollToSection = (value: DabSettingsSection, behavior: ScrollBehavior = "smooth") => {
        window.setTimeout(() => {
            const drawerBody = drawerBodyRef.current;
            const section = getSectionElement(value);
            if (!drawerBody || !section) {
                return;
            }

            drawerBody.scrollTo({
                top: Math.max(0, section.offsetTop - 12),
                behavior,
            });

            window.setTimeout(() => focusSectionControl(value), behavior === "auto" ? 0 : 180);
        }, 0);
    };

    useEffect(() => {
        if (open) {
            const editingEntity = cloneEntityForEditing(entity);
            setLocalEntity(editingEntity);
            setColumnFilter("");
            setExpandedColumnAccessRoles(
                new Set(
                    Dab.getEntityPermissions(editingEntity)
                        .filter((permission) => permission.fieldAccess?.length)
                        .map((permission) => permission.role),
                ),
            );
            scrollToSection(initialSection ?? "identity", "auto");
        }
    }, [entity, initialSection, open]);

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
    const filteredColumns = useMemo(() => {
        const normalizedFilter = columnFilter.trim().toLocaleLowerCase();
        if (!normalizedFilter) {
            return localEntity.columns;
        }
        return localEntity.columns.filter((column) =>
            column.name.toLocaleLowerCase().includes(normalizedFilter),
        );
    }, [columnFilter, localEntity.columns]);
    const columnVirtualizer = useVirtualizer({
        count: filteredColumns.length,
        getScrollElement: () => metadataScrollRef.current,
        getItemKey: (index) => filteredColumns[index]?.id ?? index,
        estimateSize: () => 41,
        overscan: COLUMN_GRID_OVERSCAN,
        useFlushSync: false,
    });
    const parameterVirtualizer = useVirtualizer({
        count: parameters.length,
        getScrollElement: () => metadataScrollRef.current,
        estimateSize: () => 41,
        overscan: 8,
    });
    const isLocallyExposed = Dab.isEntityExposed(localEntity);

    const getMetadataCellProps = (
        kind: MetadataGridKind,
        rowIndex: number,
        columnIndex: number,
    ) => {
        const containsInteractiveControl =
            kind === "columns" ? columnIndex <= 1 || columnIndex >= 4 : columnIndex >= 2;
        return {
            role: "gridcell",
            tabIndex: containsInteractiveControl ? undefined : 0,
            "data-dab-row-index": rowIndex,
            "aria-colindex": columnIndex + 1,
        };
    };

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
                        fieldAccess: permission.fieldAccess?.map((access) => ({
                            action: access.action,
                            fields: [...access.fields],
                        })),
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
                      fieldAccess: enabled ? permission.fieldAccess : undefined,
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
            return {
                ...permission,
                actions,
                fieldAccess: enabled
                    ? permission.fieldAccess
                    : permission.fieldAccess?.filter((access) => access.action !== action),
            };
        });
        updatePermissions(updatedPermissions);
    };

    const getPermissionActionFields = (
        permission: Dab.EntityPermissionConfig,
        action: Dab.EntityAction,
    ): string[] => {
        const explicitFields = permission.fieldAccess?.find(
            (access) => access.action === action,
        )?.fields;
        return explicitFields ?? localEntity.columns.map((column) => column.name);
    };

    const updateRoleColumnAction = (
        role: Dab.AuthorizationRole,
        column: Dab.DabColumnConfig,
        action: Dab.EntityAction,
        enabled: boolean,
    ) => {
        setLocalEntity((prev) => {
            const updatedPermissions = Dab.getEntityPermissions(prev).map((permission) => {
                if (permission.role !== role) {
                    return permission;
                }

                const allColumnNames = prev.columns.map((c) => c.name);
                const currentFields =
                    permission.fieldAccess?.find((access) => access.action === action)?.fields ??
                    allColumnNames;
                const nextFields = enabled
                    ? [...new Set([...currentFields, column.name])]
                    : currentFields.filter(
                          (field) =>
                              Dab.normalizeDabIdentifier(field) !==
                              Dab.normalizeDabIdentifier(column.name),
                      );
                const existingFieldAccess =
                    permission.fieldAccess?.filter((access) => access.action !== action) ?? [];
                const fieldAccess =
                    nextFields.length === allColumnNames.length
                        ? existingFieldAccess
                        : [...existingFieldAccess, { action, fields: nextFields }];

                return {
                    ...permission,
                    fieldAccess: fieldAccess.length > 0 ? fieldAccess : undefined,
                };
            });

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
                        fieldAccess: permission.fieldAccess?.map((access) => ({
                            action: access.action,
                            fields: [...access.fields],
                        })),
                    })),
                },
            };
        });
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

    const updateColumnExposure = (columnId: string, isExposed: boolean) => {
        setLocalEntity((prev) => ({
            ...prev,
            columns: prev.columns.map((column) =>
                column.id === columnId
                    ? {
                          ...column,
                          isExposed: Dab.isLogicalKeyColumn(prev, column) || isExposed,
                      }
                    : column,
            ),
        }));
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
        <div className={classes.sectionHeading}>
            <Text className={classes.sectionTitle}>{title}</Text>
        </div>
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
        const roleDescription =
            role === Dab.AuthorizationRole.Anonymous
                ? locConstants.schemaDesigner.anonymousDescription
                : locConstants.schemaDesigner.authenticatedDescription;
        const allowedActions = getAllowedActions(localEntity.sourceType);
        const showColumnAccess =
            enabled && !isStoredProcedure && localEntity.columns.length > 0 && permission;
        const isColumnAccessExpanded = expandedColumnAccessRoles.has(role);
        const toggleColumnAccess = () =>
            setExpandedColumnAccessRoles((prev) => {
                const next = new Set(prev);
                if (next.has(role)) {
                    next.delete(role);
                } else {
                    next.add(role);
                }
                return next;
            });

        return (
            <div className={classes.roleCard} key={role}>
                <div className={classes.roleHeader}>
                    <Checkbox
                        className={classes.roleToggle}
                        checked={enabled}
                        label={renderInfoLabel(roleLabel, roleDescription)}
                        onChange={(_, data) => updateRoleEnabled(role, data.checked === true)}
                    />
                </div>
                {enabled && (
                    <div className={classes.roleDetails}>
                        <div className={classes.permissionMainRow}>
                            <div className={classes.permissionRow}>
                                <Text className={classes.permissionRowLabel}>
                                    {locConstants.schemaDesigner.allowedActions}
                                </Text>
                                <div className={classes.actionRow}>
                                    {allowedActions.map((action) => (
                                        <Checkbox
                                            key={action}
                                            checked={actions.includes(action)}
                                            label={getActionLabel(action)}
                                            onChange={(_, data) =>
                                                updateRoleAction(
                                                    role,
                                                    action,
                                                    data.checked === true,
                                                )
                                            }
                                        />
                                    ))}
                                </div>
                            </div>
                            {showColumnAccess && !isColumnAccessExpanded && (
                                <Button
                                    appearance="outline"
                                    size="small"
                                    onClick={toggleColumnAccess}>
                                    {locConstants.schemaDesigner.customizeColumns}
                                </Button>
                            )}
                        </div>
                        {showColumnAccess && isColumnAccessExpanded && (
                            <>
                                <PermissionColumnAccessGrid
                                    classes={classes}
                                    role={role}
                                    permission={permission}
                                    actions={actions}
                                    columns={localEntity.columns}
                                    entity={localEntity}
                                    getPermissionActionFields={getPermissionActionFields}
                                    onChange={updateRoleColumnAction}
                                />
                                <div className={classes.columnCustomizeAction}>
                                    <Button
                                        appearance="outline"
                                        size="small"
                                        onClick={toggleColumnAccess}>
                                        {locConstants.schemaDesigner.done}
                                    </Button>
                                </div>
                            </>
                        )}
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
            <section className={`${classes.section} ${classes.sectionWithDivider}`}>
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
                    <>
                        <Input
                            className={classes.columnFilter}
                            size="small"
                            value={columnFilter}
                            placeholder={locConstants.schemaDesigner.filterColumns}
                            aria-label={locConstants.schemaDesigner.filterColumns}
                            contentBefore={<Search16Regular />}
                            onChange={(_, data) => setColumnFilter(data.value)}
                        />
                        {filteredColumns.length === 0 ? (
                            <Text className={classes.emptyMetadata}>
                                {locConstants.schemaDesigner.noColumnsMatchFilter}
                            </Text>
                        ) : (
                            <div
                                {...metadataKeyboardNavAttr}
                                className={classes.metadataViewport}
                                ref={metadataScrollRef}
                                role="grid"
                                aria-rowcount={filteredColumns.length + 1}
                                aria-colcount={COLUMN_METADATA_GRID_COLUMN_COUNT}>
                                <div
                                    role="row"
                                    aria-rowindex={1}
                                    className={`${classes.metadataGridHeader} ${classes.columnMetadataGrid}`}>
                                    <div
                                        role="columnheader"
                                        aria-colindex={1}
                                        className={classes.metadataGridCell}>
                                        {locConstants.schemaDesigner.key}
                                    </div>
                                    <div
                                        role="columnheader"
                                        aria-colindex={2}
                                        className={classes.metadataGridCell}>
                                        {locConstants.schemaDesigner.exposed}
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
                                        const column = filteredColumns[virtualRow.index];
                                        const field = Dab.getFieldForColumn(
                                            localEntity,
                                            column.name,
                                        );
                                        const isLogicalKey = Dab.isLogicalKeyColumn(
                                            localEntity,
                                            column,
                                        );
                                        const logicalKeyExposureLockedText =
                                            locConstants.schemaDesigner.logicalKeyColumnExposureLocked(
                                                column.name,
                                            );
                                        const exposureCheckbox = (
                                            <Checkbox
                                                checked={isLogicalKey || column.isExposed}
                                                disabled={isLogicalKey}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter" && !isLogicalKey) {
                                                        event.preventDefault();
                                                        updateColumnExposure(
                                                            column.id,
                                                            !column.isExposed,
                                                        );
                                                    }
                                                }}
                                                onChange={(_, data) =>
                                                    updateColumnExposure(
                                                        column.id,
                                                        data.checked === true,
                                                    )
                                                }
                                                aria-label={locConstants.schemaDesigner.exposeColumn(
                                                    column.name,
                                                )}
                                            />
                                        );
                                        const exposureCell = (
                                            <div
                                                {...getMetadataCellProps(
                                                    "columns",
                                                    virtualRow.index,
                                                    1,
                                                )}
                                                tabIndex={isLogicalKey ? 0 : undefined}
                                                aria-label={
                                                    isLogicalKey
                                                        ? logicalKeyExposureLockedText
                                                        : undefined
                                                }
                                                className={classes.metadataGridCell}>
                                                {exposureCheckbox}
                                            </div>
                                        );
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
                                                        checked={isLogicalKey}
                                                        onKeyDown={(event) => {
                                                            if (event.key === "Enter") {
                                                                event.preventDefault();
                                                                updateField(column, {
                                                                    isPrimaryKey: !isLogicalKey,
                                                                });
                                                            }
                                                        }}
                                                        onChange={(_, data) =>
                                                            updateField(column, {
                                                                isPrimaryKey: data.checked === true,
                                                            })
                                                        }
                                                        aria-label={
                                                            locConstants.schemaDesigner.logicalKey
                                                        }
                                                    />
                                                </div>
                                                {isLogicalKey ? (
                                                    <Tooltip
                                                        content={logicalKeyExposureLockedText}
                                                        relationship="description">
                                                        {exposureCell}
                                                    </Tooltip>
                                                ) : (
                                                    exposureCell
                                                )}
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
                                                                description:
                                                                    data.value || undefined,
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
                    </>
                )}
            </section>
        );
    };

    const renderParametersSection = () => {
        if (!isStoredProcedure) {
            return undefined;
        }

        return (
            <section className={`${classes.section} ${classes.sectionWithDivider}`}>
                {renderSectionTitle(locConstants.schemaDesigner.parameters)}
                {parameters.length === 0 ? (
                    <Text className={classes.emptyMetadata}>
                        {locConstants.schemaDesigner.noParametersDiscovered}
                    </Text>
                ) : (
                    <div
                        {...metadataKeyboardNavAttr}
                        className={classes.metadataViewport}
                        ref={metadataScrollRef}
                        role="grid"
                        aria-rowcount={parameters.length + 1}
                        aria-colcount={PARAMETER_METADATA_GRID_COLUMN_COUNT}>
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
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter") {
                                                        event.preventDefault();
                                                        updateParameter(parameter.name, {
                                                            isRequired:
                                                                parameter.isRequired === false,
                                                        });
                                                    }
                                                }}
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
            fieldAccess: permission.fieldAccess?.map((access) => ({
                action: access.action,
                fields: [...access.fields],
            })),
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
                        <span className={classes.headerSubtitle}>
                            {locConstants.schemaDesigner.advancedEntityConfiguration}
                        </span>
                        <div className={classes.headerObjectRow}>
                            {renderSourceIcon()}
                            <span className={classes.headerObjectName}>{sourceObjectName}</span>
                        </div>
                    </div>
                </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody className={classes.drawerBody}>
                <div className={classes.settingsLayout}>
                    <div className={classes.settingsContent} ref={drawerBodyRef}>
                        <section ref={identitySectionRef} className={classes.section}>
                            {renderSectionTitle(locConstants.schemaDesigner.identity)}
                            <div className={classes.identityFields}>
                                <div className={classes.identityFieldRow}>
                                    <div className={classes.identityFieldLabel}>
                                        <Text className={classes.identityLabelText}>
                                            {locConstants.schemaDesigner.entityName}
                                            <span
                                                className={classes.requiredIndicator}
                                                aria-hidden="true">
                                                {" *"}
                                            </span>
                                        </Text>
                                    </div>
                                    <Field
                                        className={classes.identityControl}
                                        validationState={
                                            entityNameValidationMessage ? "error" : undefined
                                        }
                                        validationMessage={entityNameValidationMessage}>
                                        <Input
                                            required
                                            aria-label={locConstants.schemaDesigner.entityName}
                                            value={settings.entityName}
                                            onChange={(_, data) =>
                                                updateAdvancedSettings({ entityName: data.value })
                                            }
                                        />
                                    </Field>
                                </div>
                                <div className={classes.identityFieldRow}>
                                    <div className={classes.identityFieldLabel}>
                                        <Text className={classes.identityLabelText}>
                                            {locConstants.schemaDesigner.description}
                                        </Text>
                                    </div>
                                    <Field className={classes.identityControl}>
                                        <Textarea
                                            aria-label={locConstants.schemaDesigner.description}
                                            placeholder={locConstants.schemaDesigner.optional}
                                            resize="vertical"
                                            value={settings.description ?? ""}
                                            onChange={(_, data) =>
                                                updateAdvancedSettings({
                                                    description: data.value || undefined,
                                                })
                                            }
                                        />
                                    </Field>
                                </div>
                            </div>
                        </section>

                        <section
                            ref={permissionsSectionRef}
                            className={`${classes.section} ${classes.sectionWithDivider}`}>
                            {renderSectionTitle(locConstants.schemaDesigner.authorizationRole)}
                            <div className={classes.permissionRoles}>
                                {renderPermissionRole(Dab.AuthorizationRole.Anonymous)}
                                {renderPermissionRole(Dab.AuthorizationRole.Authenticated)}
                            </div>
                        </section>

                        <section
                            ref={restSectionRef}
                            className={`${classes.section} ${classes.sectionWithDivider}`}>
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
                                                        locConstants.schemaDesigner
                                                            .customRestPathHelp,
                                                    )}
                                                    validationState={
                                                        customRestPathValidationMessage
                                                            ? "error"
                                                            : undefined
                                                    }
                                                    validationMessage={
                                                        customRestPathValidationMessage
                                                    }>
                                                    <Input
                                                        value={settings.customRestPath ?? ""}
                                                        placeholder={(
                                                            localEntity.sourceName ??
                                                            localEntity.tableName
                                                        ).toLowerCase()}
                                                        onChange={(_, data) =>
                                                            updateAdvancedSettings({
                                                                customRestPath:
                                                                    data.value || undefined,
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
                            className={`${classes.section} ${classes.sectionWithDivider}`}>
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
                                            label={
                                                locConstants.schemaDesigner.enableGraphQLForEntity
                                            }
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
                                                        required={
                                                            customGraphQLPluralType.length > 0
                                                        }
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
                                                                value={
                                                                    Dab.GraphQLOperation.Mutation
                                                                }
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
                            className={`${classes.section} ${classes.sectionWithDivider}`}>
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
                                            label={locConstants.schemaDesigner.enableMcpForEntity}
                                        />
                                        {isEntityMcpEnabled && isStoredProcedure && (
                                            <div className={classes.sectionBody}>
                                                <Checkbox
                                                    checked={isEntityMcpDmlToolsEnabled}
                                                    onChange={(_, data) =>
                                                        updateMcpDmlToolsEnabled(
                                                            data.checked === true,
                                                        )
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
                                                        locConstants.schemaDesigner
                                                            .mcpCustomToolHelp,
                                                    )}
                                                />
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </section>
                        <div ref={schemaSectionRef}>
                            {renderColumnsSection()}
                            {renderParametersSection()}
                        </div>
                    </div>
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
