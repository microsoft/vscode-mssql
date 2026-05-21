/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Drawer,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Field,
    Input,
    makeStyles,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    mergeClasses,
    Radio,
    RadioGroup,
    Text,
    ToggleButton,
    tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular, Table16Regular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { Dab } from "../../../../sharedInterfaces/dab";
import { StoredProcedureIcon16Regular } from "../../../common/icons/storedProcedure";
import { ViewIcon16Regular } from "../../../common/icons/view";

const useStyles = makeStyles({
    drawerHeader: {
        backgroundColor: tokens.colorNeutralBackground2,
        "::after": {
            display: "none",
        },
    },
    drawerBody: {
        display: "flex",
        flexDirection: "column",
        rowGap: "20px",
        paddingTop: "16px",
        paddingBottom: "16px",
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
    section: {
        display: "flex",
        flexDirection: "column",
        rowGap: "12px",
        paddingBottom: "16px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    lastSection: {
        borderBottom: "none",
        paddingBottom: 0,
    },
    sectionTitle: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    sectionDisabled: {
        opacity: 0.75,
    },
    sectionHeader: {
        display: "flex",
        alignItems: "center",
        columnGap: "8px",
    },
    disabledBadge: {
        borderRadius: tokens.borderRadiusCircular,
        border: `1px solid ${tokens.colorPaletteYellowBorder2}`,
        backgroundColor: "transparent",
        color: tokens.colorNeutralForeground3,
        fontSize: "10px",
        padding: "1px 7px",
    },
    sectionBody: {
        display: "flex",
        flexDirection: "column",
        rowGap: "10px",
        paddingLeft: "20px",
    },
    disabledMessageBar: {
        border: `1px solid ${tokens.colorPaletteYellowBorder2}`,
        backgroundColor: "transparent",
    },
    disabledMessageBarIcon: {
        color: tokens.colorPaletteYellowForeground2,
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
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
        marginTop: "2px",
    },
    roleButtonsContainer: {
        display: "flex",
        gap: "8px",
    },
    roleButton: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "12px",
        minHeight: "60px",
        whiteSpace: "normal",
    },
    roleButtonLabel: {
        fontWeight: 600,
        lineHeight: "18px",
    },
    roleButtonLabelSelected: {
        color: tokens.colorNeutralForegroundOnBrand,
    },
    roleButtonLabelUnselected: {
        color: tokens.colorNeutralForeground1,
    },
    roleButtonContent: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        textAlign: "center",
    },
    roleButtonDescription: {
        fontSize: "11px",
        lineHeight: "14px",
    },
    roleButtonDescriptionSelected: {
        color: tokens.colorNeutralForegroundOnBrand,
    },
    roleButtonDescriptionUnselected: {
        color: tokens.colorNeutralForeground2,
    },
    sourceText: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
    drawerFooter: {
        backgroundColor: tokens.colorNeutralBackground2,
        columnGap: "12px",
        "::before": {
            display: "none",
        },
    },
    actionButton: {
        minWidth: "132px",
        whiteSpace: "nowrap",
    },
    checkboxGroup: {
        display: "flex",
        flexDirection: "column",
        rowGap: "4px",
    },
    methodGroup: {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
    },
    methodChip: {
        borderRadius: "999px",
        fontSize: "12px",
        minWidth: "unset",
    },
    methodChipSelected: {
        border: "1px solid var(--vscode-textLink-foreground)",
        color: "var(--vscode-textLink-foreground)",
        backgroundColor: "color-mix(in srgb, var(--vscode-textLink-foreground) 20%, transparent)",
    },
});

interface DabEntitySettingsDialogProps {
    entity: Dab.DabEntityConfig;
    isRestEnabled: boolean;
    isGraphQLEnabled: boolean;
    isMcpEnabled: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onApply: (settings: Dab.EntityAdvancedSettings) => void;
    onEnableApiType: (apiType: Dab.ApiType) => void;
}

export function DabEntitySettingsDialog({
    entity,
    isRestEnabled,
    isGraphQLEnabled,
    isMcpEnabled,
    open,
    onOpenChange,
    onApply,
    onEnableApiType,
}: DabEntitySettingsDialogProps) {
    const classes = useStyles();

    // Local state for form - initialized when dialog opens
    const [localSettings, setLocalSettings] = useState<Dab.EntityAdvancedSettings>(
        entity.advancedSettings,
    );

    // Reset local state when dialog opens
    useEffect(() => {
        if (open) {
            setLocalSettings(entity.advancedSettings);
        }
    }, [open, entity.advancedSettings]);

    const handleApply = () => {
        onApply(localSettings);
    };

    const handleCancel = () => {
        onOpenChange(false);
    };

    const updateEntityName = (value: string) => {
        setLocalSettings((prev) => ({ ...prev, entityName: value }));
    };

    const updateAuthorizationRole = (role: Dab.AuthorizationRole) => {
        setLocalSettings((prev) => ({ ...prev, authorizationRole: role }));
    };

    const updateCustomRestPath = (value: string) => {
        setLocalSettings((prev) => ({ ...prev, customRestPath: value || undefined }));
    };

    const updateRestEnabled = (value: boolean) => {
        setLocalSettings((prev) => ({ ...prev, restEnabled: value }));
    };

    const updateCustomGraphQLType = (value: string) => {
        setLocalSettings((prev) => ({ ...prev, customGraphQLType: value || undefined }));
    };

    const updateGraphQLEnabled = (value: boolean) => {
        setLocalSettings((prev) => ({ ...prev, graphQLEnabled: value }));
    };

    const updateStoredProcedureRestMethod = (method: Dab.RestMethod, isEnabled: boolean) => {
        setLocalSettings((prev) => {
            const methods = prev.storedProcedureRestMethods ?? [Dab.RestMethod.Post];
            const nextMethods = isEnabled
                ? [...methods, method]
                : methods.filter((existingMethod) => existingMethod !== method);
            return {
                ...prev,
                storedProcedureRestMethods: nextMethods.length
                    ? Array.from(new Set(nextMethods))
                    : [Dab.RestMethod.Post],
            };
        });
    };

    const updateStoredProcedureGraphQLOperation = (operation: Dab.GraphQLOperation) => {
        setLocalSettings((prev) => ({ ...prev, storedProcedureGraphQLOperation: operation }));
    };

    const updateExposeAsMcpCustomTool = (value: boolean) => {
        setLocalSettings((prev) => ({ ...prev, exposeAsMcpCustomTool: value }));
    };

    const isStoredProcedure = entity.sourceType === Dab.EntitySourceType.StoredProcedure;
    const isAnonymousSelected = localSettings.authorizationRole === Dab.AuthorizationRole.Anonymous;
    const isAuthenticatedSelected =
        localSettings.authorizationRole === Dab.AuthorizationRole.Authenticated;
    const isEntityRestEnabled = localSettings.restEnabled !== false;
    const isEntityGraphQLEnabled = localSettings.graphQLEnabled !== false;
    const storedProcedureRestMethods = localSettings.storedProcedureRestMethods ?? [
        Dab.RestMethod.Post,
    ];
    const storedProcedureGraphQLOperation =
        localSettings.storedProcedureGraphQLOperation ?? Dab.GraphQLOperation.Mutation;
    const exposeAsMcpCustomTool = localSettings.exposeAsMcpCustomTool !== false;
    const sourceObjectName = `${entity.schemaName}.${entity.sourceName ?? entity.tableName}`;

    const renderSourceIcon = () => {
        switch (entity.sourceType ?? Dab.EntitySourceType.Table) {
            case Dab.EntitySourceType.View:
                return <ViewIcon16Regular className={classes.sourceIcon} />;
            case Dab.EntitySourceType.StoredProcedure:
                return <StoredProcedureIcon16Regular className={classes.sourceIcon} />;
            case Dab.EntitySourceType.Table:
            default:
                return <Table16Regular className={classes.sourceIcon} />;
        }
    };

    const renderSectionHeader = (title: string, disabled?: boolean) => (
        <div className={classes.sectionHeader}>
            <Text className={classes.sectionTitle}>{title}</Text>
            {disabled && (
                <span className={classes.disabledBadge}>
                    {locConstants.schemaDesigner.disabledGlobally}
                </span>
            )}
        </div>
    );

    const renderDisabledBanner = (apiType: Dab.ApiType, label: string) => (
        <MessageBar
            intent="warning"
            layout="multiline"
            shape="rounded"
            className={classes.disabledMessageBar}
            icon={{ className: classes.disabledMessageBarIcon }}>
            <MessageBarBody>
                <MessageBarTitle className={classes.disabledMessageBarTitle}>
                    {locConstants.schemaDesigner.apiTypeNotEnabledGlobally(label)}
                </MessageBarTitle>
                <span className={classes.disabledMessageBarText}>
                    {locConstants.schemaDesigner.enableApiTypeForEntity(label)}
                </span>
            </MessageBarBody>
            <MessageBarActions>
                <Button appearance="outline" size="small" onClick={() => onEnableApiType(apiType)}>
                    {locConstants.schemaDesigner.enableApiTypeGlobally(label)}
                </Button>
            </MessageBarActions>
        </MessageBar>
    );

    return (
        <Drawer
            separator
            open={open}
            onOpenChange={(_, data) => onOpenChange(data.open)}
            position="end"
            size="medium">
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
            <DrawerBody className={classes.drawerBody}>
                <section className={classes.section}>
                    {renderSectionHeader(locConstants.schemaDesigner.identity)}
                    <div className={classes.sectionBody}>
                        <Field label={locConstants.schemaDesigner.entityName}>
                            <Input
                                value={localSettings.entityName}
                                onChange={(_, data) => updateEntityName(data.value)}
                            />
                            <Text className={classes.fieldHint}>
                                {locConstants.schemaDesigner.entityNameHelp}
                            </Text>
                        </Field>
                    </div>
                </section>

                <section className={classes.section}>
                    {renderSectionHeader(locConstants.schemaDesigner.authorizationRole)}
                    <div className={classes.sectionBody}>
                        <Text className={classes.fieldHint}>
                            {locConstants.schemaDesigner.authorizationRoleHelp}
                        </Text>
                        <div className={classes.roleButtonsContainer}>
                            <ToggleButton
                                className={classes.roleButton}
                                appearance={isAnonymousSelected ? "primary" : "outline"}
                                checked={isAnonymousSelected}
                                onClick={() =>
                                    updateAuthorizationRole(Dab.AuthorizationRole.Anonymous)
                                }>
                                <div className={classes.roleButtonContent}>
                                    <span
                                        className={mergeClasses(
                                            classes.roleButtonLabel,
                                            isAnonymousSelected
                                                ? classes.roleButtonLabelSelected
                                                : classes.roleButtonLabelUnselected,
                                        )}>
                                        {locConstants.schemaDesigner.anonymous}
                                    </span>
                                    <span
                                        className={mergeClasses(
                                            classes.roleButtonDescription,
                                            isAnonymousSelected
                                                ? classes.roleButtonDescriptionSelected
                                                : classes.roleButtonDescriptionUnselected,
                                        )}>
                                        {locConstants.schemaDesigner.anonymousDescription}
                                    </span>
                                </div>
                            </ToggleButton>
                            <ToggleButton
                                className={classes.roleButton}
                                appearance={isAuthenticatedSelected ? "primary" : "outline"}
                                checked={isAuthenticatedSelected}
                                onClick={() =>
                                    updateAuthorizationRole(Dab.AuthorizationRole.Authenticated)
                                }>
                                <div className={classes.roleButtonContent}>
                                    <span
                                        className={mergeClasses(
                                            classes.roleButtonLabel,
                                            isAuthenticatedSelected
                                                ? classes.roleButtonLabelSelected
                                                : classes.roleButtonLabelUnselected,
                                        )}>
                                        {locConstants.schemaDesigner.authenticated}
                                    </span>
                                    <span
                                        className={mergeClasses(
                                            classes.roleButtonDescription,
                                            isAuthenticatedSelected
                                                ? classes.roleButtonDescriptionSelected
                                                : classes.roleButtonDescriptionUnselected,
                                        )}>
                                        {locConstants.schemaDesigner.authenticatedDescription}
                                    </span>
                                </div>
                            </ToggleButton>
                        </div>
                    </div>
                </section>

                <section
                    className={mergeClasses(
                        classes.section,
                        !isRestEnabled && classes.sectionDisabled,
                    )}>
                    {renderSectionHeader(locConstants.schemaDesigner.rest, !isRestEnabled)}
                    <div className={classes.sectionBody}>
                        {!isRestEnabled ? (
                            renderDisabledBanner(Dab.ApiType.Rest, locConstants.schemaDesigner.rest)
                        ) : (
                            <>
                                <Checkbox
                                    checked={isEntityRestEnabled}
                                    onChange={(_, data) => updateRestEnabled(!!data.checked)}
                                    label={locConstants.schemaDesigner.enableRestForEntity}
                                />
                                {isEntityRestEnabled && (
                                    <>
                                        <Field label={locConstants.schemaDesigner.customRestPath}>
                                            <Input
                                                value={localSettings.customRestPath ?? ""}
                                                placeholder={(
                                                    entity.sourceName ?? entity.tableName
                                                ).toLowerCase()}
                                                onChange={(_, data) =>
                                                    updateCustomRestPath(data.value)
                                                }
                                            />
                                            <Text className={classes.fieldHint}>
                                                {locConstants.schemaDesigner.customRestPathHelp}
                                            </Text>
                                        </Field>

                                        {isStoredProcedure && (
                                            <Field
                                                label={
                                                    locConstants.schemaDesigner
                                                        .storedProcedureRestMethods
                                                }>
                                                <div className={classes.methodGroup}>
                                                    {Object.values(Dab.RestMethod).map((method) => (
                                                        <ToggleButton
                                                            key={method}
                                                            shape="circular"
                                                            size="small"
                                                            className={mergeClasses(
                                                                classes.methodChip,
                                                                storedProcedureRestMethods.includes(
                                                                    method,
                                                                ) && classes.methodChipSelected,
                                                            )}
                                                            checked={storedProcedureRestMethods.includes(
                                                                method,
                                                            )}
                                                            onClick={() =>
                                                                updateStoredProcedureRestMethod(
                                                                    method,
                                                                    !storedProcedureRestMethods.includes(
                                                                        method,
                                                                    ),
                                                                )
                                                            }
                                                            aria-label={method.toUpperCase()}>
                                                            {method.toUpperCase()}
                                                        </ToggleButton>
                                                    ))}
                                                </div>
                                                <Text className={classes.fieldHint}>
                                                    {
                                                        locConstants.schemaDesigner
                                                            .storedProcedureRestMethodsHelp
                                                    }
                                                </Text>
                                            </Field>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </section>

                <section
                    className={mergeClasses(
                        classes.section,
                        !isGraphQLEnabled && classes.sectionDisabled,
                    )}>
                    {renderSectionHeader(locConstants.schemaDesigner.graphQL, !isGraphQLEnabled)}
                    <div className={classes.sectionBody}>
                        {!isGraphQLEnabled ? (
                            renderDisabledBanner(
                                Dab.ApiType.GraphQL,
                                locConstants.schemaDesigner.graphQL,
                            )
                        ) : (
                            <>
                                <Checkbox
                                    checked={isEntityGraphQLEnabled}
                                    onChange={(_, data) => updateGraphQLEnabled(!!data.checked)}
                                    label={locConstants.schemaDesigner.enableGraphQLForEntity}
                                />
                                {isEntityGraphQLEnabled && (
                                    <>
                                        <Field
                                            label={locConstants.schemaDesigner.customGraphQLType}>
                                            <Input
                                                value={localSettings.customGraphQLType ?? ""}
                                                placeholder={entity.sourceName ?? entity.tableName}
                                                onChange={(_, data) =>
                                                    updateCustomGraphQLType(data.value)
                                                }
                                            />
                                            <Text className={classes.fieldHint}>
                                                {locConstants.schemaDesigner.customGraphQLTypeHelp}
                                            </Text>
                                        </Field>

                                        {isStoredProcedure && (
                                            <Field
                                                label={
                                                    locConstants.schemaDesigner
                                                        .storedProcedureGraphQLOperation
                                                }>
                                                <RadioGroup
                                                    value={storedProcedureGraphQLOperation}
                                                    layout="horizontal"
                                                    onChange={(_, data) =>
                                                        updateStoredProcedureGraphQLOperation(
                                                            data.value as Dab.GraphQLOperation,
                                                        )
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
                                                            locConstants.schemaDesigner.graphqlQuery
                                                        }
                                                    />
                                                </RadioGroup>
                                                <Text className={classes.fieldHint}>
                                                    {
                                                        locConstants.schemaDesigner
                                                            .storedProcedureGraphQLOperationHelp
                                                    }
                                                </Text>
                                            </Field>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </section>

                {isStoredProcedure && (
                    <section
                        className={mergeClasses(
                            classes.section,
                            classes.lastSection,
                            !isMcpEnabled && classes.sectionDisabled,
                        )}>
                        {renderSectionHeader(locConstants.schemaDesigner.mcp, !isMcpEnabled)}
                        <div className={classes.sectionBody}>
                            {!isMcpEnabled ? (
                                renderDisabledBanner(
                                    Dab.ApiType.Mcp,
                                    locConstants.schemaDesigner.mcp,
                                )
                            ) : (
                                <>
                                    <Checkbox
                                        checked={exposeAsMcpCustomTool}
                                        onChange={(_, data) =>
                                            updateExposeAsMcpCustomTool(!!data.checked)
                                        }
                                        label={locConstants.schemaDesigner.exposeAsMcpCustomTool}
                                    />
                                    {exposeAsMcpCustomTool && (
                                        <Text className={classes.fieldHint}>
                                            {locConstants.schemaDesigner.exposeAsMcpCustomToolHelp}
                                        </Text>
                                    )}
                                </>
                            )}
                        </div>
                    </section>
                )}
            </DrawerBody>
            <DrawerFooter className={classes.drawerFooter}>
                <Button
                    appearance="secondary"
                    className={classes.actionButton}
                    onClick={handleCancel}>
                    {locConstants.common.cancel}
                </Button>
                <Button appearance="primary" className={classes.actionButton} onClick={handleApply}>
                    {locConstants.schemaDesigner.applyChanges}
                </Button>
            </DrawerFooter>
        </Drawer>
    );
}
