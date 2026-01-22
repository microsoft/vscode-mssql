/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Checkbox, makeStyles, Spinner, Text, tokens } from "@fluentui/react-components";
import { useContext, useEffect, useMemo } from "react";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { DabToolbar } from "./dabToolbar";
import { DabEntityTile } from "./dabEntityTile";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        overflow: "hidden",
    },
    content: {
        flex: 1,
        overflow: "auto",
        padding: "15px",
    },
    schemaSection: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        marginBottom: "20px",
    },
    schemaHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    schemaLabel: {
        fontSize: "13px",
        fontWeight: 600,
        color: tokens.colorNeutralForeground2,
    },
    schemaDivider: {
        flex: 1,
        height: "1px",
        backgroundColor: tokens.colorNeutralStroke2,
    },
    entityGrid: {
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
    },
    loadingContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: "12px",
    },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "200px",
        color: tokens.colorNeutralForeground3,
    },
});

interface DabPageProps {
    activeView?: SchemaDesigner.SchemaDesignerActiveView;
}

export const DabPage = ({ activeView }: DabPageProps) => {
    const classes = useStyles();
    const context = useContext(SchemaDesignerContext);

    const {
        dabConfig,
        initializeDabConfig,
        syncDabConfigWithSchema,
        isInitialized,
        toggleDabEntity,
        toggleDabEntityAction,
        updateDabEntitySettings,
        dabSchemaFilter,
    } = context;

    // Initialize DAB config when schema is first initialized
    useEffect(() => {
        if (isInitialized && !dabConfig) {
            initializeDabConfig();
        }
    }, [isInitialized, dabConfig, initializeDabConfig]);

    // Sync DAB config with schema when switching to DAB tab
    useEffect(() => {
        const isDabTabActive = activeView === SchemaDesigner.SchemaDesignerActiveView.Dab;

        if (isInitialized && isDabTabActive && dabConfig) {
            // Incremental sync: add new tables, remove deleted ones, keep existing settings
            syncDabConfigWithSchema();
        }
    }, [activeView]);

    // Filter entities based on schema filter
    const filteredEntities = useMemo(() => {
        if (!dabConfig) {
            return [];
        }
        if (dabSchemaFilter.length === 0) {
            return dabConfig.entities;
        }
        return dabConfig.entities.filter((e) => dabSchemaFilter.includes(e.schemaName));
    }, [dabConfig, dabSchemaFilter]);

    // Group filtered entities by schema
    const entitiesBySchema = useMemo(() => {
        const groups: Record<string, typeof filteredEntities> = {};
        for (const entity of filteredEntities) {
            if (!groups[entity.schemaName]) {
                groups[entity.schemaName] = [];
            }
            groups[entity.schemaName].push(entity);
        }
        return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    }, [filteredEntities]);

    // Show loading state while schema is being initialized
    if (!isInitialized) {
        return (
            <div className={classes.root}>
                <div className={classes.loadingContainer}>
                    <Spinner size="medium" />
                    <Text>{locConstants.schemaDesigner.loading}</Text>
                </div>
            </div>
        );
    }

    // Show loading state while DAB config is being initialized
    if (!dabConfig) {
        return (
            <div className={classes.root}>
                <div className={classes.loadingContainer}>
                    <Spinner size="medium" />
                    <Text>{locConstants.schemaDesigner.initializingDabConfig}</Text>
                </div>
            </div>
        );
    }

    return (
        <div className={classes.root}>
            <DabToolbar />
            <div className={classes.content}>
                {filteredEntities.length === 0 ? (
                    <div className={classes.emptyState}>
                        <Text>{locConstants.schemaDesigner.noEntitiesFound}</Text>
                    </div>
                ) : (
                    entitiesBySchema.map(([schemaName, entities]) => {
                        const enabledCount = entities.filter((e) => e.isEnabled).length;
                        const allChecked = enabledCount === entities.length;
                        const noneChecked = enabledCount === 0;
                        return (
                            <div key={schemaName} className={classes.schemaSection}>
                                <div className={classes.schemaHeader}>
                                    <Checkbox
                                        checked={allChecked ? true : noneChecked ? false : "mixed"}
                                        onChange={(_, data) => {
                                            const enable =
                                                data.checked === true || data.checked === "mixed";
                                            for (const entity of entities) {
                                                toggleDabEntity(entity.id, enable);
                                            }
                                        }}
                                    />
                                    <Text className={classes.schemaLabel}>{schemaName}</Text>
                                    <div className={classes.schemaDivider} />
                                </div>
                                <div className={classes.entityGrid}>
                                    {entities.map((entity) => (
                                        <DabEntityTile
                                            key={entity.id}
                                            entity={entity}
                                            onToggleEnabled={(isEnabled) =>
                                                toggleDabEntity(entity.id, isEnabled)
                                            }
                                            onToggleAction={(action, isEnabled) =>
                                                toggleDabEntityAction(entity.id, action, isEnabled)
                                            }
                                            onUpdateSettings={(settings) =>
                                                updateDabEntitySettings(entity.id, settings)
                                            }
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
