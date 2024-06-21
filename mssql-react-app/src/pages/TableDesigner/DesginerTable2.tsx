import { Button, Popover, PopoverSurface, PopoverTrigger, Table, TableBody, TableCell, TableColumnDefinition, TableColumnSizingOptions, TableHeader, TableHeaderCell, TableRow, Toolbar, ToolbarButton, createTableColumn, makeStyles, useTableColumnSizing_unstable, useTableFeatures } from "@fluentui/react-components"
import { CheckBoxProperties, DesignerDataPropertyInfo, DesignerEditType, DesignerTableComponentDataItem, DesignerTableProperties, DesignerUIArea, DropDownProperties, InputBoxProperties } from "./tableDesignerInterfaces"
import {
	AddRegular, NavigationFilled, DeleteRegular
} from "@fluentui/react-icons";
import { useContext, useState } from "react";
import { TableDesignerContext } from "./TableDesignerStateProvider";
import { DesignerCheckbox } from "./DesignerCheckbox";
import { DesignerDropdown } from "./DesignerDropdown";
import { DesignerInputBox } from "./DesignerInputBox";
import { ErrorCircleFilled } from "@fluentui/react-icons";

export type DesignerTableProps = {
	component: DesignerDataPropertyInfo,
	model: DesignerTableProperties,
	componentPath: (string | number)[],
	UiArea: DesignerUIArea,
	loadPropertiesTabData?: boolean
}

export type ErrorPopupProps = {
	message: string | undefined
}

const useStyles = makeStyles({
	tableCell: {
		display: 'flex',
		flexDirection: 'row',
	}
});

export const DesignerTable2 = ({
	component,
	model,
	componentPath,
	UiArea,
	loadPropertiesTabData = true
}: DesignerTableProps) => {
	const tableProps = component.componentProperties as DesignerTableProperties;
	const state = useContext(TableDesignerContext);
	const classes = useStyles();
	const columnsDef: TableColumnDefinition<DesignerTableComponentDataItem>[] = tableProps.columns!.map((column) => {
		const colProps = tableProps.itemProperties?.find(item => item.propertyName === column);
		return createTableColumn(
			{
				columnId: column,
				renderHeaderCell: () => <>{colProps?.componentProperties.title ?? column}</>
			}
		)
	});
	columnsDef.unshift(createTableColumn({
		columnId: 'dragHandle',
		renderHeaderCell: () => <></>,
	}));

	if (tableProps.canRemoveRows) {
		columnsDef.push(createTableColumn({
			columnId: 'remove',
			renderHeaderCell: () => <>Delete</>
		}));
	}

	const items: DesignerTableComponentDataItem[] = model.data?.map((row) => {
		return row;
	}) ?? [];

	const [columns] = useState<TableColumnDefinition<DesignerTableComponentDataItem>[]>(columnsDef);

	const sizingOptions: TableColumnSizingOptions = {
	};
	tableProps.columns!.forEach((column) => {
		const colProps = tableProps.itemProperties?.find(item => item.propertyName === column);
		sizingOptions[column] = {
			minWidth: (colProps?.componentProperties.width ?? 100) + 30,
			idealWidth: (colProps?.componentProperties.width ?? 100) + 30
		}
	});
	sizingOptions['dragHandle'] = {
		minWidth: 30,
		idealWidth: 30,
		defaultWidth: 30
	};
	sizingOptions['remove'] = {
		minWidth: 100,
		idealWidth: 100,
		defaultWidth: 100
	};

	const [columnSizingOptions] = useState<TableColumnSizingOptions>(sizingOptions);

	const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
		{
			columns,
			items,
		},
		[useTableColumnSizing_unstable({ columnSizingOptions })]
	);

	const rows = getRows();

	const ErrorPopup = ({
		message
	}: ErrorPopupProps) => {
		return (
			<div>
				<div>{message}</div>
			</div>
		);
	};

	const getRowError = (index: number): string | undefined => {
		const issue = state?.state.issues?.find(i => {
			return i.propertyPath!.join('.') === [...componentPath, index].join('.');
		});
		return issue?.description ?? undefined;
	}

	return <div>
		<Toolbar size='small'>
			{model.canAddRows &&
				<ToolbarButton
					icon={<AddRegular />}
					onClick={() => {
						state?.provider.processTableEdit({
							path: [...componentPath, rows.length],
							source: UiArea,
							type: DesignerEditType.Add,
							value: undefined
						})
					}}
				>
					{tableProps.labelForAddNewButton}
				</ToolbarButton>
			}
		</Toolbar>
		<Table
			size="small"
			{...columnSizing_unstable.getTableProps()}
			ref={tableRef}
		>
			<TableHeader>
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
			</TableHeader>
			<TableBody>
				{rows.map((row, index) => {
					return <TableRow draggable

						onFocus={(event) => {
							if (!loadPropertiesTabData) {
								return;
							}
							state?.provider.setPropertiesComponents({
								componentPath: [...componentPath, row.rowId],
								component: component,
								model: model
							});
							event.preventDefault();
						}}
						key={index}>
						{columnsDef.map((column) => {
							const colProps = tableProps.itemProperties?.find(item => item.propertyName === column.columnId);
							const value = row.item[column.columnId];
							switch (column.columnId) {
								case 'dragHandle':
									return <TableCell
										{...columnSizing_unstable.getTableCellProps(column.columnId)}
									>
										{tableProps.canMoveRows && <Button appearance="subtle" size="small" icon={<NavigationFilled />} />}
										{
											getRowError(row.rowId as number) &&
											<Popover>
												<PopoverTrigger disableButtonEnhancement>
													<Button appearance="subtle" icon={<ErrorCircleFilled style={{
														marginTop: '5px'
													}} color="red" />}></Button>
												</PopoverTrigger>

												<PopoverSurface tabIndex={-1}>
													<ErrorPopup message={getRowError(row.rowId as number)} />
												</PopoverSurface>
											</Popover>
										}
									</TableCell>
								case 'remove':
									return <TableCell
										{...columnSizing_unstable.getTableCellProps(column.columnId)}
									>
										<Button disabled={row.item.canBeDeleted ? !row.item.canBeDeleted : false} appearance="subtle" size="small" icon={<DeleteRegular />}
											onClick={async () => {
												state?.provider.processTableEdit({
													path: [...componentPath, row.rowId],
													source: UiArea,
													type: DesignerEditType.Remove,
													value: undefined
												});
											}}
										/>
									</TableCell>
								default: {
									switch (colProps?.componentType) {
										case 'input':
											return <TableCell
												{...columnSizing_unstable.getTableCellProps(column.columnId)}
											>
												<div className={classes.tableCell}>
													<DesignerInputBox
														component={colProps}
														model={value as InputBoxProperties}
														componentPath={[...componentPath, row.rowId, column.columnId]}
														UiArea={UiArea}
														showLabel={false}
														showError={false}
													/>
													{
														state?.provider.getErrorMessage([...componentPath, row.rowId, column.columnId]) &&
														<Popover>
															<PopoverTrigger disableButtonEnhancement>
																<Button appearance="subtle" icon={<ErrorCircleFilled style={{
																	marginTop: '5px'
																}} color="red" />}></Button>
															</PopoverTrigger>

															<PopoverSurface tabIndex={-1}>
																<ErrorPopup message={state?.provider.getErrorMessage([...componentPath, row.rowId, column.columnId])} />
															</PopoverSurface>
														</Popover>
													}
												</div>

											</TableCell>
										case 'dropdown':
											return <TableCell
												{...columnSizing_unstable.getTableCellProps(column.columnId)}
											>
												<div className={classes.tableCell}>
													<DesignerDropdown
														component={colProps}
														model={value as DropDownProperties}
														componentPath={[...componentPath, row.rowId, column.columnId]}
														UiArea={UiArea}
														showLabel={false}
														showError={false}
													/>
													{
														state?.provider.getErrorMessage([...componentPath, row.rowId, column.columnId]) &&
														<Popover>
															<PopoverTrigger disableButtonEnhancement>
																<Button appearance="subtle" icon={<ErrorCircleFilled style={{
																	marginTop: '5px'
																}} color="red" />}></Button>
															</PopoverTrigger>

															<PopoverSurface tabIndex={-1}>
																<ErrorPopup message={state?.provider.getErrorMessage([...componentPath, row.rowId, column.columnId])} />
															</PopoverSurface>
														</Popover>
													}
												</div>
											</TableCell>
										case 'checkbox': {
											return <TableCell
												{...columnSizing_unstable.getTableCellProps(column.columnId)}
											>
												<div className={classes.tableCell}>
													<DesignerCheckbox
														component={colProps}
														model={value as CheckBoxProperties}
														componentPath={[...componentPath, row.rowId, column.columnId]}
														UiArea={UiArea}
														showLabel={false}
													/>
													{
														state?.provider.getErrorMessage([...componentPath, row.rowId, column.columnId]) &&
														<Popover>
															<PopoverTrigger disableButtonEnhancement>
																<Button appearance="subtle" icon={<ErrorCircleFilled style={{
																	marginTop: '5px'
																}} color="red" />}></Button>
															</PopoverTrigger>

															<PopoverSurface tabIndex={-1}>
																<ErrorPopup message={state?.provider.getErrorMessage([...componentPath, row.rowId, column.columnId])} />
															</PopoverSurface>
														</Popover>
													}
												</div>

											</TableCell>
										}
										default:
											return <TableCell
												{...columnSizing_unstable.getTableCellProps(column.columnId)}
											>
												Unknown component type
											</TableCell>
									}
								}
							}
						})}
					</TableRow>;
				})}
			</TableBody>
		</Table>
	</div>
}