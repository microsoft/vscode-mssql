/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, CounterBadge, Divider, Tab, TabList, Table, TableBody, TableCell, TableColumnDefinition, TableColumnSizingOptions, TableHeader, TableHeaderCell, TableRow, Theme, createTableColumn, makeStyles, shorthands, teamsHighContrastTheme, useTableColumnSizing_unstable, useTableFeatures, webDarkTheme } from "@fluentui/react-components";
import { useContext, useState } from "react";
import { OpenFilled } from "@fluentui/react-icons";
import { QueryResultContext } from "./queryResultStateProvider";
import * as qr from '../../../sharedInterfaces/queryResult';
import { useVscodeWebview } from '../../common/vscodeWebViewProvider';

const useStyles = makeStyles({
	root: {
		width: '100%',
		height: '100%',
		display: 'flex',
		flexDirection: 'column',
	},
	ribbon: {
		width: '100%',
		display: 'flex',
		flexDirection: 'row',
		'> *': {
			marginRight: '10px'
		},
	},
	queryResultPaneTabs: {
		flex: 1,
	},
	tabContent: {
		...shorthands.flex(1),
		width: '100%',
		height: '100%',
		display: 'flex',
		...shorthands.overflow('auto'),
	},
	queryResultContainer: {
		width: '100%',
		height: '100%',
		position: 'relative',
	},
	queryResultPaneOpenButton: {
		position: 'absolute',
		top: '0px',
		right: '0px',
	},
	messagesContainer: {
		width: '100%',
		height: '100%',
		flexDirection: 'column',
		'> *': {
			marginBottom: '10px'
		},

	},
	messagesRows: {
		flexDirection: 'row',
		...shorthands.padding('10px'),
		'> *': {
			marginRight: '10px'
		},
	}
});

export const QueryResultPane = () => {
	const classes = useStyles();
	const state = useContext(QueryResultContext);
	const webViewState = useVscodeWebview<qr.QueryResultWebViewState, qr.QueryResultReducers>();
	webViewState;
	var metadata = state?.state;

	const getVscodeTheme = (theme: Theme) => {

		switch (theme) {
			case webDarkTheme:
				return 'vs-dark';
			case teamsHighContrastTheme:
				return 'hc-black';
			default:
				return 'light';
		}
	};

	getVscodeTheme;

	const columnsDef: TableColumnDefinition<qr.QueryResultMessage>[] = [
		createTableColumn({
			columnId: 'timestamp',
			renderHeaderCell: () => <>Timestamp</>
		}),
		createTableColumn({
			columnId: 'message',
			renderHeaderCell: () => <>Message</>
		}),
	];
	const [columns] = useState<TableColumnDefinition<qr.QueryResultMessage>[]>(columnsDef);
	const items = metadata?.messages ?? [];

	const sizingOptions: TableColumnSizingOptions = {
		'timestamp': {
			minWidth: 50,
			idealWidth: 50,
			defaultWidth: 50
		},
		'message': {
			minWidth: 500,
			idealWidth: 500,
			defaultWidth: 500
		}
	};

	const [columnSizingOption] = useState<TableColumnSizingOptions>(sizingOptions);
	const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
		{
			columns,
			items: items
		},
		[useTableColumnSizing_unstable({ columnSizingOptions: columnSizingOption })]
	);
	const rows = getRows();

	if (!metadata) {
		return null;
	}

	return <div className={classes.root}>
		<div className={classes.ribbon}>
			<TabList
				size='medium'
				selectedValue={metadata.tabStates!.resultPaneTab}
				onTabSelect={(_event, data) => {
					state.provider.setResultTab(data.value as qr.QueryResultPaneTabs);
				}}
				className={classes.queryResultPaneTabs}
			>
				<Tab value={qr.QueryResultPaneTabs.Results} key={qr.QueryResultPaneTabs.Results}>
					Results
				</Tab>
				<Tab value={qr.QueryResultPaneTabs.Messages} key={qr.QueryResultPaneTabs.Messages}
				>
					Messages
				</Tab>
			</TabList>
			{
				metadata.tabStates!.resultPaneTab == qr.QueryResultPaneTabs.Results &&
				<Divider vertical style={{
					flex: '0'
				}} />
			}

			{
				<Button appearance="transparent" icon={<OpenFilled />} onClick={() => console.log('todo: open in new tab')} title='Open in new tab'></Button>
			}
		</div>
		<div className={classes.tabContent}>
			{metadata.tabStates!.resultPaneTab === qr.QueryResultPaneTabs.Results &&
				<div className={classes.queryResultContainer}>
					<h1>queryResultContainer</h1>
				</div>
			}
			{metadata.tabStates!.resultPaneTab === qr.QueryResultPaneTabs.Messages && <div className={classes.messagesContainer}>
				<Table size="small"
					as = "table"
					{...columnSizing_unstable.getTableProps()}
					ref={tableRef}
				>
					{/* <TableHeader>
						<TableRow>
							{
								columnsDef.map((column) => {
									return <TableHeaderCell
										{...columnSizing_unstable.getTableHeaderCellProps(column.columnId)}
										key={column.columnId}>
										{column.renderHeaderCell()}
									</TableHeaderCell>
								})
							}
						</TableRow>
					</TableHeader> */}
					<TableBody>
						{
							rows.map((row, index) => {
								return <TableRow key={index}>
									<TableCell
										{...columnSizing_unstable.getTableCellProps('timestamp')}
										>{row.item.timestamp}</TableCell>
										<TableCell
										{...columnSizing_unstable.getTableCellProps('description')}
									>{row.item.message}</TableCell>
								</TableRow>
							})
						}
					</TableBody>
				</Table>
			</div>
			}
		</div>
	</div>
}