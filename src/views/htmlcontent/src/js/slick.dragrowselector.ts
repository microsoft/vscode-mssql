// Drag select selection model gist taken from https://gist.github.com/skoon/5312536
// heavily modified
declare let Slick;

(function ($: JQueryStatic): void {
	// register namespace
	$.extend(true, window, {
		'Slick': {
			'DragRowSelectionModel': dragRowSelectionModel
		}
	});

	function dragRowSelectionModel(): any {
		const keyColResizeIncr = 5;

		let _grid;
		let _ranges = [];
		let _self = this;
		let _dragging = false;
		let _columnResized = false;

		function init(grid): void {
			_grid = grid;
			_grid.onKeyDown.subscribe(handleKeyDown);
			_grid.onClick.subscribe(handleClick);
			_grid.onDrag.subscribe(handleDrag);
			_grid.onDragInit.subscribe(handleDragInit);
			_grid.onDragStart.subscribe(handleDragStart);
			_grid.onDragEnd.subscribe(handleDragEnd);
			_grid.onHeaderClick.subscribe(handleHeaderClick);
			_grid.onColumnsResized.subscribe(handleColumnsResized);
		}

		function destroy(): void {
			_grid.onKeyDown.unsubscribe(handleKeyDown);
			_grid.onClick.unsubscribe(handleClick);
			_grid.onDrag.unsubscribe(handleDrag);
			_grid.onDragInit.unsubscribe(handleDragInit);
			_grid.onDragStart.unsubscribe(handleDragStart);
			_grid.onDragEnd.unsubscribe(handleDragEnd);
			_grid.onHeaderClick.unsubscribe(handleHeaderClick);
			_grid.onColumnsResized.unsubscribe(handleColumnsResized);
		}

		function rangesToRows(ranges): any {
			let rows = [];
			for (let i = 0; i < ranges.length; i++) {
				for (let j = ranges[i].fromRow; j <= ranges[i].toRow; j++) {
					rows.push(j);
				}
			}
			return rows;
		}

		function rowsToRanges(rows): any {
			let ranges = [];
			let lastCell = _grid.getColumns().length - 1;
			for (let i = 0; i < rows.length; i++) {
				ranges.push(new Slick.Range(rows[i], 0, rows[i], lastCell));
			}
			return ranges;
		}

		function getSelectedRows(): any {
			return rangesToRows(_ranges);
		}

		function setSelectedRows(rows): void {
			setSelectedRanges(rowsToRanges(rows));
		}

		function setSelectedRanges(ranges): void {
			_ranges = ranges;
			_self.onSelectedRangesChanged.notify(_ranges);
		}

		function getSelectedRanges(): any {
			return _ranges;
		}

		function isNavigationKey(e): boolean {
			// Nave keys (home, end, arrows) are all in sequential order so use a
			switch (e.which) {
				case $.ui.keyCode.HOME:
				case $.ui.keyCode.END:
				case $.ui.keyCode.LEFT:
				case $.ui.keyCode.UP:
				case $.ui.keyCode.RIGHT:
				case $.ui.keyCode.DOWN:
					return true;
				default:
					return false;
			}
		}

		function navigateLeft(e, activeCell): void {
			if (activeCell.cell > 1) {
				let isHome = e.which === $.ui.keyCode.HOME;
				let newActiveCellColumn = isHome ? 1 : activeCell.cell - 1;
				let newRangeColumn = newActiveCellColumn;

				if (e.shiftKey) {
					let last = _ranges.pop();

					// If we are on the rightmost edge of the range and we navigate left,
					// we want to deselect the rightmost cell
					if (last.fromCell <= newRangeColumn) { last.toCell -= 1; }

					let fromRow = Math.min(activeCell.row, last.fromRow);
					let fromCell = Math.min(newRangeColumn, last.fromCell);
					let toRow = Math.max(activeCell.row, last.toRow);
					let toCell = Math.max(newRangeColumn, last.toCell);
					_ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
				} else {
					_ranges = [new Slick.Range(activeCell.row, newRangeColumn, activeCell.row, newRangeColumn)];
				}

				_grid.setActiveCell(activeCell.row, newActiveCellColumn);
				setSelectedRanges(_ranges);
			}
		}

		function navigateRight(e, activeCell): void {
			let columnLength = _grid.getColumns().length;
			if (activeCell.cell < columnLength) {
				let isEnd = e.which === $.ui.keyCode.END;
				let newActiveCellColumn = isEnd ? columnLength - 1 : activeCell.cell + 1;
				let newRangeColumn = newActiveCellColumn;
				if (e.shiftKey) {
					let last = _ranges.pop();

					// If we are on the leftmost edge of the range and we navigate right,
					// we want to deselect the leftmost cell
					if (newRangeColumn <= last.toCell) { last.fromCell += 1; }

					let fromRow = Math.min(activeCell.row, last.fromRow);
					let fromCell = Math.min(newRangeColumn, last.fromCell);
					let toRow = Math.max(activeCell.row, last.toRow);
					let toCell = Math.max(newRangeColumn, last.toCell);

					_ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
				} else {
					_ranges = [new Slick.Range(activeCell.row, newRangeColumn, activeCell.row, newRangeColumn)];
				}
				_grid.setActiveCell(activeCell.row, newActiveCellColumn);
				setSelectedRanges(_ranges);
			}
		}

		function handleKeyDown(e): void {
			let activeCell = _grid.getActiveCell();

			if (activeCell) {
				// navigation keys
				if (isNavigationKey(e)) {
					e.stopImmediatePropagation();
					if (e.ctrlKey || e.metaKey) {
						let event = new CustomEvent('gridnav', {
							detail: {
								which: e.which,
								ctrlKey: e.ctrlKey,
								metaKey: e.metaKey,
								shiftKey: e.shiftKey,
								altKey: e.altKey
							}
						});
						window.dispatchEvent(event);
						return;
					}
					// end key
					if (e.which === $.ui.keyCode.END) {
						navigateRight(e, activeCell);
					}
					// home key
					if (e.which === $.ui.keyCode.HOME) {
						navigateLeft(e, activeCell);
					}
					// left arrow
					if (e.which === $.ui.keyCode.LEFT) {
						// column resize
						if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
							let allColumns = JSON.parse(JSON.stringify(_grid.getColumns()));
							allColumns[activeCell.cell - 1].width = allColumns[activeCell.cell - 1].width - keyColResizeIncr;
							_grid.setColumns(allColumns);
						} else {
							navigateLeft(e, activeCell);
						}
						// up arrow
					} else if (e.which === $.ui.keyCode.UP && activeCell.row > 0) {
						if (e.shiftKey) {
							let last = _ranges.pop();

							// If we are on the bottommost edge of the range and we navigate up,
							// we want to deselect the bottommost row
							let newRangeRow = activeCell.row - 1;
							if (last.fromRow <= newRangeRow) { last.toRow -= 1; }

							let fromRow = Math.min(activeCell.row - 1, last.fromRow);
							let fromCell = Math.min(activeCell.cell, last.fromCell);
							let toRow = Math.max(newRangeRow, last.toRow);
							let toCell = Math.max(activeCell.cell, last.toCell);
							_ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
						} else {
							_ranges = [new Slick.Range(activeCell.row - 1, activeCell.cell, activeCell.row - 1, activeCell.cell)];
						}
						_grid.setActiveCell(activeCell.row - 1, activeCell.cell);
						setSelectedRanges(_ranges);
						// right arrow
					} else if (e.which === $.ui.keyCode.RIGHT) {
						// column resize
						if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
							let allColumns = JSON.parse(JSON.stringify(_grid.getColumns()));
							allColumns[activeCell.cell - 1].width = allColumns[activeCell.cell - 1].width + keyColResizeIncr;
							_grid.setColumns(allColumns);
						} else {
							navigateRight(e, activeCell);
						}
						// down arrow
					} else if (e.which === $.ui.keyCode.DOWN && activeCell.row < _grid.getDataLength() - 1) {
						if (e.shiftKey) {
							let last = _ranges.pop();

							// If we are on the topmost edge of the range and we navigate down,
							// we want to deselect the topmost row
							let newRangeRow: number = activeCell.row + 1;
							if (newRangeRow <= last.toRow) { last.fromRow += 1; }

							let fromRow = Math.min(activeCell.row + 1, last.fromRow);
							let fromCell = Math.min(activeCell.cell, last.fromCell);
							let toRow = Math.max(activeCell.row + 1, last.toRow);
							let toCell = Math.max(activeCell.cell, last.toCell);
							_ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
						} else {
							_ranges = [new Slick.Range(activeCell.row + 1, activeCell.cell, activeCell.row + 1, activeCell.cell)];
						}
						_grid.setActiveCell(activeCell.row + 1, activeCell.cell);
						setSelectedRanges(_ranges);
					}
				}
			}
		}

		function handleColumnsResized(e, args): void {
			_columnResized = true;
			setTimeout(function (): void {
				_columnResized = false;
			}, 10);
		}

		function handleHeaderClick(e, args): boolean {
			if (_columnResized) {
				_columnResized = false;
				return true;
			}

			let columnIndex = _grid.getColumnIndex(args.column.id);
			const newActiveRow = _grid.getViewport()?.top ?? 0;
			const newActiveColumn = columnIndex === 0 ? 1 : columnIndex;
			// select all cells if row number header is clicked
			if (columnIndex === 0) {
				_ranges = [new Slick.Range(0, 1, _grid.getDataLength() - 1, _grid.getColumns().length - 1)];
			} else {
				if (e.ctrlKey || e.metaKey) {
					_ranges.push(new Slick.Range(0, columnIndex, _grid.getDataLength() - 1, columnIndex));
				} else if (e.shiftKey && _ranges.length) {
					let last = _ranges.pop().fromCell;
					let from = Math.min(columnIndex, last);
					let to = Math.max(columnIndex, last);
					_ranges = [];
					for (let i = from; i <= to; i++) {
						if (i !== last) {
							_ranges.push(new Slick.Range(0, i, _grid.getDataLength() - 1, i));
						}
					}
					_ranges.push(new Slick.Range(0, last, _grid.getDataLength() - 1, last));
				} else {
					_ranges = [new Slick.Range(0, columnIndex, _grid.getDataLength() - 1, columnIndex)];
				}
			}
			_grid.setActiveCell(newActiveRow, newActiveColumn);
			setSelectedRanges(_ranges);
			e.stopImmediatePropagation();
			return true;
		}

		function handleClick(e): boolean {
			let cell = _grid.getCellFromEvent(e);
			if (!cell || !_grid.canCellBeActive(cell.row, cell.cell)) {
				return false;
			}

			if (cell.cell === 0) {
				e.stopImmediatePropagation();
				_grid.setActiveCell(cell.row, 1);
			}

			if (!e.ctrlKey && !e.shiftKey && !e.metaKey) {
				if (cell.cell !== 0) {
					_ranges = [new Slick.Range(cell.row, cell.cell, cell.row, cell.cell)];
					setSelectedRanges(_ranges);
					_grid.setActiveCell(cell.row, cell.cell);
					return true;
				} else {
					_ranges = [new Slick.Range(cell.row, 1, cell.row, _grid.getColumns().length - 1)];
					setSelectedRanges(_ranges);
					return true;
				}
			} else if (_grid.getOptions().multiSelect) {
				if (e.ctrlKey || e.metaKey) {
					if (cell.cell === 0) {
						_ranges.push(new Slick.Range(cell.row, 1, cell.row, _grid.getColumns().length - 1));
					} else {
						_ranges.push(new Slick.Range(cell.row, cell.cell, cell.row, cell.cell));
						_grid.setActiveCell(cell.row, cell.cell);
					}
				} else if (_ranges.length && e.shiftKey) {
					let last = _ranges.pop();
					if (cell.cell === 0) {
						let fromRow = Math.min(cell.row, last.fromRow);
						let toRow = Math.max(cell.row, last.fromRow);
						_ranges = [new Slick.Range(fromRow, 1, toRow, _grid.getColumns().length - 1)];
					} else {
						let fromRow = Math.min(cell.row, last.fromRow);
						let fromCell = Math.min(cell.cell, last.fromCell);
						let toRow = Math.max(cell.row, last.toRow);
						let toCell = Math.max(cell.cell, last.toCell);
						_ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
					}
				}
			}

			setSelectedRanges(_ranges);

			return true;
		}

		function handleDragInit(e): void {
			e.stopImmediatePropagation();
		}

		function handleDragStart(e): void {
			let cell = _grid.getCellFromEvent(e);
			e.stopImmediatePropagation();
			_dragging = true;
			if (e.ctrlKey || e.metaKey) {
				_ranges.push(new Slick.Range());
				_grid.setActiveCell(cell.row, cell.cell);
			} else if (_ranges.length && e.shiftKey) {
				let last = _ranges.pop();
				let fromRow = Math.min(cell.row, last.fromRow);
				let fromCell = Math.min(cell.cell, last.fromCell);
				let toRow = Math.max(cell.row, last.toRow);
				let toCell = Math.max(cell.cell, last.toCell);
				_ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
			} else {
				_ranges = [new Slick.Range()];
				_grid.setActiveCell(cell.row, cell.cell);
			}
			setSelectedRanges(_ranges);
		}


		function handleDrag(e): boolean {
			if (_dragging) {
				let cell = _grid.getCellFromEvent(e);
				let activeCell = _grid.getActiveCell();
				if (!cell || !_grid.canCellBeActive(cell.row, cell.cell)) {
					return false;
				}

				_ranges.pop();

				if (activeCell.cell === 0) {
					let lastCell = _grid.getColumns().length - 1;
					let firstRow = Math.min(cell.row, activeCell.row);
					let lastRow = Math.max(cell.row, activeCell.row);
					_ranges.push(new Slick.Range(firstRow, 1, lastRow, lastCell));
				} else {
					let firstRow = Math.min(cell.row, activeCell.row);
					let lastRow = Math.max(cell.row, activeCell.row);
					let firstColumn = Math.min(cell.cell, activeCell.cell);
					let lastColumn = Math.max(cell.cell, activeCell.cell);
					_ranges.push(new Slick.Range(firstRow, firstColumn, lastRow, lastColumn));
				}
				setSelectedRanges(_ranges);
			}
		}

		function handleDragEnd(e): void {
			_dragging = false;
		}

		$.extend(this, {
			'getSelectedRows': getSelectedRows,
			'setSelectedRows': setSelectedRows,

			'getSelectedRanges': getSelectedRanges,
			'setSelectedRanges': setSelectedRanges,

			'init': init,
			'destroy': destroy,

			'onSelectedRangesChanged': new Slick.Event()
		});
	}
})($);
