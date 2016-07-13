/*
  sqlOutput.js
  Copyright (c) 2016 Sanjay Nagamangalam and contributors
  @license MIT

  Dynamically constructs HTML page contents with a tab for 'Results' and 'Messages'
  Wires up Backbone models, collections and views to fetch contents from an HTTP end-point

*/

const gNavTabsId = 'sqlOutputTabs';
const gResultsetsMetadataUri = '/resultsetsMeta';
const gMessagesUrl = '/messages';
const gMessagesContainerId = 'messagesContainerId';
const gResultsetContainerId = 'resultsetContainerId';
const gResultsetUriId = 'uri';
const gResultsgridRowsPerPage = 50;
const gPaginatorWindowSize = 15;

var gResultsetsMetadataCollection;
var gSqlOutputView;
var gMessagesCollection;
var gMessagesView;
var uri;

function logStatus(msg)
{
    //$('#log').append(msg);
    //$('#log').append("<br>");
    //console.log(msg);
}

$(document).ready(function() {
    initialize();
});

// called from document.ready()
function initialize()
{
    logStatus('initialize called!');
    initializeEvents();
    initializeSqlOutput();
}

// wire up events
function initializeEvents()
{
    // use jQuery delegated events since the elements we want to watch may not exist in the DOM yet
    $('#' + gNavTabsId).on('shown.bs.tab', $('a[data-toggle="tab"]'), function(e) {
        var currentTabHref = $(e.target).attr('href'); // get current tab href
        var previousTabHref = $(e.relatedTarget).attr('href'); // get previous tab href
        if(currentTabHref == '#tabMessages')
        {
            renderSqlMessages(gMessagesUrl, gMessagesContainerId);
        }
        else if(currentTabHref == '#tabResultset')
        {
            renderSqlResultset();
        }
    });
    uri = $('#' + gResultsetUriId).text().trim();
}

// initialize sql output window and renders 'results' and 'messages' tabs
function initializeSqlOutput()
{
    logStatus('initializeSqlOutput called');
    gResultsetsMetadataCollection = getResultsMetadataCollection(gResultsetsMetadataUri+'?uri='+uri);
    gSqlOutputView = getSqlOutputView(gResultsetsMetadataCollection, gNavTabsId);
    gResultsetsMetadataCollection.fetch({reset: true}).done(function ()
    {
        if(gResultsetsMetadataCollection.length > 0)
        {
            logStatus('initializeSqlOutput, resultset metadata count = ' + gResultsetsMetadataCollection.length);
            logStatus('initializeSqlOutput, showing results tab');
            $('.nav-tabs a[href="#tabResults"]').tab('show')
            renderSqlResultset();
        }
        else
        {
            logStatus('initializeSqlOutput, no resultset metadata, showing messages tab');
            $('.nav-tabs a[href="#tabMessages"]').tab('show');
            renderSqlMessages(gMessagesUrl, gMessagesContainerId);
        }
    });
}

// init resultset metadata collection with given uri
function getResultsMetadataCollection(metadataUrl)
{
    var ResultsetsMetadataModel = Backbone.Model.extend({});
    var ResultsetsMetadataCollection = Backbone.Collection.extend({
        model: ResultsetsMetadataModel,
        url: metadataUrl
    });
    return new ResultsetsMetadataCollection();
}

// creates bootstrap nav tabs based on resultset metadata and dynamically constructs html that looks like the below:
/*
<ul class="nav nav-tabs" id="sqlOutputTabs" margin: 10px>
    <li><a data-toggle="tab" href="#tabResultset">Results</a></li>
    <li class="dropdown active">
        <a class="dropdown-toggle" id="multipleResultsetDropdown" data-toggle="dropdown" href="#">Results<span class="caret"></span></a>
        <ul class="dropdown-menu" id="multipleResultsetDropdownMenu" role="menu" aria-labelledby="multipleResultsetDropdown">
            <li><a href="#tabResultset" data-toggle="tab" resultset="0">Results 1</a></li>
            <li><a href="#tabResultset" data-toggle="tab" resultset="1">Results 2</a></li>
            <li><a href="#tabResultset" data-toggle="tab" resultset="2">Results 3</a></li>
        </ul>
    </li>
    <li><a data-toggle="tab" href="#tabMessages">Messages</a></li>
</ul>
*/
function getSqlOutputView(metadataCollection, htmlContainerId)
{
    logStatus('getSqlOutputView called');

    // initialize view
    var SqlOutputView = Backbone.View.extend({
        el: '#' + htmlContainerId,

        initialize: function ()
        {
            this.listenTo(this.collection, 'reset', this.render);
        },

        render: function ()
        {
            logStatus('constructing nav tabs...');

            // construct nav tabs when resultset metadata changes
            var html = "";

            var length = this.collection.length;
            if(length == 0)
            {
                // no resultsets - don't add a 'results' tab in nav bar
                logStatus('resultset metadata has 0 records - no results tab added');
            }
            else if(length == 1)
            {
                // 1 resultset - add 'results' tab in to nav bar but no drop-down menu
                logStatus('resultset metadata has 1 record, results tab added');
                html += "<li class='active'><a data-toggle='tab' href='#tabResultset'>Results</a></li>";
            }
            else
            {
                // more than 1 resultset - add 'results' tab to nav bar with a drop-down menu
                logStatus('resultset metadata has ' + length + ' records, added results tab with drop-down');

                html += "<li class='dropdown active'>" +
                        "<a class='dropdown-toggle' id='multipleResultsetDropdown' data-toggle='dropdown' href='#'>Results<span class='caret'></span></a>" +
                        "<ul class='dropdown-menu' id='multipleResultsetDropdownMenu' role='menu' aria-labelledby='multipleResultsetDropdown'>";

                for (var index = 0; index < length; index++)
                {
                    html += "<li><a href='#tabResultset' data-toggle='tab' resultset='" + index + "'>Resultset " + (index+1).toString() + "</a></li>";
                }

                html += "</ul></li>";
            }

            // add 'messages' tab
            html += "<li><a data-toggle='tab' href='#tabMessages'>Messages</a></li>";

            this.$el.html(html);
            this.$el.css({});
            return this;
        }
    });

    // create an instance of the view
    var sqlOutputView = new SqlOutputView({
        collection: metadataCollection
    });
    return sqlOutputView;
}

function renderSqlResultset()
{
    logStatus('renderSqlResultset called');
    var resultsetIndex = $("#multipleResultsetDropdownMenu li.active").find("a").attr("resultset");
    logStatus('chosen resultset = ' + resultsetIndex);

    if(gResultsetsMetadataCollection.length > 0)
    {
        if(!resultsetIndex)
        {
            logStatus('resultsetIndex is undefined, resultset metadata collection size should be 1, actual = ' + gResultsetsMetadataCollection.length);
            resultsetIndex = 0;
        }

        var resultset = gResultsetsMetadataCollection.at(resultsetIndex).toJSON();
        var columnsUri = resultset.columnsUri;
        var rowsUri = resultset.rowsUri;
        logStatus('index = ' + resultsetIndex + ', columnsUri = ' + columnsUri + ', rowsUri = ' + rowsUri);

        var columnsCollection = getColumnsCollection(resultset.columnsUri+'&uri='+uri);
        var rowsCollection = getRowsCollection(resultset.rowsUri+'&uri='+uri);
        createGrid("#" + gResultsetContainerId, columnsCollection, rowsCollection);
        logStatus('grid created!');
    }
    else
    {
        logStatus('renderSqlResultset called when there were 0 resultsets - send mail to sanagama2@gmail.com for a repro.');
    }
}

// init column collection with given uri for a specific resultset
function getColumnsCollection(columnsUri)
{
    var columnsCollection = Backgrid.Columns.extend({
        url: columnsUri
    });
    return new columnsCollection();
}

// init row collection with given uri for a specific resultset
function getRowsCollection(rowsUri)
{
    var rowModel = Backbone.Model.extend({});
    var rowsCollection = Backbone.PageableCollection.extend({
        model: rowModel,
        url: rowsUri,
        mode: "client",
        state: {
            pageSize: gResultsgridRowsPerPage // show 50 rows at a time
        }
    });
    return new rowsCollection();
}

// create BackGrid.js grid with filter and paginator to display records from a specific resultset
function createGrid(gridContainerId, columnsCollection, rowsCollection)
{
    logStatus('createGrid called');
    columnsCollection.fetch().done(function ()
    {
        logStatus('fetched ' + columnsCollection.length + ' columns');

        // create grid
        var grid = new Backgrid.Grid({
            columns: columnsCollection,
            collection: rowsCollection,
            emptyText: "No rows to show!"
        });

        // create client-side paginator
        var paginator = new Backgrid.Extension.Paginator({
            windowSize: gPaginatorWindowSize,
            goBackFirstOnSort: false, // don't go back to the first page after sorting
            collection: rowsCollection
        });

        // create client-side full-text filter
        var filter = grid.filter = new Backgrid.Extension.ClientSideFilter({
            collection: rowsCollection,
            fields: null, // full-text search all fields
            name: "q",
            placeholder: "type text to filter results"
        });

        // clear out existing contents of target <div>
        $(gridContainerId).empty();

        // render the filter
        var $filterContainer = $("<div id='filter-container'></div>").appendTo($(gridContainerId));
        $filterContainer.append(filter.render().el);

        // add some space to the filter and move it to the left
        $(filter.el).css({float: "left", margin: "10px"});

        // change z-index of .search from 1000 to 1 to put the search glyph icon behind the result-sets dropdown when it expands
        $(filter.el).css('z-index', '1');

        // render the paginator
        var $paginatorContainer = $("<div id='paginator-container'></div>").appendTo($(gridContainerId));
        $paginatorContainer.append(paginator.render().el);

        // render the grid and attach the root to <div> in HTML document
        $(gridContainerId).append(grid.render().el);

        // fetch rows
        rowsCollection.fetch({reset: true});
    });
}

// init 'messages' collection with given uri
function getMessagesCollection(messagesUri)
{
    var MessagesModel = Backbone.Model.extend({});
    var MessagesCollection = Backbone.Collection.extend({
        model: MessagesModel,
        url: messagesUri
    });
    return new MessagesCollection();
}

function getMessagesView(messagesCollection, htmlContainerId)
{
    var MessagesView = Backbone.View.extend({
        el: "#" + htmlContainerId,

        initialize: function ()
        {
            this.listenTo(this.collection, 'reset', this.render);
        },

        render: function ()
        {
            html = "";
            _.each(this.collection.toJSON(), function(message) {
                 html += "<p>" + message.messageText + "</p>";
            });

            this.$el.html(html);
            this.$el.css({margin: "10px"});
            return this;
        }
    });

    // create an instance of the view
    var messagesView = new MessagesView({
        collection: messagesCollection
    });
    return messagesView;
}

// get 'messages' from the specified uri and render it into the specified <div>
function renderSqlMessages(messagesUri, htmlContainerId)
{
    logStatus('renderSqlMessages called');
    gMessagesCollection = getMessagesCollection(messagesUri+'?uri='+uri);
    gMessagesView = getMessagesView(gMessagesCollection, htmlContainerId);
    gMessagesCollection.fetch({reset: true}).done(function ()
    {
        logStatus('renderSqlMessages, messages count = ' + gMessagesCollection.length);
    });
}