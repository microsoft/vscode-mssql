BEGIN TRY
    BEGIN TRANSACTION T4bb25d3d835645a38749054e3a316de
        USE [Verify_Hierarchy_Baseline_Sqlv150'']]]]]]'{a15a7e31-47ab-48f4-a380-42279406d3ed}];
        CREATE DATABASE SCOPED CREDENTIAL [sa]
            WITH IDENTITY = N'sa', SECRET = N'<fixture-secret>';
        CREATE EXTERNAL DATA SOURCE [MyDs]
            WITH (LOCATION = N'sqlserver://sqltools2017-3', CREDENTIAL = [sa]);
        EXEC(N'CREATE SCHEMA []]]]]]]]dbo[[[]');
        CREATE EXTERNAL TABLE []]]]]]]]dbo[[[].[test[table]]]
        (
            [c[o]]l1] INT
        )
        WITH (LOCATION = N'[keep_genetest]]].[dbo].[test[table]]]', DATA_SOURCE = [MyDs]);
        EXEC(N'CREATE SCHEMA [[[]]]]]]]]]]dbo[[[]');
        CREATE EXTERNAL TABLE [[[]]]]]]]]]]dbo[[[].[Table1]
        (
            [Id] INT NOT NULL,
            [a] NVARCHAR(50) COLLATE Latin1_General_CS_AS
        )
        WITH (LOCATION = N'[keep_chlafren].[dbo].[Table1]', DATA_SOURCE = [MyDs]);
    COMMIT TRANSACTION T4bb25d3d835645a38749054e3a316de
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION T4bb25d3d835645a38749054e3a316de
    DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
    DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
    DECLARE @ErrorState INT = ERROR_STATE();
    RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
END CATCH;
