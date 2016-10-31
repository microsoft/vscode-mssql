export declare class Localization {
    strings: {
        addDataSource: string;
        dataSourcePreviewFailed: string;
        addBlock: string;
        blockHistory: string;
        configure: string;
        editPropertiesSubmit: string;
        projectExtension: string;
        projectExtensionName: string;
        projectDefaultName: string;
        projectsFolderName: string;
        createProjectDialogTitle: string;
        saveProjectDialogTitle: string;
        sendFeedback: string;
        openProjectDialogTitle: string;
        appTitle: string;
        appTitleWithProject: string;
        appTitleShort: string;
        contactUs: string;
        submit: string;
        renameActivity: string;
        profiling: string;
        startPageRecent: string;
        startPageWelcome: string;
        startPageWhatsNew: string;
        startPageTutorial: string;
        deriveColumnByExample: string;
        editColumns: string;
        loadingCell: string;
        updateAvailable: string;
        deleteActivityPromptTitle: string;
        deleteActivityPromptMessage: string;
        deleteBlockPromptTitle: string;
        deleteBlockPromptMessage: string;
        loadingData: string;
        statsSummaryHeader: string;
        statsNumRows: string;
        statsMissingRows: string;
        statsHeader: string;
        statsMinimum: string;
        statsLowerQuartile: string;
        statsMedian: string;
        statsUpperQuartile: string;
        statsMaximum: string;
        statsAverage: string;
        statsStandardDeviation: string;
        histogram: string;
        boxPlot: string;
        numericStats: string;
        valueCount: string;
        dataStats: string;
        scatterPlot: string;
        missingInspectorData: string;
        filePickerLabel: string;
        defaultOpenFileDialogTitle: string;
        allFiles: string;
        learnMore: string;
        activityDefaultName: string;
    };
    blocks: {
        'CSVFile': string;
        'JSONFile': string;
        'RDBMS': string;
        'TwoWayJoin': string;
        'Microsoft.DPrep.AdjustColumnPrecisionBlock': string;
        'Microsoft.DPrep.RemoveRowOnColumnMissingValuesBlock': string;
        'Microsoft.DPrep.ConvertColumnFieldTypeBlock': string;
        'Microsoft.DPrep.SelectRowsOnDistinctValuesInColumnBlock': string;
        'Microsoft.DPrep.ColumnRenameBlock': string;
        'Microsoft.DPrep.WriteToCsvBlock': string;
        'Microsoft.DPrep.SummarizeBlock': string;
        'Microsoft.DPrep.FilterBlock': string;
        'Microsoft.DPrep.DeleteColumnBlock': string;
        'Microsoft.DPrep.SortBlock': string;
        'Microsoft.DPrep.ConvertColumnFieldTypeToDateBlock': string;
        'Microsoft.DPrep.DeriveColumnByExample': string;
        'Microsoft.DPrep.AddCustomColumnBlock': string;
        'Microsoft.DPrep.CustomBlock': string;
        'Microsoft.DPrep.AutoSplitColumnBlock': string;
        'Microsoft.DPrep.ConvertColumnFieldTypeToStringBlock': string;
    };
    inspectors: {
        'Microsoft.DPrep.NumericColumnStatsInspector': string;
        'Microsoft.DPrep.HistogramInspector': string;
        'Microsoft.DPrep.ValueCountInspector': string;
        'Microsoft.DPrep.BoxAndWhiskerInspector': string;
        'Microsoft.DPrep.ScatterPlotInspector': string;
    };
    dataSources: {
        CSVFile: string;
        JSONFile: string;
        RDBMS: string;
    };
    properties: {
        addGroup: string;
        columnId: string;
        commentLineCharacter: string;
        customBlock: string;
        customExpression: string;
        database: string;
        databaseType: string;
        decimalPlaces: string;
        decimalPoint: string;
        defaultBucketing: string;
        densityPlot: string;
        descending: string;
        emailAddress: string;
        eol: string;
        examples: string;
        fileEncoding: string;
        filePath: string;
        filterExpression: string;
        groupByColumn: string;
        groupByColumns: string;
        haloEffect: string;
        localPath: string;
        login: string;
        message: string;
        na: string;
        newColumnId: string;
        newColumnsBaseName: string;
        numberOfBreaks: string;
        sampleSize: string;
        numberOfTopValues: string;
        path: string;
        password: string;
        query: string;
        quote: string;
        remotePath: string;
        sampleType: string;
        sasUrl: string;
        separator: string;
        server: string;
        subject: string;
        summaryFunction: string;
        summarizedColumnId: string;
        trustCert: string;
        useColumnHeaders: string;
        userId: string;
        skipRows: string;
    };
    dependencies: {};
    dependenciesSetup: {
        installed: string;
        required: string;
        error: {
            missingDependency: string;
        };
    };
    clusterCredentialsDialog: {
        preface: string;
        url: string;
        userName: string;
        password: string;
        storageAccount: string;
        storageAccessKey: string;
        storageContainer: string;
    };
    projectRunsColumns: {
        projectName: string;
        clusterName: string;
        submitTime: string;
        status: string;
        startedTime: string;
        completedTime: string;
        logsLink: string;
        livyLink: string;
        errorRecordLink: string;
    };
    projectRunsLabels: {
        livyApplication: string;
    };
    projectRunStatus: {};
    projectExportsDialog: {};
    commands: {
        AppQuit: string;
        CreateProject: string;
        OpenProject: string;
        SaveProject: string;
        FileOpen: string;
        ExportScript: string;
        RenameActivity: string;
        DeleteActivity: string;
        CloseProject: string;
        TRACE: string;
        DEBUG: string;
        ERROR: string;
        ToggleDevTools: string;
        RunProjectOnSparkCluster: string;
        ViewProjectRuns: string;
    };
    menuItems: {
        File: string;
        Edit: string;
        DPrep: string;
        Activities: string;
        Transformations: string;
        Inspectors: string;
        Options: string;
        LogLevel: string;
        RunProjectOn: string;
        Help: string;
    };
    blockMenuItems: {
        Edit: string;
        Delete: string;
        MoveUp: string;
    };
    confirmDialog: {
        Ok: string;
        Cancel: string;
    };
    roles: {
        about: string;
        services: string;
        hide: string;
        hideothers: string;
        unhide: string;
        copy: string;
        paste: string;
    };
    dialogTitles: {
        addDataSource: string;
        editProperties: string;
        sendASmile: string;
        confirmDelete: string;
        clusterCredentials: string;
        projectRuns: string;
        join: string;
    };
    enums: {
        DecimalMark: {
            0: string;
            1: string;
        };
        EndOfLineConvention: {
            0: string;
            1: string;
        };
        SummaryFunction: {
            0: string;
            1: string;
            2: string;
            3: string;
            4: string;
            5: string;
            6: string;
            7: string;
            8: string;
            9: string;
            10: string;
            11: string;
        };
        SampleType: {
            0: string;
            1: string;
            2: string;
        };
        DatabaseType: {
            0: string;
            1: string;
        };
        FileEncoding: {
            0: string;
            1: string;
            2: string;
            3: string;
            4: string;
            5: string;
            6: string;
        };
        DatabaseAuthType: {
            0: string;
            1: string;
        };
    };
    dataQuality: {
        missing: string;
        valid: string;
    };
    notifications: {};
    dataTypes: {
        string: string;
        numeric: string;
        datetime: string;
        boolean: string;
    };
    interactiveEditor: {
        commit: string;
        cancel: string;
        columnDragGroupByHint: string;
        columnDragSummaryHint: string;
        groupBy: string;
        aggregate: string;
        column: string;
        newColumn: string;
        previewDataHint: string;
        invalidInteractionArgsError: string;
        previousBlockError: string;
    };
    validationMessages0: {
        'Validation.ColumnNameBlank': string;
    };
    validationMessages1: {
        'Validation.MissingRequiredProperties': string;
        'Validation.NotValidUnknownReason': string;
        'Validation.MissingRequiredProperty': string;
        'Validation.ColumnExists': string;
        'Validation.ColumnNameNotValidNoSuggestion': string;
    };
    validationMessages2: {
        'Validation.ColumnNameNotValid': string;
    };
    activationPage: {
        eulaHeading: string;
        eulaContent: string;
        eulaCheckbox: string;
        privacyHeading: string;
        privacyContent: string;
        privacyCheckbox: string;
        activate: string;
    };
}
