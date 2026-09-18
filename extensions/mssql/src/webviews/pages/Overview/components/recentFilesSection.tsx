/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { Document16Regular } from "@fluentui/react-icons";

import { SectionHeading } from "./sectionHeading";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    list: {
        display: "flex",
        flexDirection: "column",
    },
    item: {
        display: "flex",
        alignItems: "baseline",
        gap: tokens.spacingHorizontalS,
        width: "100%",
        textAlign: "left",
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXS}`,
        border: "none",
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: "transparent",
        fontFamily: "inherit",
        fontSize: "inherit",
        cursor: "pointer",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
        ":focus-visible": {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
        },
    },
    itemIcon: {
        display: "flex",
        flexShrink: 0,
        alignSelf: "center",
        color: tokens.colorNeutralForeground3,
    },
    fileName: {
        color: tokens.colorBrandForegroundLink,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        ":hover": {
            textDecoration: "underline",
        },
    },
    folder: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flexShrink: 0,
        maxWidth: "40%",
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
});

export const RecentFilesSection = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openRecentSqlFile } = useOverviewActions();
    const recentFiles = useOverviewSelector((state) => state.recentFiles);

    return (
        <section className={classes.root}>
            <SectionHeading>{loc.recentFiles}</SectionHeading>
            {recentFiles.length === 0 ? (
                <Text className={classes.empty}>{loc.noRecentFiles}</Text>
            ) : (
                <div className={classes.list}>
                    {recentFiles.map((file) => (
                        <Tooltip key={file.fsPath} content={file.fsPath} relationship="description">
                            <button
                                type="button"
                                className={classes.item}
                                onClick={() => openRecentSqlFile(file.fsPath)}>
                                <span className={classes.itemIcon}>
                                    <Document16Regular />
                                </span>
                                <span className={classes.fileName}>{file.fileName}</span>
                                {file.folderLabel && (
                                    <span className={classes.folder}>{file.folderLabel}</span>
                                )}
                            </button>
                        </Tooltip>
                    ))}
                </div>
            )}
        </section>
    );
};
