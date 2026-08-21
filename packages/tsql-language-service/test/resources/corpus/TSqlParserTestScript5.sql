Declare @BeginDate DateTime
Declare @EndDate DateTime
Declare @CompGroup char(60)

Set @BeginDate = '1/12/2006 3:57:48 PM'
Set @EndDate = '1/22/2006 3:57:48 PM'
Set @CompGroup = 'Microsoft Windows 2003 Servers'

SELECT     CD.FullComputerName AS Server, OS.[Member Of] AS [Member Of], OS.[Operating System Name] AS [Operating System], 
                      OS.[Operating System Version] AS [Operating System Version], 
                      CASE WHEN OS.[Service Pack Version] <> '0.0' THEN OS.[Service Pack Version] END AS [Service Pack Version], 
                      OS.[Operating System Language] AS [Operating System Language], OS.[System Locale] AS Locale, C.[Time Zone Bias] AS [Time Zone], 
                      OS.[Install Date] AS [Install Date], OS.[Serial Number] AS [Serial Number], OS.[BIOS Manufacturer] AS [BIOS Manufacturer], 
                      OS.[BIOS Version] AS [BIOS Version], OS.[BIOS Date] AS [BIOS Date], OS.[Processor Manufacturer] AS [Processor Manufacturer], 
                      OS.[Processor Speed] AS [Processor Speed], OS.[Processor Identifier] AS [Processor Identifier], OS.[# Of Processors] AS [Number Of Processors], 
                      OS.[Total Physical Memory] / 1000 AS 'Total Physical Memory', OS.[System Drive] AS [System Drive]
FROM         SC_Class_OS_View OS INNER JOIN
                      [SC_Class_Rel_Computer-OS_View] [C-OS] ON [C-OS].TargetClassInstanceID = OS.ClassInstanceID INNER JOIN
                      SC_Class_Computer_View C ON C.ClassInstanceID = [C-OS].SourceClassInstanceID INNER JOIN
                      SC_ComputerDimension_View CD ON CD.ComputerID = [C-OS].SourceClassInstanceID
WHERE     (@CompGroup = '<ALL>') AND (OS.[Operating System Name] IS NOT NULL) AND (OS.[Operating System Version] IS NOT NULL) OR
                      (OS.[Operating System Name] IS NOT NULL) AND (OS.[Operating System Version] IS NOT NULL) AND (CD.SMC_InstanceID IN
                          (SELECT     ComputerID
                            FROM          dbo.[fn_GetComputerIDsInGroup](@CompGroup) fn_GetComputerIDsInGroup)) AND (CD.ComputerID NOT IN
                          (SELECT     SourceClassInstanceID
                            FROM          dbo.[SC_Class_Rel_Computer-Virtual Server_View])) AND (CD.ComputerID NOT IN
                          (SELECT     ClassInstanceID
                            FROM          dbo.[SC_Class_Computer_View] CCV
                            WHERE      CCV.[Computer Model] = 'Virtual Machine'))
