/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./executionPlan.css";

import * as ep from "../../../sharedInterfaces/executionPlan";

import { ArrowDown16Regular, ArrowUp16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { Button, Dropdown, Input, Option, makeStyles, tokens } from "@fluentui/react-components";

import {
    SearchableDropdown,
    SearchableDropdownOptions,
} from "../../common/searchableDropdown.component";
import { ExecutionPlanView } from "./executionPlanView";
import { locConstants } from "../../common/locConstants";
import { useState } from "react";

const useStyles = makeStyles({
    inputContainer: {
        position: "absolute",
        top: 0,
        right: "35px",
        display: "flex",
        alignItems: "center",
        gap: "3px",
        opacity: 1,
        zIndex: "35",
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
    label: {
        color: tokens.colorNeutralForeground2,
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        whiteSpace: "nowrap",
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
    inputRef: any;
}

export const FindNode: React.FC<FindNodeProps> = ({
    executionPlanView,
    setExecutionPlanView,
    findNodeOptions,
    setFindNodeClicked,
    inputRef: _inputRef,
}) => {
    const classes = useStyles();
    const searchableFindNodeOptions: SearchableDropdownOptions[] = findNodeOptions.map(
        (option) => ({
            value: option,
            text: option,
        }),
    );
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

    const [findNodeSelection, setFindNodeSelection] = useState(findNodeOptions[0]);
    const [findNodeComparisonSelection, setFindNodeComparisonSelection] = useState(
        findNodeComparisonOptions[0],
    );
    const [findNodeSearchValue, setFindNodeSearchValue] = useState("");
    const [findNodeResults, setFindNodeResults] = useState<ep.ExecutionPlanNode[]>([]);
    const [findNodeResultsIndex, setFindNodeResultsIndex] = useState(-1);

    const handleFoundNode = async (node: number) => {
        let results: ep.ExecutionPlanNode[] = [];
        let resultIndex = 0;
        if (executionPlanView) {
            const enumSelected =
                findNodeEnum[findNodeComparisonOptions.indexOf(findNodeComparisonSelection)];
            if (findNodeResultsIndex === -1 && executionPlanView) {
                let searchQuery: ep.SearchQuery = {
                    propertyName: findNodeSelection,
                    value: findNodeSearchValue,
                    searchType: enumSelected,
                };
                results = executionPlanView.searchNodes(searchQuery) as ep.ExecutionPlanNode[];
                setFindNodeResults(results);
                setFindNodeResultsIndex(0);
            } else if (node === -1 && findNodeResultsIndex === 0) {
                setFindNodeResultsIndex(findNodeResults.length - 1);
            } else if (node === 1 && findNodeResultsIndex === findNodeResults.length - 1) {
                setFindNodeResultsIndex(0);
            } else {
                setFindNodeResultsIndex(findNodeResultsIndex + node);
            }
            if (!findNodeResults.length) {
                executionPlanView.selectElement(results[resultIndex], true);
            } else {
                executionPlanView.selectElement(findNodeResults[findNodeResultsIndex], true);
            }
            setExecutionPlanView(executionPlanView);
        }
    };

    return (
        <div
            id="findNodeInputContainer"
            className={`${classes.inputContainer} execution-plan-widget`}>
            <div className={classes.label}>{locConstants.executionPlan.findNodes}</div>
            <div style={{ paddingRight: "12px" }} />
            <SearchableDropdown
                id="findNodeDropdown"
                style={{ width: "130px", minWidth: "130px", maxWidth: "130px" }}
                size="small"
                options={searchableFindNodeOptions}
                selectedOption={
                    findNodeSelection
                        ? {
                              value: findNodeSelection,
                              text: findNodeSelection,
                          }
                        : undefined
                }
                onSelect={(option) => {
                    setFindNodeSelection(option.value || findNodeOptions[0]);
                    setFindNodeResultsIndex(-1);
                    setFindNodeResults([]);
                }}
                ariaLabel={locConstants.executionPlan.findNode}
                searchBoxPlaceholder={locConstants.common.find}
            />
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
                    setFindNodeComparisonSelection(data.optionText ?? findNodeComparisonOptions[0]);
                    setFindNodeResultsIndex(-1);
                    setFindNodeResults([]);
                }}
                aria-label={locConstants.executionPlan.findNode}>
                {findNodeComparisonOptions.map((option) => (
                    <Option key={option} className={classes.option}>
                        {option}
                    </Option>
                ))}
            </Dropdown>
            <div className={classes.spacer}></div>
            <Input
                id="findNodeInputBox"
                ref={_inputRef}
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
                title={locConstants.executionPlan.previous}
                aria-label={locConstants.executionPlan.previous}
                icon={<ArrowUp16Regular />}
            />
            <Button
                onClick={() => handleFoundNode(1)}
                size="small"
                appearance="subtle"
                title={locConstants.executionPlan.next}
                aria-label={locConstants.executionPlan.next}
                icon={<ArrowDown16Regular />}
            />
            <Button
                onClick={() => setFindNodeClicked(false)}
                size="small"
                appearance="subtle"
                title={locConstants.common.close}
                aria-label={locConstants.common.close}
                icon={<Dismiss16Regular />}
            />
        </div>
    );
};
