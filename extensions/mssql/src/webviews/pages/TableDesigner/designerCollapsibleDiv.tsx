/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { AppsListDetailRegular, ChevronDownRegular, ChevronUpRegular } from "@fluentui/react-icons";
import React, { useState } from "react";

export type DesignerCollapsibleDivProps = {
    header: {
        title: string;
        icon?: React.ReactNode;
    };
    div?: React.ReactNode;
    onCollapseHandler?: (isCollapsed: boolean) => void;
};

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
        border: "1px solid rgb(209, 209, 209)",
        borderRadius: "8px",
        padding: "12px",
    },
    header: {
        display: "flex",
        flexDirection: "row",
        height: "20px",
        //justifyContent: "space-between",
        fontSize: "14px",
        textSizeAdjust: "100%",
        // center the items vertically
        lineHeight: "24px",
    },
    headerIcon: {
        width: "24px",
        height: "24px",
    },
    headerTitle: {
        marginLeft: "8px",
        marginRight: "8px",
        textAlign: "left",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        overflow: "hidden",
        width: "100%",
    },
    collapseButton: {
        width: "20px",
        height: "20px",
        lineHeight: "24px",
        alignItems: "flex-start",
        flex: 1,
    },
    collapseIcon: {
        width: "20px",
        height: "20px",
    },
});

export const DesignerCollapsibleDiv: React.FC<DesignerCollapsibleDivProps> = (props) => {
    const classes = useStyles();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const onCollapseHandler = () => {
        setIsCollapsed(!isCollapsed);
        if (props.onCollapseHandler) {
            props.onCollapseHandler(!isCollapsed);
        }
    };
    return (
        <div className={classes.root}>
            <div
                className={classes.header}
                onClick={() => {
                    onCollapseHandler();
                }}>
                <AppsListDetailRegular className={classes.headerIcon} />
                {/* <div className={classes.headerIcon}>{props.header.icon ?? <AppsListDetailRegular className = {classes.headerIcon}/>}</div> */}
                <div className={classes.headerTitle} title={props.header.title}>
                    {props.header.title}
                </div>
                <div className={classes.collapseButton} onClick={onCollapseHandler}>
                    <Button
                        style={{
                            marginTop: "-5px",
                        }}
                        appearance="subtle"
                        icon={isCollapsed ? <ChevronDownRegular /> : <ChevronUpRegular />}
                    />
                </div>
            </div>
            {!isCollapsed && props.div}
        </div>
    );
};
