/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Checkbox, makeStyles, Text, tokens } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { Dab } from "../../../../sharedInterfaces/dab";
import { DabEntitySettingsDialog } from "./dabEntitySettingsDialog";

const useStyles = makeStyles({
    tile: {
        display: "flex",
        flexDirection: "column",
        padding: "12px 16px",
        borderRadius: "4px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        gap: "8px",
        minWidth: "280px",
        maxWidth: "400px",
    },
    tileDisabled: {
        opacity: 0.6,
    },
    headerRow: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
    },
    headerLeft: {
        display: "flex",
        alignItems: "flex-start",
        gap: "4px",
        flex: 1,
        minWidth: 0,
    },
    nameColumn: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
    },
    nameRow: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
    },
    tableName: {
        fontWeight: 600,
        fontSize: "14px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    schemaTableName: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    separator: {
        color: tokens.colorNeutralForeground3,
        margin: "0 4px",
    },
    description: {
        fontSize: "11px",
        color: tokens.colorNeutralForeground4,
    },
    actionsRow: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginLeft: "24px",
        flexWrap: "wrap",
    },
    actionCheckbox: {
        "& label": {
            fontSize: "12px",
        },
    },
    settingsButton: {
        minWidth: "auto",
    },
});

interface DabEntityTileProps {
    entity: Dab.DabEntityConfig;
    onToggleEnabled: (isEnabled: boolean) => void;
    onToggleAction: (action: Dab.EntityAction, isEnabled: boolean) => void;
    onUpdateSettings: (settings: Dab.EntityAdvancedSettings) => void;
}

export function DabEntityTile({
    entity,
    onToggleEnabled,
    onToggleAction,
    onUpdateSettings,
}: DabEntityTileProps) {
    const classes = useStyles();
    const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

    const actionLabels: Record<Dab.EntityAction, string> = {
        [Dab.EntityAction.Create]: locConstants.schemaDesigner.create,
        [Dab.EntityAction.Read]: locConstants.schemaDesigner.read,
        [Dab.EntityAction.Update]: locConstants.schemaDesigner.update,
        [Dab.EntityAction.Delete]: locConstants.common.delete,
    };

    const allActions = [
        Dab.EntityAction.Create,
        Dab.EntityAction.Read,
        Dab.EntityAction.Update,
        Dab.EntityAction.Delete,
    ];

    return (
        <>
            <div className={`${classes.tile} ${!entity.isEnabled ? classes.tileDisabled : ""}`}>
                {/* Header row with checkbox, table name, and settings */}
                <div className={classes.headerRow}>
                    <div className={classes.headerLeft}>
                        <Checkbox
                            checked={entity.isEnabled}
                            onChange={(_, data) => onToggleEnabled(data.checked === true)}
                        />
                        <div className={classes.nameColumn}>
                            <div className={classes.nameRow}>
                                <Text className={classes.tableName}>
                                    {entity.advancedSettings.entityName}
                                </Text>
                                <Text className={classes.separator}>&#8226;</Text>
                                <Text className={classes.schemaTableName}>
                                    {entity.schemaName}.{entity.tableName}
                                </Text>
                            </div>
                            <Text className={classes.description}>
                                {locConstants.schemaDesigner.entityNameDescription}
                            </Text>
                        </div>
                    </div>
                    <Button
                        appearance="subtle"
                        icon={<FluentIcons.Settings16Regular />}
                        size="small"
                        className={classes.settingsButton}
                        onClick={() => setSettingsDialogOpen(true)}
                        title={locConstants.schemaCompare.settings}
                    />
                </div>

                {/* CRUD actions row */}
                <div className={classes.actionsRow}>
                    {allActions.map((action) => (
                        <Checkbox
                            key={action}
                            className={classes.actionCheckbox}
                            label={actionLabels[action]}
                            checked={entity.enabledActions.includes(action)}
                            disabled={!entity.isEnabled}
                            onChange={(_, data) => onToggleAction(action, data.checked === true)}
                        />
                    ))}
                </div>
            </div>

            {/* Settings Dialog */}
            <DabEntitySettingsDialog
                entity={entity}
                open={settingsDialogOpen}
                onOpenChange={setSettingsDialogOpen}
                onApply={(settings) => {
                    onUpdateSettings(settings);
                    setSettingsDialogOpen(false);
                }}
            />
        </>
    );
}
