/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import "./executionPlan.css";
import {
    Button,
    Combobox,
    Dropdown,
    Input,
    Option,
    makeStyles,
} from "@fluentui/react-components";
import {
    ArrowUp20Regular,
    ArrowDown20Regular,
    Dismiss20Regular,
} from "@fluentui/react-icons";
import * as ep from "./executionPlanInterfaces";
import { locConstants } from "../../common/locConstants";
import { ExecutionPlanView } from "./executionPlanView";

const useStyles = makeStyles({
    inputContainer: {
        position: "absolute",
        top: 0,
        right: "35px",
        padding: "10px",
        border: "1px solid #ccc",
        zIndex: "1",
        boxShadow: "0px 4px 6px rgba(0, 0, 0, 0.1)",
        display: "flex",
        alignItems: "center",
        gap: "2px",
        opacity: 1,
    },
    inputs: {
        minWidth: "unset",
        maxWidth: "unset",
    },
    option: {
        fontSize: "12px",
        whiteSpace: "nowrap",
        textAlign: "left",
        marginLeft: "0px",
        paddingLeft: "0px",
    },
    spacer: {
        padding: "1px",
    },
});

interface FindNodeProps {
    executionPlanView: ExecutionPlanView;
    setExecutionPlanView: any;
    findNodeOptions: string[];
    setFindNodeClicked: any;
}

export const FindNode: React.FC<FindNodeProps> = ({
    executionPlanView,
    setExecutionPlanView,
    findNodeOptions,
    setFindNodeClicked,
}) => {
    const classes = useStyles();
    const state = useContext(ExecutionPlanContext);
    const theme = state!.theme;
    const findNodeComparisonOptions: string[] = [
        locConstants.executionPlan.equals,
        locConstants.executionPlan.contains,
        ">",
        "<",
        ">=",
        "<=",
        "<>",
    ];
    const findNodeEnum: ep.SearchType[] = [
        ep.SearchType.Equals,
        ep.SearchType.Contains,
        ep.SearchType.GreaterThan,
        ep.SearchType.LesserThan,
        ep.SearchType.GreaterThanEqualTo,
        ep.SearchType.LesserThanEqualTo,
        ep.SearchType.LesserAndGreaterThan,
    ];

    const [findNodeSelection, setFindNodeSelection] = useState(
        findNodeOptions[0],
    );
    const [findNodeComparisonSelection, setFindNodeComparisonSelection] =
        useState(findNodeComparisonOptions[0]);
    const [findNodeSearchValue, setFindNodeSearchValue] = useState("");
    const [findNodeResults, setFindNodeResults] = useState<
        ep.ExecutionPlanNode[]
    >([]);
    const [findNodeResultsIndex, setFindNodeResultsIndex] = useState(-1);

    const handleFoundNode = async (node: number) => {
        let results: ep.ExecutionPlanNode[] = [];
        let resultIndex = 0;
        if (executionPlanView) {
            const enumSelected =
                findNodeEnum[
                    findNodeComparisonOptions.indexOf(
                        findNodeComparisonSelection,
                    )
                ];
            if (findNodeResultsIndex === -1 && executionPlanView) {
                let searchQuery: ep.SearchQuery = {
                    propertyName: findNodeSelection,
                    value: findNodeSearchValue,
                    searchType: enumSelected,
                };
                results = executionPlanView.searchNodes(
                    searchQuery,
                ) as ep.ExecutionPlanNode[];
                setFindNodeResults(results);
                setFindNodeResultsIndex(0);
            } else if (node === -1 && findNodeResultsIndex === 0) {
                setFindNodeResultsIndex(findNodeResults.length - 1);
            } else if (
                node === 1 &&
                findNodeResultsIndex === findNodeResults.length - 1
            ) {
                setFindNodeResultsIndex(0);
            } else {
                setFindNodeResultsIndex(findNodeResultsIndex + node);
            }
            if (!findNodeResults.length) {
                executionPlanView.selectElement(results[resultIndex], true);
            } else {
                executionPlanView.selectElement(
                    findNodeResults[findNodeResultsIndex],
                    true,
                );
            }
            setExecutionPlanView(executionPlanView);
        }
    };

    return (
        <div
            id="findNodeInputContainer"
            className={classes.inputContainer}
            style={{
                background: theme.colorNeutralBackground1,
            }}
        >
            {locConstants.executionPlan.findNodes}
            <div style={{ paddingRight: "12px" }} />
            <Combobox
                id="findNodeDropdown"
                className={classes.inputs}
                size="small"
                input={{ style: { width: "130px", textOverflow: "ellipsis" } }}
                listbox={{ style: { minWidth: "fit-content" } }}
                defaultValue={findNodeOptions[0]}
                onOptionSelect={(_, data) => {
                    setFindNodeSelection(data.optionText ?? findNodeOptions[0]);
                    setFindNodeResultsIndex(-1);
                    setFindNodeResults([]);
                }}
            >
                {findNodeOptions.map((option) => (
                    <Option key={option} className={classes.option}>
                        {option}
                    </Option>
                ))}
            </Combobox>
            <div className={classes.spacer}></div>
            <Dropdown
                id="findNodeComparisonDropdown"
                size="small"
                className={classes.inputs}
                style={{
                    width: "80px",
                    textOverflow: "ellipsis",
                    height: "24px",
                }}
                defaultValue={findNodeComparisonOptions[0]}
                onOptionSelect={(_, data) => {
                    setFindNodeComparisonSelection(
                        data.optionText ?? findNodeComparisonOptions[0],
                    );
                    setFindNodeResultsIndex(-1);
                    setFindNodeResults([]);
                }}
            >
                {findNodeComparisonOptions.map((option) => (
                    <Option key={option} className={classes.option}>
                        {option}
                    </Option>
                ))}
            </Dropdown>
            <div className={classes.spacer}></div>
            <Input
                id="findNodeInputBox"
                size="small"
                type="text"
                className={classes.inputs}
                input={{ style: { width: "85px", textOverflow: "ellipsis" } }}
                onChange={(e) => {
                    setFindNodeSearchValue(e.target.value);
                    setFindNodeResultsIndex(-1);
                    setFindNodeResults([]);
                }}
            />
            <div className={classes.spacer}></div>
            <Button
                onClick={() => handleFoundNode(-1)}
                size="small"
                appearance="subtle"
                icon={<ArrowUp20Regular />}
            />
            <Button
                onClick={() => handleFoundNode(1)}
                size="small"
                appearance="subtle"
                icon={<ArrowDown20Regular />}
            />
            <Button
                onClick={() => setFindNodeClicked(false)}
                size="small"
                appearance="subtle"
                icon={<Dismiss20Regular />}
            />
        </div>
    );
};
