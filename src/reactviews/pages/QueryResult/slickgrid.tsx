/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import $ from 'jquery';
import { useEffect, useRef } from 'react';
import '../../../../media/slickgrid.css';
import { Table } from './table/table';
import { TableDataView } from './table/tableDataView';
import { defaultTableStyles } from './table/interfaces';

window.jQuery = $ as any;
require('slickgrid/lib/jquery.event.drag-2.3.0.js');
require('slickgrid/lib/jquery-1.11.2.min.js');
require('slickgrid/slick.core.js');
require('slickgrid/slick.grid.js');
require('slickgrid/plugins/slick.cellrangedecorator.js');

//TODO: get hardcoded data & get gridpanel to render the hardcoded data
// add console.log in the event handlers for example to onTableClick function

declare global {
    interface Window {
        $: any;
        jQuery: any;
    }
}

export default function SlickGrid() {

    const ref = useRef<HTMLDivElement>(null);

    useEffect(() =>{
        const ROW_HEIGHT = 25;
        let columns = [
        {id: "title", name: "Title", field: "title"},
        {id: "duration", name: "Duration", field: "duration"},
        {id: "%", name: "% Complete", field: "percentComplete"},
        {id: "start", name: "Start", field: "start"},
        {id: "finish", name: "Finish", field: "finish"},
        {id: "effort-driven", name: "Effort Driven", field: "effortDriven"}
        ];
        // let options = {
        //     enableCellNavigation: true,
        //     enableColumnReorder: false
        // };
        let data = [];
        for (var i = 0; i < 500; i++) {
            data[i] = {
                title: "Task " + i,
                duration: "5 days",
                percentComplete: Math.round(Math.random() * 100),
                start: "01/01/2009",
                finish: "01/05/2009",
                effortDriven: (i % 5 === 0)
            };
        }


        let div = document.createElement('div');
        div.id = 'grid';
		div.className = 'grid-panel';
		div.style.display = 'inline-block';

        //TODO: eventually need to calculate snapshot button width and subtract
		// let actionBarWidth = this.showActionBar ? ACTIONBAR_WIDTH : 0;
		// this.tableContainer.style.width = `calc(100% - ${actionBarWidth}px)`;



        let tableOptions: Slick.GridOptions<T> = {
			rowHeight: ROW_HEIGHT,
			showRowNumber: true,
			forceFitColumns: false,
			defaultColumnWidth: 120
		};

        //TODO: use hybriddataprovider here
        let tableData = new TableDataView(data);

        new Table(div, defaultTableStyles, { dataProvider: tableData, columns: columns });
        let grid = document.body.appendChild(div);
        const elm = document.getElementById('grid')!;
        document.body.removeChild(grid);
        ref.current?.appendChild(elm);
    }, []);

    return <div ref = {ref}></div>;
  }

