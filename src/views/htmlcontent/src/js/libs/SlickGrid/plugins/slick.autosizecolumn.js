// Adapted from https://github.com/naresh-n/slickgrid-column-data-autosize/blob/master/src/slick.autocolumnsize.js

(function($) {

    $.extend(true, window, {
        "Slick": {
            "AutoColumnSize": AutoColumnSize
        }
    });

    function AutoColumnSize(maxWidth) {

        var grid, $container, context;

        function init(_grid) {
            grid = _grid;
            maxWidth = maxWidth || 200;

            $container = $(grid.getContainerNode());
            $container.on("dblclick.autosize", ".slick-resizable-handle", reSizeColumn);
            context = document.createElement("canvas").getContext("2d");
        }

        function destroy() {
            $container.off();
        }

        function reSizeColumn(e) {
            var headerEl = $(e.currentTarget).closest('.slick-header-column');
            var columnDef = headerEl.data('column');

            if (!columnDef || !columnDef.resizable) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            var headerWidth = getElementWidth(headerEl[0]);
            var colIndex = grid.getColumnIndex(columnDef.id);
            var origCols = grid.getColumns();
            var allColumns = JSON.parse(JSON.stringify(origCols));
            for (let [index, col] of allColumns.entries()) {
                col.formatter = origCols[index].formatter;
                col.asyncPostRender = origCols[index].asyncPostRender;
            }
            var column = allColumns[colIndex];

            var autoSizeWidth = Math.max(headerWidth, getMaxColumnTextWidth(columnDef, colIndex)) + 1;

            if (autoSizeWidth !== column.width) {
                allColumns[colIndex].width = autoSizeWidth;
                grid.setColumns(allColumns);
                grid.onColumnsResized.notify();
            }
        }

        function getMaxColumnTextWidth(columnDef, colIndex) {
            var texts = [];
            var rowEl = createRow(columnDef);
            var data = grid.getData();
            var numOfCol = grid.getColumns().length - 1;
            var viewPort = grid.getViewport();
            var start = Math.max(0, viewPort.top + 1);
            var end = Math.min(data.getLength(), viewPort.bottom);
            for (var i = start; i < end; i++) {
                texts.push(data.getItem(i)[columnDef.field]);
            }
            var template = getMaxTextTemplate(texts, columnDef, colIndex, data, rowEl);
            var width = getTemplateWidth(rowEl, template);
            deleteRow(rowEl);
            return width;
        }

        function getTemplateWidth(rowEl, template) {
            var cell = $(rowEl.find(".slick-cell"));
            cell.append(template);
            $(cell).find("*").css("position", "relative");
            return cell.outerWidth() + 1;
        }

        function getMaxTextTemplate(texts, columnDef, colIndex, data, rowEl) {
            var max = 0,
                maxTemplate = null;
            var formatFun = columnDef.formatter;
            $(texts).each(function(index, text) {
                var template;
                if (formatFun) {
                    template = $("<span>" + formatFun(index, colIndex, text, columnDef, data[index]) + "</span>");
                    text = template.text() || text;
                }
                var length = text ? getElementWidthUsingCanvas(rowEl, text) : 0;
                if (length > max) {
                    max = length;
                    maxTemplate = template || text;
                }
            });
            return maxTemplate;
        }

        function createRow(columnDef) {
            var rowEl = $('<div class="slick-row"><div class="slick-cell"></div></div>');
            rowEl.find(".slick-cell").css({
                "visibility": "hidden",
                "text-overflow": "initial",
                "white-space": "nowrap"
            });
            var gridCanvas = $container.find(".grid-canvas");
            $(gridCanvas).append(rowEl);
            return rowEl;
        }

        function deleteRow(rowEl) {
            $(rowEl).remove();
        }

        function getElementWidth(element) {
            var width, clone = element.cloneNode(true);
            clone.style.cssText = 'position: absolute; visibility: hidden;right: auto;text-overflow: initial;white-space: nowrap;';
            element.parentNode.insertBefore(clone, element);
            width = clone.offsetWidth;
            clone.parentNode.removeChild(clone);
            return width;
        }

        function getElementWidthUsingCanvas(element, text) {
            context.font = element.css("font-size") + " " + element.css("font-family");
            var metrics = context.measureText(text);
            return metrics.width;
        }

        return {
            init: init,
            destroy: destroy
        };
    }
}(jQuery));