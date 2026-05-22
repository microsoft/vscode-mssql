/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
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
    Tooltip,
    tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular, Info16Regular, Table16Regular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { Dab } from "../../../../sharedInterfaces/dab";
import { StoredProcedureIcon16Regular } from "../../../common/icons/storedProcedure";
import { ViewIcon16Regular } from "../../../common/icons/view";

const useStyles = makeStyles({
    dialogSurface: {
        width: "640px",
        maxWidth: "calc(100vw - 48px)",
        maxHeight: "calc(100vh - 48px)",
        height: "calc(100vh - 48px)",
    },
    dialogBody: {
        height: "100%",
        minHeight: 0,
    },
    dialogContent: {
        display: "flex",
        flexDirection: "column",
        rowGap: "16px",
        paddingTop: "16px",
        paddingBottom: "16px",
        overflowY: "auto",
        minHeight: 0,
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
        rowGap: "10px",
    },
    sectionTitle: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    sectionDisabled: {
        opacity: 0.75,
    },
    sectionBody: {
        display: "flex",
        flexDirection: "column",
        rowGap: "10px",
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
        display: "block",
        color: tokens.colorNeutralForeground4,
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightRegular,
        lineHeight: tokens.lineHeightBase200,
    },
    labelWithInfo: {
        display: "inline-flex",
        alignItems: "center",
        columnGap: "4px",
    },
    infoButton: {
        color: tokens.colorNeutralForeground3,
        minWidth: "16px",
        width: "16px",
        height: "16px",
        padding: 0,
        verticalAlign: "middle",
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
    dialogActions: {
        alignSelf: "stretch",
        columnGap: "12px",
        paddingTop: "12px",
        marginTop: 0,
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
});

interface DabEntitySettingsDialogProps {
    entity: Dab.DabEntityConfig;
    existingEntityNames: string[];
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
    existingEntityNames,
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

    const updateCustomGraphQLSingularType = (value: string) => {
        setLocalSettings((prev) => ({
            ...prev,
            customGraphQLType: undefined,
            customGraphQLSingularType: value || undefined,
        }));
    };

    const updateCustomGraphQLPluralType = (value: string) => {
        setLocalSettings((prev) => ({
            ...prev,
            customGraphQLPluralType: value || undefined,
        }));
    };

    const updateGraphQLEnabled = (value: boolean) => {
        setLocalSettings((prev) => ({ ...prev, graphQLEnabled: value }));
    };

    const updateStoredProcedureRestMethod = (method: Dab.RestMethod) => {
        setLocalSettings((prev) => ({
            ...prev,
            storedProcedureRestMethods: [method],
        }));
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
    const storedProcedureRestMethod =
        storedProcedureRestMethods.find((method) =>
            Dab.storedProcedureAllowedRestMethods.some((allowedMethod) => allowedMethod === method),
        ) ?? Dab.RestMethod.Post;
    const storedProcedureGraphQLOperation =
        localSettings.storedProcedureGraphQLOperation ?? Dab.GraphQLOperation.Mutation;
    const exposeAsMcpCustomTool = localSettings.exposeAsMcpCustomTool !== false;
    const sourceObjectName = `${entity.schemaName}.${entity.sourceName ?? entity.tableName}`;
    const entityName = localSettings.entityName.trim();
    const customRestPath = localSettings.customRestPath?.trim() ?? "";
    const customGraphQLSingularType =
        (localSettings.customGraphQLSingularType ?? localSettings.customGraphQLType)?.trim() ?? "";
    const customGraphQLPluralType = localSettings.customGraphQLPluralType?.trim() ?? "";
    const normalizedExistingEntityNames = new Set(
        existingEntityNames.map(Dab.normalizeDabIdentifier),
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
    const hasValidationError =
        !!entityNameValidationMessage ||
        !!customRestPathValidationMessage ||
        !!customGraphQLSingularTypeValidationMessage ||
        !!customGraphQLPluralTypeValidationMessage;

    const handleApply = () => {
        if (hasValidationError) {
            return;
        }

        onApply({
            ...localSettings,
            entityName,
            customRestPath: customRestPath.length > 0 ? customRestPath : undefined,
            customGraphQLType: undefined,
            customGraphQLSingularType:
                customGraphQLSingularType.length > 0 ? customGraphQLSingularType : undefined,
            customGraphQLPluralType:
                customGraphQLPluralType.length > 0 ? customGraphQLPluralType : undefined,
            ...(isStoredProcedure
                ? { storedProcedureRestMethods: [storedProcedureRestMethod] }
                : {}),
        });
    };

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

    const renderSectionTitle = (title: string) => (
        <Text className={classes.sectionTitle}>{title}</Text>
    );

    const renderLabelWithInfo = (label: string, infoText: string) => (
        <span className={classes.labelWithInfo}>
            <span>{label}</span>
            <Tooltip content={infoText} relationship="description" positioning="after" withArrow>
                <Button
                    appearance="transparent"
                    className={classes.infoButton}
                    icon={<Info16Regular />}
                    size="small"
                    aria-label={infoText}
                />
            </Tooltip>
        </span>
    );

    const renderDisabledBanner = (apiType: Dab.ApiType, label: string, helpText?: string) => (
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

    return (
        <Dialog open={open} modalType="modal" onOpenChange={(_, data) => onOpenChange(data.open)}>
            <DialogSurface className={classes.dialogSurface}>
                <DialogBody className={classes.dialogBody}>
                    <DialogTitle
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
                    </DialogTitle>
                    <DialogContent className={classes.dialogContent}>
                        <section className={classes.section}>
                            {renderSectionTitle(locConstants.schemaDesigner.identity)}
                            <div className={classes.sectionBody}>
                                <Field
                                    label={locConstants.schemaDesigner.entityName}
                                    required
                                    validationState={
                                        entityNameValidationMessage ? "error" : undefined
                                    }
                                    validationMessage={entityNameValidationMessage}>
                                    <Input
                                        value={localSettings.entityName}
                                        onChange={(_, data) => updateEntityName(data.value)}
                                    />
                                </Field>
                            </div>
                        </section>

                        <section className={classes.section}>
                            {renderSectionTitle(locConstants.schemaDesigner.authorizationRole)}
                            <div className={classes.sectionBody}>
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
                                            updateAuthorizationRole(
                                                Dab.AuthorizationRole.Authenticated,
                                            )
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
                                                {
                                                    locConstants.schemaDesigner
                                                        .authenticatedDescription
                                                }
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
                                                updateRestEnabled(!!data.checked)
                                            }
                                            label={locConstants.schemaDesigner.enableRestForEntity}
                                        />
                                        {isEntityRestEnabled && (
                                            <>
                                                <Field
                                                    label={renderLabelWithInfo(
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
                                                        value={localSettings.customRestPath ?? ""}
                                                        placeholder={(
                                                            entity.sourceName ?? entity.tableName
                                                        ).toLowerCase()}
                                                        onChange={(_, data) =>
                                                            updateCustomRestPath(data.value)
                                                        }
                                                    />
                                                </Field>

                                                {isStoredProcedure && (
                                                    <Field
                                                        label={renderLabelWithInfo(
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
                                                                updateStoredProcedureRestMethod(
                                                                    data.value as Dab.RestMethod,
                                                                )
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
                            className={mergeClasses(
                                classes.section,
                                !isGraphQLEnabled && classes.sectionDisabled,
                            )}>
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
                                                updateGraphQLEnabled(!!data.checked)
                                            }
                                            label={
                                                locConstants.schemaDesigner.enableGraphQLForEntity
                                            }
                                        />
                                        {isEntityGraphQLEnabled && (
                                            <>
                                                <Field
                                                    label={renderLabelWithInfo(
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
                                                            entity.sourceName ?? entity.tableName
                                                        }
                                                        onChange={(_, data) =>
                                                            updateCustomGraphQLSingularType(
                                                                data.value,
                                                            )
                                                        }
                                                    />
                                                </Field>
                                                <Field
                                                    label={renderLabelWithInfo(
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
                                                            entity.sourceName ?? entity.tableName
                                                        }s`}
                                                        onChange={(_, data) =>
                                                            updateCustomGraphQLPluralType(
                                                                data.value,
                                                            )
                                                        }
                                                    />
                                                </Field>

                                                {isStoredProcedure && (
                                                    <Field
                                                        label={renderLabelWithInfo(
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
                                                                updateStoredProcedureGraphQLOperation(
                                                                    data.value as Dab.GraphQLOperation,
                                                                )
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

                        {isStoredProcedure && (
                            <section
                                className={mergeClasses(
                                    classes.section,
                                    !isMcpEnabled && classes.sectionDisabled,
                                )}>
                                {renderSectionTitle(locConstants.schemaDesigner.mcp)}
                                <div className={classes.sectionBody}>
                                    {!isMcpEnabled ? (
                                        renderDisabledBanner(
                                            Dab.ApiType.Mcp,
                                            locConstants.schemaDesigner.mcp,
                                            locConstants.schemaDesigner.enableMcpForCustomToolHelp,
                                        )
                                    ) : (
                                        <>
                                            <Checkbox
                                                checked={exposeAsMcpCustomTool}
                                                onChange={(_, data) =>
                                                    updateExposeAsMcpCustomTool(!!data.checked)
                                                }
                                                label={
                                                    locConstants.schemaDesigner
                                                        .exposeAsMcpCustomTool
                                                }
                                            />
                                            {exposeAsMcpCustomTool && (
                                                <span className={classes.fieldHint}>
                                                    {
                                                        locConstants.schemaDesigner
                                                            .exposeAsMcpCustomToolHelp
                                                    }
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>
                            </section>
                        )}
                    </DialogContent>
                    <DialogActions className={classes.dialogActions}>
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
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
