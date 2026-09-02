/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ep from "../../../sharedInterfaces/executionPlan";

import { ArrowDown16Regular, ArrowUp16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { Dropdown, Input, Option, makeStyles } from "@fluentui/react-components";

import { ExecutionPlanGraphController } from "./executionPlanGraphController";
import { locConstants } from "../../common/locConstants";
import { useMemo, useState } from "react";
import {
    VscodeFloatingWidget,
    VscodeFloatingWidgetAction,
} from "../../common/vscodeFloatingWidget";
import { SearchableDropdown } from "../../common/searchableDropdown.component";

const useStyles = makeStyles({
    previewInputContainer: {
        position: "absolute",
        top: "4px",
        right: "39px",
        zIndex: 5,
        maxWidth: "calc(100% - 51px)",
    },
    previewComparisonControl: {
        width: "96px",
        minWidth: "96px",
        height: "26px",
        boxSizing: "border-box",
    },
    previewValueControl: {
        width: "156px",
        minWidth: "112px",
        height: "26px",
        boxSizing: "border-box",
    },
    previewResultCount: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: "11px",
        paddingRight: "2px",
        whiteSpace: "nowrap",
    },
    option: {
        fontSize: "12px",
        whiteSpace: "nowrap",
        textAlign: "left",
        marginLeft: "0px",
        paddingLeft: "0px",
    },
});

interface FindNodeProps {
    executionPlanView: ExecutionPlanGraphController;
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
    inputRef,
}) => {
    const classes = useStyles();
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
    const [hasSearched, setHasSearched] = useState(false);
    const searchableFindNodeOptions = useMemo(
        () => findNodeOptions.map((option) => ({ value: option, text: option })),
        [findNodeOptions],
    );
    const selectedFindNodeOption = useMemo(
        () => searchableFindNodeOptions.find((option) => option.value === findNodeSelection),
        [findNodeSelection, searchableFindNodeOptions],
    );

    const handleFoundNode = async (direction: number) => {
        if (!executionPlanView) {
            return;
        }

        let results = findNodeResults;
        let resultIndex = findNodeResultsIndex;
        if (resultIndex === -1) {
            const enumSelected =
                findNodeEnum[findNodeComparisonOptions.indexOf(findNodeComparisonSelection)];
            const searchQuery: ep.SearchQuery = {
                propertyName: findNodeSelection,
                value: findNodeSearchValue,
                searchType: enumSelected,
            };
            results = executionPlanView.searchNodes(searchQuery) as ep.ExecutionPlanNode[];
            setHasSearched(true);
            setFindNodeResults(results);
            resultIndex = direction < 0 ? results.length - 1 : 0;
        } else {
            resultIndex =
                (resultIndex + direction + findNodeResults.length) % findNodeResults.length;
        }

        if (results.length === 0) {
            setFindNodeResultsIndex(-1);
            return;
        }

        setFindNodeResultsIndex(resultIndex);
        executionPlanView.selectElement(results[resultIndex], true);
        setExecutionPlanView(executionPlanView);
    };

    const resultSummary =
        findNodeResults.length > 0 && findNodeResultsIndex >= 0
            ? locConstants.common.searchResultSummary(
                  findNodeResultsIndex + 1,
                  findNodeResults.length,
              )
            : hasSearched
              ? locConstants.common.noResults
              : "";

    return (
        <VscodeFloatingWidget
            id="findNodeInputContainer"
            className={classes.previewInputContainer}
            role="search"
            aria-label={locConstants.executionPlan.findNodes}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    setFindNodeClicked(false);
                }
            }}>
            <SearchableDropdown
                id="findNodeDropdown"
                size="small"
                options={searchableFindNodeOptions}
                selectedOption={selectedFindNodeOption}
                style={{
                    width: "210px",
                    minWidth: "160px",
                    height: "26px",
                    boxSizing: "border-box",
                }}
                minPopupWidth={240}
                searchBoxPlaceholder={locConstants.common.find}
                onSelect={(option) => {
                    setFindNodeSelection(option.value);
                    setHasSearched(false);
                    setFindNodeResultsIndex(-1);
                    setFindNodeResults([]);
                }}
                triggerRef={inputRef}
                ariaLabel={locConstants.executionPlan.findNode}
            />
            <Dropdown
                id="findNodeComparisonDropdown"
                size="small"
                className={classes.previewComparisonControl}
                style={{
                    width: "96px",
                    minWidth: "96px",
                    height: "26px",
                    boxSizing: "border-box",
                }}
                defaultValue={findNodeComparisonOptions[0]}
                onOptionSelect={(_, data) => {
                    setFindNodeComparisonSelection(data.optionText ?? findNodeComparisonOptions[0]);
                    setHasSearched(false);
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
            <Input
                id="findNodeInputBox"
                size="small"
                type="text"
                className={classes.previewValueControl}
                value={findNodeSearchValue}
                placeholder={locConstants.executionPlan.value}
                contentAfter={
                    resultSummary ? (
                        <span className={classes.previewResultCount} aria-live="polite">
                            {resultSummary}
                        </span>
                    ) : undefined
                }
                onChange={(event) => {
                    setFindNodeSearchValue(event.target.value);
                    setHasSearched(false);
                    setFindNodeResultsIndex(-1);
                    setFindNodeResults([]);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        void handleFoundNode(event.shiftKey ? -1 : 1);
                    }
                }}
                aria-label={locConstants.executionPlan.value}
            />
            <VscodeFloatingWidgetAction
                onClick={() => handleFoundNode(-1)}
                title={locConstants.executionPlan.previous}
                aria-label={locConstants.executionPlan.previous}
                icon={<ArrowUp16Regular />}
            />
            <VscodeFloatingWidgetAction
                onClick={() => handleFoundNode(1)}
                title={locConstants.executionPlan.next}
                aria-label={locConstants.executionPlan.next}
                icon={<ArrowDown16Regular />}
            />
            <VscodeFloatingWidgetAction
                onClick={() => setFindNodeClicked(false)}
                title={locConstants.common.close}
                aria-label={locConstants.common.close}
                icon={<Dismiss16Regular />}
            />
        </VscodeFloatingWidget>
    );
};
