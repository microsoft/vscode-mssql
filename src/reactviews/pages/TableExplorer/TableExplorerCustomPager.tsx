/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    PaginationMetadata,
    PaginationService,
    PubSubService,
    SlickGrid,
    Subscription,
} from "@slickgrid-universal/common";
import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
    ChevronLeftRegular,
    ChevronRightRegular,
    ChevronDoubleLeftRegular,
    ChevronDoubleRightRegular,
} from "@fluentui/react-icons";
import { Dropdown, Option, Combobox } from "@fluentui/react-components";

import "./TableExplorerCustomPager.css";
import { locConstants as loc } from "../../common/locConstants";

// Default pagination constants
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_ROW_COUNT = 100;
const MIN_VALID_NUMBER = 1;
const FIRST_PAGE_NUMBER = 1;
const RADIX_DECIMAL = 10;

export interface TableExplorerCustomPagerRef {
    init: (
        grid: SlickGrid,
        paginationService: PaginationService,
        pubSubService: PubSubService,
    ) => void;
    dispose: () => void;
    renderPagination: () => void;
}

export interface TableExplorerCustomPagerProps {
    currentRowCount?: number;
    onLoadSubset?: (rowCount: number) => void;
}

const TableExplorerCustomPager = React.forwardRef<
    TableExplorerCustomPagerRef,
    TableExplorerCustomPagerProps
>((props, ref) => {
    const { currentRowCount, onLoadSubset } = props;
    const [currentPagination, setCurrentPagination] = useState<PaginationMetadata>(
        {} as PaginationMetadata,
    );
    const [isLeftPaginationDisabled, setIsLeftPaginationDisabled] = useState(false);
    const [isRightPaginationDisabled, setIsRightPaginationDisabled] = useState(false);
    const [selectedPageSize, setSelectedPageSize] = useState<string>(String(DEFAULT_PAGE_SIZE));
    const [selectedRowCount, setSelectedRowCount] = useState<string>(String(DEFAULT_ROW_COUNT));

    const paginationElementRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<SlickGrid | null>(null);
    const paginationServiceRef = useRef<PaginationService | null>(null);
    const pubSubServiceRef = useRef<PubSubService | null>(null);
    const subscriptionsRef = useRef<Subscription[]>([]);

    const checkLeftPaginationDisabled = (pagination: PaginationMetadata): boolean => {
        return pagination.pageNumber === FIRST_PAGE_NUMBER || pagination.totalItems === 0;
    };

    const checkRightPaginationDisabled = (pagination: PaginationMetadata): boolean => {
        return pagination.pageNumber === pagination.pageCount || pagination.totalItems === 0;
    };

    const init = (
        grid: SlickGrid,
        paginationService: PaginationService,
        pubSubService: PubSubService,
    ) => {
        gridRef.current = grid;
        paginationServiceRef.current = paginationService;
        pubSubServiceRef.current = pubSubService;

        const currentPagination = paginationService.getFullPagination();
        setCurrentPagination(currentPagination);
        setIsLeftPaginationDisabled(checkLeftPaginationDisabled(currentPagination));
        setIsRightPaginationDisabled(checkRightPaginationDisabled(currentPagination));
        setSelectedPageSize(String(currentPagination.pageSize || DEFAULT_PAGE_SIZE));

        const subscription = pubSubService.subscribe<PaginationMetadata>(
            "onPaginationRefreshed",
            (paginationChanges) => {
                setCurrentPagination(paginationChanges);
                setIsLeftPaginationDisabled(checkLeftPaginationDisabled(paginationChanges));
                setIsRightPaginationDisabled(checkRightPaginationDisabled(paginationChanges));
                setSelectedPageSize(String(paginationChanges.pageSize || DEFAULT_PAGE_SIZE));
            },
        );

        subscriptionsRef.current.push(subscription);
    };

    const dispose = () => {
        pubSubServiceRef.current?.unsubscribeAll(subscriptionsRef.current);
        paginationElementRef.current?.remove();
    };

    const renderPagination = () => {
        if (paginationServiceRef.current) {
            const currentPagination = paginationServiceRef.current.getFullPagination();
            setCurrentPagination(currentPagination);
            setIsLeftPaginationDisabled(checkLeftPaginationDisabled(currentPagination));
            setIsRightPaginationDisabled(checkRightPaginationDisabled(currentPagination));
            setSelectedPageSize(String(currentPagination.pageSize || DEFAULT_PAGE_SIZE));
        }
    };

    const onFirstPageClicked = (event: any) => {
        if (!checkLeftPaginationDisabled(currentPagination)) {
            void paginationServiceRef.current?.goToFirstPage(event);
        }
    };

    const onLastPageClicked = (event: any) => {
        if (!checkRightPaginationDisabled(currentPagination)) {
            void paginationServiceRef.current?.goToLastPage(event);
        }
    };

    const onNextPageClicked = (event: any) => {
        if (!checkRightPaginationDisabled(currentPagination)) {
            void paginationServiceRef.current?.goToNextPage(event);
        }
    };

    const onPreviousPageClicked = (event: any) => {
        if (!checkLeftPaginationDisabled(currentPagination)) {
            void paginationServiceRef.current?.goToPreviousPage(event);
        }
    };

    const onPageSizeChanged = (_event: any, data: any) => {
        const newPageSize = data.optionValue || data.value;
        setSelectedPageSize(newPageSize);
        const pageSizeNumber = parseInt(newPageSize, RADIX_DECIMAL);

        if (!isNaN(pageSizeNumber) && pageSizeNumber >= MIN_VALID_NUMBER) {
            void paginationServiceRef.current?.changeItemPerPage(pageSizeNumber);
        }
    };

    const onRowCountChanged = (_event: any, data: any) => {
        const newRowCount = data.optionValue || data.value || selectedRowCount;
        if (newRowCount) {
            setSelectedRowCount(newRowCount);
            // Automatically fetch when a dropdown option is selected
            const rowCountNumber = parseInt(newRowCount, RADIX_DECIMAL);
            if (!isNaN(rowCountNumber) && rowCountNumber >= MIN_VALID_NUMBER && onLoadSubset) {
                onLoadSubset(rowCountNumber);
            }
        }
    };

    const onRowCountInput = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = event.target.value;
        setSelectedRowCount(newValue);
    };

    const onRowCountKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            // Trigger fetch when Enter is pressed
            const rowCountNumber = parseInt(
                selectedRowCount || String(DEFAULT_ROW_COUNT),
                RADIX_DECIMAL,
            );

            if (!isNaN(rowCountNumber) && rowCountNumber >= MIN_VALID_NUMBER && onLoadSubset) {
                onLoadSubset(rowCountNumber);
            }
        }
    };

    useEffect(() => {
        return () => {
            dispose();
        };
    }, []);

    useEffect(() => {
        if (currentRowCount !== undefined) {
            setSelectedRowCount(String(currentRowCount));
        }
    }, [currentRowCount]);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
        init,
        dispose,
        renderPagination,
    }));

    return (
        <div className="table-explorer-custom-pagination" ref={paginationElementRef}>
            <div className="page-size-selector">
                <span className="page-size-label">{loc.tableExplorer.rowsPerPage}</span>
                <Dropdown
                    value={selectedPageSize}
                    selectedOptions={[selectedPageSize]}
                    onOptionSelect={onPageSizeChanged}
                    size="small">
                    <Option value="10">10</Option>
                    <Option value="50">50</Option>
                    <Option value="100">100</Option>
                    <Option value="1000">1000</Option>
                </Dropdown>
            </div>
            <div className="pagination-controls">
                <div className="pagination-nav">
                    <button
                        className={`pagination-button first ${isLeftPaginationDisabled ? "disabled" : ""}`}
                        aria-label={loc.tableExplorer.firstPage}
                        title={loc.tableExplorer.firstPage}
                        disabled={isLeftPaginationDisabled}
                        onClick={onFirstPageClicked}>
                        <ChevronDoubleLeftRegular />
                    </button>
                    <button
                        className={`pagination-button previous ${isLeftPaginationDisabled ? "disabled" : ""}`}
                        aria-label={loc.tableExplorer.previousPage}
                        title={loc.tableExplorer.previousPage}
                        disabled={isLeftPaginationDisabled}
                        onClick={onPreviousPageClicked}>
                        <ChevronLeftRegular />
                    </button>
                </div>
                <div className="page-info">
                    <span className="item-from" data-test="item-from">
                        {currentPagination.dataFrom || 0}
                    </span>
                    <span className="separator">-</span>
                    <span className="item-to" data-test="item-to">
                        {currentPagination.dataTo || 0}
                    </span>
                    <span className="separator"> of </span>
                    <span className="total-items" data-test="total-items">
                        {currentPagination.totalItems || 0}
                    </span>
                </div>
                <div className="pagination-nav">
                    <button
                        className={`pagination-button next ${isRightPaginationDisabled ? "disabled" : ""}`}
                        aria-label={loc.tableExplorer.nextPage}
                        title={loc.tableExplorer.nextPage}
                        disabled={isRightPaginationDisabled}
                        onClick={onNextPageClicked}>
                        <ChevronRightRegular />
                    </button>
                    <button
                        className={`pagination-button last ${isRightPaginationDisabled ? "disabled" : ""}`}
                        aria-label={loc.tableExplorer.lastPage}
                        title={loc.tableExplorer.lastPage}
                        disabled={isRightPaginationDisabled}
                        onClick={onLastPageClicked}>
                        <ChevronDoubleRightRegular />
                    </button>
                </div>
            </div>
            <div className="row-count-selector">
                <span className="row-count-label">{loc.tableExplorer.totalRowsToFetch}</span>
                <Combobox
                    value={selectedRowCount}
                    selectedOptions={[selectedRowCount]}
                    onOptionSelect={onRowCountChanged}
                    onInput={onRowCountInput}
                    onKeyDown={onRowCountKeyDown}
                    size="small"
                    freeform
                    placeholder="Enter or select">
                    <Option value="10">10</Option>
                    <Option value="50">50</Option>
                    <Option value="100">100</Option>
                    <Option value="500">500</Option>
                    <Option value="1000">1000</Option>
                </Combobox>
            </div>
        </div>
    );
});

export default TableExplorerCustomPager;
