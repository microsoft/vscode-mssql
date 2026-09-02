CREATE EXTERNAL TABLE [dbo].[et1] 
WITH ( LOCATION = N'/bands.dat',
    DATA_SOURCE = [eds1],
    FILE_FORMAT = [eff1],
    REJECT_TYPE = PERCENTAGE,
    REJECT_VALUE = 10.5,
    REJECT_SAMPLE_VALUE = 10
) AS 
SELECT 1;


GO
CREATE EXTERNAL TABLE [dbo].[et2] 
WITH ( LOCATION = N'/bands.dat',
    DATA_SOURCE = [eds1],
    FILE_FORMAT = [eff1],
    REJECT_TYPE = PERCENTAGE,
    REJECT_VALUE = 10.5,
    REJECT_SAMPLE_VALUE = 10
) AS 
SELECT * FROM dbo.T2;


GO
CREATE EXTERNAL TABLE [dbo].[et3] 
WITH ( LOCATION = N'/bands.dat',
    DATA_SOURCE = [eds1],
    FILE_FORMAT = [eff1],
    REJECT_TYPE = PERCENTAGE,
    REJECT_VALUE = 10.5,
    REJECT_SAMPLE_VALUE = 10
) AS 
SELECT p.ProductKey
FROM dbo.DimProduct p
RIGHT JOIN dbo.stg_DimProduct s
ON p.ProductKey = s.ProductKey
;


GO
CREATE PROCEDURE dwsyntaxforsqldom
AS
CREATE EXTERNAL TABLE [ET].[et4] 
WITH ( LOCATION = N'/bands.dat',
    DATA_SOURCE = [eds1],
    FILE_FORMAT = [eff1],
    REJECT_TYPE = PERCENTAGE,
    REJECT_VALUE = 10.5,
    REJECT_SAMPLE_VALUE = 10
) AS 
SELECT * FROM [dbo].[DimSalesTerritory]

