// Adapted from https://github.com/naresh-n/slickgrid-column-data-autosize/blob/master/src/slick.autocolumnsize.js
(function($: JQueryStatic): void {

    $.extend(true, window, {
        'Slick': {
            'AutoColumnSize': autoColumnSize
        }
    });

    function autoColumnSize(maxWidth): any {

        let grid: any;
        let $container: JQuery;
        let context: CanvasRenderingContext2D;

        function init(_grid): void {
            grid = _grid;
            maxWidth = maxWidth || 200;

            $container = $(grid.getContainerNode());
            $container.on('dblclick.autosize', '.slick-resizable-handle', reSizeColumn);
            context = document.createElement('canvas').getContext('2d');
        }

        function destroy(): void {
            $container.off();
        }

        function reSizeColumn(e): void {
            let headerEl = $(e.currentTarget).closest('.slick-header-column');
            let columnDef = headerEl.data('column');

            if (!columnDef || !columnDef.resizable) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            let headerWidth = getElementWidth(headerEl[0]);
            let colIndex = grid.getColumnIndex(columnDef.id);
            let origCols = grid.getColumns();
            let allColumns = JSON.parse(JSON.stringify(origCols));
            for (let [index, col] of allColumns.entries()) {
                col.formatter = origCols[index].formatter;
                col.asyncPostRender = origCols[index].asyncPostRender;
            }
            let column = allColumns[colIndex];

            let autoSizeWidth = Math.max(headerWidth, getMaxColumnTextWidth(columnDef, colIndex)) + 1;

            if (autoSizeWidth !== column.width) {
                allColumns[colIndex].width = autoSizeWidth;
                grid.setColumns(allColumns);
                grid.onColumnsResized.notify();
            }
        }

        function getMaxColumnTextWidth(columnDef, colIndex): number {
            let texts = [];
            let rowEl = createRow(columnDef);
            let data = grid.getData();
            let viewPort = grid.getViewport();
            let start = Math.max(0, viewPort.top + 1);
            let end = Math.min(data.getLength(), viewPort.bottom);
            for (let i = start; i < end; i++) {
                texts.push(data.getItem(i)[columnDef.field]);
            }
            let template = getMaxTextTemplate(texts, columnDef, colIndex, data, rowEl);
            let width = getTemplateWidth(rowEl, template);
            deleteRow(rowEl);
            return width;
        }

        function getTemplateWidth(rowEl, template): number {
            let cell = $(rowEl.find('.slick-cell'));
            cell.append(template);
            $(cell).find('*').css('position', 'relative');
            return cell.outerWidth() + 1;
        }

        function getMaxTextTemplate(texts, columnDef, colIndex, data, rowEl): any {
            let max = 0,
                maxTemplate = undefined;
            let formatFun = columnDef.formatter;
            $.each<string>(texts, function(index, text): void {
                let template: JQuery;
                if (formatFun) {
                    template = $('<span>' + formatFun(index, colIndex, text, columnDef, data[index]) + '</span>');
                    text = template.text() || text;
                }
                let length = text ? getElementWidthUsingCanvas(rowEl, text) : 0;
                if (length > max) {
                    max = length;
                    maxTemplate = template || text;
                }
            });
            return maxTemplate;
        }

        function createRow(columnDef): JQuery {
            let rowEl = $('<div class="slick-row"><div class="slick-cell"></div></div>');
            rowEl.find('.slick-cell').css({
                'visibility': 'hidden',
                'text-overflow': 'initial',
                'white-space': 'nowrap'
            });
            let gridCanvas = $container.find('.grid-canvas');
            $(gridCanvas).append(rowEl);
            return rowEl;
        }

        function deleteRow(rowEl): void {
            $(rowEl).remove();
        }

        function getElementWidth(element): number {
            let width, clone = element.cloneNode(true);
            clone.style.cssText = 'position: absolute; visibility: hidden;right: auto;text-overflow: initial;white-space: nowrap;';
            element.parentNode.insertBefore(clone, element);
            width = clone.offsetWidth;
            clone.parentNode.removeChild(clone);
            return width;
        }

        function getElementWidthUsingCanvas(element, text): number {
            context.font = element.css('font-size') + ' ' + element.css('font-family');
            let metrics = context.measureText(text);
            return metrics.width;
        }

        return {
            init: init,
            destroy: destroy
        };
    }
}(jQuery));
