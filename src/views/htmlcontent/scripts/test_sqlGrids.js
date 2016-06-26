/*
  test_sqlGrids.js
  Copyright (c) 2016 Sanjay Nagamangalam and contributors
  @license MIT

  Currently not used in this extension - for reference only.
  Renders all resultsets in separate grids in the 'Results' tab instead of loading them from the 'Results' tab dropdown.
*/

// init collection with given uri
function getResultsetsCollection(resultsetsUri)
{
    var ResultsetsModel = Backbone.Model.extend({});
    var ResultsetsCollection = Backbone.Collection.extend({
        model: ResultsetsModel,
        url: resultsetsUri
    });
    return new ResultsetsCollection();
}

// init column collection with given uri
function getColumnsCollection(columnsUri)
{
    var columnsCollection = Backgrid.Columns.extend({
        url: columnsUri
    });
    return new columnsCollection();
}

// init row collection with given uri
function getRowsCollection(rowsUri)
{
    var rowModel = Backbone.Model.extend({});
    var rowsCollection = Backbone.Collection.extend({
        model: rowModel,
        url: rowsUri
    });
    return new rowsCollection();
}

function createGrid(gridContainerId, columnsCollection, rowsCollection)
{
    columnsCollection.fetch().done(function ()
    {
        var grid = new Backgrid.Grid({
            columns: columnsCollection,
            collection: rowsCollection,
            emptyText: "No rows to show!"
        });

        // Initialize client-side full-text filter
        var filter = grid.filter = new Backgrid.Extension.ClientSideFilter({
            collection: rowsCollection,
            fields: null // full-text search all fields
        });

        // Render the filter
        var $filterContainer = $("<div id='filter-container'></div>").appendTo($(gridContainerId));
        $filterContainer.append(filter.render().el);

        // Add some space to the filter and move it to the left
        $(filter.el).css({float: "left", margin: "10px"});

        // Render the grid and attach the root to <div> in HTML document
        $(gridContainerId).append(grid.render().el);
        rowsCollection.fetch({reset: true});
    });
}

function renderSqlResultsets(resultsetsUri, resultsContainerId)
{
    // fetch the resultsets collection
    var collection = getResultsetsCollection(resultsetsUri);
    collection.fetch({reset: true}).done( function() {

        // iterate collection and create a new <div> and a new grid for each resultset
        var resultsets = collection.toJSON();
        var gridContainerPrefix = "grid";
        _.each(resultsets, function(resultset, index, resultsets)
        {
            var gridContainerId =  gridContainerPrefix + index.toString();
            var gridContainerDiv = "<div id='" + gridContainerId + "'></div><hr>";
            var gridContainer = $(gridContainerDiv).appendTo($("#" + resultsContainerId));

            var columnsCollection = getColumnsCollection(resultset.columnsUri);
            var rowsCollection = getRowsCollection(resultset.rowsUri);
            createGrid("#" + gridContainerId, columnsCollection, rowsCollection);
        });
    });
}