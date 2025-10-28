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
import { Dropdown, Option } from "@fluentui/react-components";

import "./TableExplorerCustomPager.css";

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
    const [selectedPageSize, setSelectedPageSize] = useState<string>("100");
    const [selectedRowCount, setSelectedRowCount] = useState<string>(
        String(currentRowCount || 100),
    );

    const paginationElementRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<SlickGrid | null>(null);
    const paginationServiceRef = useRef<PaginationService | null>(null);
    const pubSubServiceRef = useRef<PubSubService | null>(null);
    const subscriptionsRef = useRef<Subscription[]>([]);

    const checkLeftPaginationDisabled = (pagination: PaginationMetadata): boolean => {
        return pagination.pageNumber === 1 || pagination.totalItems === 0;
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
        setSelectedPageSize(String(currentPagination.pageSize || 100));

        const subscription = pubSubService.subscribe<PaginationMetadata>(
            "onPaginationRefreshed",
            (paginationChanges) => {
                setCurrentPagination(paginationChanges);
                setIsLeftPaginationDisabled(checkLeftPaginationDisabled(paginationChanges));
                setIsRightPaginationDisabled(checkRightPaginationDisabled(paginationChanges));
                setSelectedPageSize(String(paginationChanges.pageSize || 100));
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
            setSelectedPageSize(String(currentPagination.pageSize || 100));
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
        const pageSizeNumber = parseInt(newPageSize, 10);
        if (!isNaN(pageSizeNumber) && pageSizeNumber > 0) {
            void paginationServiceRef.current?.changeItemPerPage(pageSizeNumber);
        }
    };

    const onRowCountChanged = (_event: any, data: any) => {
        const newRowCount = data.optionValue || data.value;
        setSelectedRowCount(newRowCount);
        const rowCountNumber = parseInt(newRowCount, 10);
        if (!isNaN(rowCountNumber) && rowCountNumber > 0 && onLoadSubset) {
            onLoadSubset(rowCountNumber);
        }
    };

    useEffect(() => {
        return () => {
            dispose();
        };
    }, []);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
        init,
        dispose,
        renderPagination,
    }));

    return (
        <div className="table-explorer-custom-pagination" ref={paginationElementRef}>
            <div className="row-count-selector">
                <span className="row-count-label">Total rows to fetch:</span>
                <Dropdown
                    value={selectedRowCount}
                    selectedOptions={[selectedRowCount]}
                    onOptionSelect={onRowCountChanged}
                    size="small">
                    <Option value="10">10</Option>
                    <Option value="50">50</Option>
                    <Option value="100">100</Option>
                    <Option value="500">500</Option>
                    <Option value="1000">1000</Option>
                </Dropdown>
            </div>
            <div className="page-size-selector">
                <span className="page-size-label">Rows per page</span>
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
                        aria-label="First Page"
                        title="First Page"
                        disabled={isLeftPaginationDisabled}
                        onClick={onFirstPageClicked}>
                        <ChevronDoubleLeftRegular />
                    </button>
                    <button
                        className={`pagination-button previous ${isLeftPaginationDisabled ? "disabled" : ""}`}
                        aria-label="Previous Page"
                        title="Previous Page"
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
                        aria-label="Next Page"
                        title="Next Page"
                        disabled={isRightPaginationDisabled}
                        onClick={onNextPageClicked}>
                        <ChevronRightRegular />
                    </button>
                    <button
                        className={`pagination-button last ${isRightPaginationDisabled ? "disabled" : ""}`}
                        aria-label="Last Page"
                        title="Last Page"
                        disabled={isRightPaginationDisabled}
                        onClick={onLastPageClicked}>
                        <ChevronDoubleRightRegular />
                    </button>
                </div>
            </div>
        </div>
    );
});

export default TableExplorerCustomPager;
