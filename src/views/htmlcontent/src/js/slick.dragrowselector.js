// Drag select selection model gist taken from https://gist.github.com/skoon/5312536
// heavily modified
(function ($) {
    // register namespace
    $.extend(true, window, {
        "Slick": {
            "DragRowSelectionModel": DragRowSelectionModel
        }
    });

    function DragRowSelectionModel() {
        const end_key = 35, home_key = 36, left_arrow = 37, up_arrow = 38, right_arrow = 39, down_arrow = 40,
            a_key = 65, c_key = 67, keyColResizeIncr = 5;

        var _grid;
        var _dragStart;
        var _dragRow;
        var _ranges = [];
        var _self = this;
        var _dragging = false;
        var _lastSelectedCell = 0;

        function init(grid) {
            _grid = grid;
            _grid.onActiveCellChanged.subscribe(handleActiveCellChange);
            _grid.onKeyDown.subscribe(handleKeyDown);
            _grid.onClick.subscribe(handleClick);
            _grid.onDrag.subscribe(handleDrag);
            _grid.onDragInit.subscribe(handleDragInit);
            _grid.onDragStart.subscribe(handleDragStart);
            _grid.onDragEnd.subscribe(handleDragEnd);
            _grid.onHeaderClick.subscribe(handleHeaderClick);
        }

        function destroy() {
            _grid.onActiveCellChanged.unsubscribe(handleActiveCellChange);
            _grid.onKeyDown.unsubscribe(handleKeyDown);
            _grid.onClick.unsubscribe(handleClick);
            _grid.onDrag.unsubscribe(handleDrag);
            _grid.onDragInit.unsubscribe(handleDragInit);
            _grid.onDragStart.unsubscribe(handleDragStart);
            _grid.onDragEnd.unsubscribe(handleDragEnd);
            _grid.onHeaderClick.unsubscribe(handleHeaderClick);
        }

        function rangesToRows(ranges) {
            var rows = [];
            for (var i = 0; i < ranges.length; i++) {
                for (var j = ranges[i].fromRow; j <= ranges[i].toRow; j++) {
                    rows.push(j);
                }
            }
            return rows;
        }

        function rowsToRanges(rows) {
            var ranges = [];
            var lastCell = _grid.getColumns().length - 1;
            for (var i = 0; i < rows.length; i++) {
                ranges.push(new Slick.Range(rows[i], 0, rows[i], lastCell));
            }
            return ranges;
        }

        function getRowsRange(from, to) {
            var i, rows = [];
            for (i = from; i <= to; i++) {
                rows.push(i);
            }
            for (i = to; i < from; i++) {
                rows.push(i);
            }
            return rows;
        }

        function getSelectedRows() {
            return rangesToRows(_ranges);
        }

        function setSelectedRows(rows) {
            setSelectedRanges(rowsToRanges(rows));
        }

        function setSelectedRanges(ranges) {
            _ranges = ranges;
            _self.onSelectedRangesChanged.notify(_ranges);
        }

        function getSelectedRanges() {
            return _ranges;
        }

        function handleActiveCellChange(e, data) { }

        function isNavigationKey(e) {
            // Nave keys (home, end, arrows) are all in sequential order so use a
            switch(e.which) {
                case home_key:
                case end_key:
                case left_arrow:
                case up_arrow:
                case right_arrow:
                case down_arrow:
                    return true;
                default:
                    return false;
            }
        }

        function navigateLeft(e, activeCell) {
            if (activeCell.cell > 1) {
                var isHome = e.which == home_key;
                var newActiveCellColumn = isHome ? 1 : activeCell.cell - 1;
                // Unsure why but for range, must record 1 index less than expected
                var newRangeColumn = newActiveCellColumn - 1;

                if (e.shiftKey) {
                    var last = _ranges.pop();

                    // If we are on the rightmost edge of the range and we navigate left,
                    // we want to deselect the rightmost cell
                    if (last.fromCell <= newRangeColumn) { last.toCell -= 1; }

                    var fromRow = Math.min(activeCell.row, last.fromRow);
                    var fromCell = Math.min(newRangeColumn, last.fromCell);
                    var toRow = Math.max(activeCell.row, last.toRow);
                    var toCell = Math.max(newRangeColumn, last.toCell);
                    _ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
                } else {
                    _ranges = [new Slick.Range(activeCell.row, newRangeColumn, activeCell.row, newRangeColumn)];
                }

                _grid.setActiveCell(activeCell.row, newActiveCellColumn);
                setSelectedRanges(_ranges);
            }
        }

        function navigateRight(e, activeCell) {
            var columnLength = _grid.getColumns().length;
            if (activeCell.cell < columnLength) {
                var isEnd = e.which == end_key;
                var newActiveCellColumn = isEnd ? columnLength : activeCell.cell + 1;
                // Unsure why but for range, must record 1 index less than expected
                var newRangeColumn = newActiveCellColumn - 1;
                if (e.shiftKey) {
                    var last = _ranges.pop();

                    // If we are on the leftmost edge of the range and we navigate right,
                    // we want to deselect the leftmost cell
                    if (newRangeColumn <= last.toCell) { last.fromCell += 1; }

                    var fromRow = Math.min(activeCell.row, last.fromRow);
                    var fromCell = Math.min(newRangeColumn, last.fromCell);
                    var toRow = Math.max(activeCell.row, last.toRow);
                    var toCell = Math.max(newRangeColumn, last.toCell);

                    _ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
                } else {
                    _ranges = [new Slick.Range(activeCell.row, newRangeColumn, activeCell.row, newRangeColumn)];
                }
                _grid.setActiveCell(activeCell.row, newActiveCellColumn);
                setSelectedRanges(_ranges);
            }
        }

        function handleKeyDown(e) {
            var activeCell = _grid.getActiveCell();

            if (activeCell) {
                // navigation keys
                if (isNavigationKey(e)) {
                    e.stopImmediatePropagation();
                    if (e.ctrlKey || e.metaKey) {
                        var event = new CustomEvent('gridnav',{
                            detail: {
                                which: e.which,
                                ctrlKey: e.ctrlKey,
                                metaKey: e.metaKey,
                                shiftKey: e.shiftKey,
                                altKey: e.altKey
                            }
                        })
                        window.dispatchEvent(event);
                        return;
                    }
                    // end key
                    if (e.which == end_key) {
                        navigateRight(e, activeCell);
                    }
                    // home key
                    if (e.which == home_key) {
                        navigateLeft(e, activeCell);
                    }
                    // left arrow
                    if (e.which == left_arrow) {
                        // column resize
                        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                            var allColumns = JSON.parse(JSON.stringify(_grid.getColumns()));
                            allColumns[activeCell.cell - 1].width = allColumns[activeCell.cell - 1].width - keyColResizeIncr;
                            _grid.setColumns(allColumns);
                        } else {
                            navigateLeft(e, activeCell);
                        }
                    // up arrow
                    } else if (e.which == up_arrow && activeCell.row > 0) {
                        if (e.shiftKey) {
                            var last = _ranges.pop();

                            // If we are on the bottommost edge of the range and we navigate up,
                            // we want to deselect the bottommost row
                            var newRangeRow = activeCell.row - 1;
                            if (last.fromRow <= newRangeRow) { last.toRow -= 1; }

                            var fromRow = Math.min(activeCell.row - 1, last.fromRow);
                            var fromCell = Math.min(activeCell.cell - 1, last.fromCell);
                            var toRow = Math.max(newRangeRow, last.toRow);
                            var toCell = Math.max(activeCell.cell - 1, last.toCell);
                            _ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
                        } else {
                            _ranges = [new Slick.Range(activeCell.row - 1, activeCell.cell - 1, activeCell.row - 1, activeCell.cell - 1)];
                        }
                        _grid.setActiveCell(activeCell.row - 1, activeCell.cell);
                        setSelectedRanges(_ranges);
                    // right arrow
                    } else if (e.which == right_arrow) {
                        // column resize
                        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                            var allColumns = JSON.parse(JSON.stringify(_grid.getColumns()));
                            allColumns[activeCell.cell - 1].width = allColumns[activeCell.cell - 1].width + keyColResizeIncr;
                            _grid.setColumns(allColumns);
                        } else {
                            navigateRight(e, activeCell);
                        }
                    // down arrow
                    } else if (e.which == down_arrow && activeCell.row < _grid.getDataLength() - 1) {
                        if (e.shiftKey) {
                            var last = _ranges.pop();

                            // If we are on the topmost edge of the range and we navigate down,
                            // we want to deselect the topmost row
                            var newRangeRow = activeCell.row + 1;
                            if (newRangeRow <= last.toRow) { last.fromRow +=1; }

                            var fromRow = Math.min(activeCell.row + 1, last.fromRow);
                            var fromCell = Math.min(activeCell.cell - 1, last.fromCell)
                            var toRow = Math.max(activeCell.row + 1, last.toRow);
                            var toCell = Math.max(activeCell.cell - 1, last.toCell);
                            _ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
                        } else {
                        _ranges = [new Slick.Range(activeCell.row + 1, activeCell.cell - 1, activeCell.row + 1, activeCell.cell - 1)];
                        }
                        _grid.setActiveCell(activeCell.row + 1, activeCell.cell);
                        setSelectedRanges(_ranges);
                    }
                }
            }
        }

        function handleHeaderClick(e, args) {
            var columnIndex = _grid.getColumnIndex(args.column.id);
            if (e.ctrlKey || e.metaKey){
                _ranges.push(new Slick.Range(0, columnIndex, _grid.getDataLength()-1, columnIndex));
                _grid.setActiveCell(0, columnIndex + 1);
            } else if (e.shiftKey && _ranges.length) {
                var last = _ranges.pop().fromCell;
                var from = Math.min(columnIndex, last);
                var to = Math.max(columnIndex, last);
                _ranges = [];
                for (var i = from; i <= to; i++) {
                    if (i !== last) {
                        _ranges.push(new Slick.Range(0, i, _grid.getDataLength()-1, i));
                    }
                }
                _ranges.push(new Slick.Range(0, last, _grid.getDataLength()-1, last));
            } else {
                _ranges = [new Slick.Range(0, columnIndex, _grid.getDataLength()-1, columnIndex)];
                _grid.setActiveCell(0, columnIndex + 1);
            }
            setSelectedRanges(_ranges);
            e.stopImmediatePropagation();
            return true;
        }

        function handleClick(e) {
            var cell = _grid.getCellFromEvent(e);
            if (!cell || !_grid.canCellBeActive(cell.row, cell.cell)) {
                return false;
            }

            if (!e.ctrlKey && !e.shiftKey && !e.metaKey) {
                if (cell.cell !== 0) {
                    _ranges = [new Slick.Range(cell.row, cell.cell-1, cell.row, cell.cell-1)];
                    setSelectedRanges(_ranges);
                    _grid.setActiveCell(cell.row, cell.cell);
                    return true;
                } else {
                    _ranges = [new Slick.Range(cell.row, 0, cell.row, _grid.getColumns().length - 1)]
                    setSelectedRanges(_ranges);
                    _grid.setActiveCell(cell.row, 1);
                    return true;
                }
            }
            else if (_grid.getOptions().multiSelect) {
                if (e.ctrlKey || e.metaKey) {
                    if (cell.cell === 0) {
                        _ranges.push(new Slick.Range(cell.row, 0, cell.row, _grid.getColumns().length - 1));
                        _grid.setActiveCell(cell.row, 1);
                    } else {
                        _ranges.push(new Slick.Range(cell.row, cell.cell-1, cell.row, cell.cell-1));
                        _grid.setActiveCell(cell.row, cell.cell);
                    }
                } else if (_ranges.length && e.shiftKey) {
                    var last = _ranges.pop();
                    if (cell.cell === 0) {
                        var fromRow = Math.min(cell.row, last.fromRow);
                        var toRow = Math.max(cell.row, last.fromRow);
                        _ranges = [new Slick.Range(fromRow, 0, toRow, _grid.getColumns().length - 1)];
                    } else {
                        var fromRow = Math.min(cell.row, last.fromRow);
                        var fromCell = Math.min(cell.cell-1, last.fromCell)
                        var toRow = Math.max(cell.row, last.toRow);
                        var toCell = Math.max(cell.cell-1, last.toCell);
                        _ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
                    }
                }
            }

            setSelectedRanges(_ranges);

            return true;
        }

        function handleDragInit(e) {
            e.stopImmediatePropagation();
        }

        function handleDragStart(e) {
            var cell = _grid.getCellFromEvent(e);
            e.stopImmediatePropagation();
            _dragging = true;
            if (e.ctrlKey || e.metaKey) {
                _ranges.push(new Slick.Range());
                _grid.setActiveCell(cell.row, cell.cell);
            } else if (_ranges.length && e.shiftKey) {
                var last = _ranges.pop();
                var fromRow = Math.min(cell.row, last.fromRow);
                var fromCell = Math.min(cell.cell-1, last.fromCell)
                var toRow = Math.max(cell.row, last.toRow);
                var toCell = Math.max(cell.cell-1, last.toCell);
                _ranges = [new Slick.Range(fromRow, fromCell, toRow, toCell)];
            } else {
                _ranges = [new Slick.Range()];
                _grid.setActiveCell(cell.row, cell.cell);
            }
            setSelectedRanges(_ranges);
        }


        function handleDrag(e) {
            if (_dragging) {
                var cell = _grid.getCellFromEvent(e);
                var activeCell = _grid.getActiveCell();
                if (!cell || !_grid.canCellBeActive(cell.row, cell.cell))
                    return false;

                _ranges.pop();

                if (activeCell.cell === 0) {
                    var lastCell = _grid.getColumns().length - 1;
                    var firstRow = Math.min(cell.row, activeCell.row);
                    var lastRow = Math.max(cell.row, activeCell.row);
                    _ranges.push(new Slick.Range(firstRow, 0, lastRow, lastCell));
                } else {
                    var firstRow = Math.min(cell.row, activeCell.row);
                    var lastRow = Math.max(cell.row, activeCell.row);
                    var firstColumn = Math.min(cell.cell-1, activeCell.cell-1);
                    var lastColumn = Math.max(cell.cell-1, activeCell.cell-1);
                    _ranges.push(new Slick.Range(firstRow, firstColumn, lastRow, lastColumn));
                }
                setSelectedRanges(_ranges);
            }
        }

        function handleDragEnd(e) {
            _dragging = false;
        }

        $.extend(this, {
            "getSelectedRows": getSelectedRows,
            "setSelectedRows": setSelectedRows,

            "getSelectedRanges": getSelectedRanges,
            "setSelectedRanges": setSelectedRanges,

            "init": init,
            "destroy": destroy,

            "onSelectedRangesChanged": new Slick.Event()
        });
    }
})(jQuery);