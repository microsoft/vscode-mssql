/*
   Copyright 2011 tSQLt

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
DECLARE @Msg NVARCHAR(MAX);SELECT @Msg = 'Installed at '+CONVERT(NVARCHAR,GETDATE(),121);RAISERROR(@Msg,0,1);
GO


GO



GO

IF EXISTS (SELECT 1 FROM sys.assemblies WHERE name = 'tSQLtCLR')
    DROP ASSEMBLY tSQLtCLR;
GO

CREATE SCHEMA tSQLt;
GO
SET QUOTED_IDENTIFIER ON;
GO


GO

GO
IF (USER_ID('tSQLt.TestClass') IS NULL)
BEGIN
  CREATE USER [tSQLt.TestClass] WITHOUT LOGIN;
END;
GO


GO

GO
CREATE FUNCTION tSQLt.Private_GetDropItemCmd
(
/*SnipParamStart: CreateDropClassStatement.ps1*/
  @FullName NVARCHAR(MAX),
  @ItemType NVARCHAR(MAX)
/*SnipParamEnd: CreateDropClassStatement.ps1*/
)
RETURNS TABLE
AS
RETURN
/*SnipStart: CreateDropClassStatement.ps1*/
SELECT
    CASE @ItemType
      WHEN 'F' THEN 'ALTER TABLE '+(SELECT QUOTENAME(SCHEMA_NAME(schema_id))+'.'+QUOTENAME(OBJECT_NAME(parent_object_id)) FROM sys.objects WHERE OBJECT_ID = OBJECT_ID(@FullName))+' '
      ELSE ''
    END+
    'DROP ' +
    CASE @ItemType 
      WHEN 'F' THEN 'CONSTRAINT'
      WHEN 'IF' THEN 'FUNCTION'
      WHEN 'TF' THEN 'FUNCTION'
      WHEN 'FN' THEN 'FUNCTION'
      WHEN 'FT' THEN 'FUNCTION'
      WHEN 'P' THEN 'PROCEDURE'
      WHEN 'PC' THEN 'PROCEDURE'
      WHEN 'SN' THEN 'SYNONYM'
      WHEN 'U' THEN 'TABLE'
      WHEN 'V' THEN 'VIEW'
      WHEN 'type' THEN 'TYPE'
      WHEN 'xml_schema_collection' THEN 'XML SCHEMA COLLECTION'
      WHEN 'schema' THEN 'SCHEMA'
     END+
     ' ' + 
     CASE @ItemType
       WHEN 'F' THEN QUOTENAME(OBJECT_NAME(OBJECT_ID(@FullName)))
       ELSE @FullName
     END+
     ';' AS cmd
/*SnipEnd: CreateDropClassStatement.ps1*/
GO


GO

GO
CREATE VIEW tSQLt.Private_Results
AS
SELECT CAST(Severity AS INT) Severity,CAST(Result AS NVARCHAR(MAX)) Result
  FROM(
    VALUES(1, 'Success')
    ,
          (2, 'Skipped'),
          (3, 'Failure'),
          (4, 'Error'),
          (5, 'Abort'),
          (6, 'FATAL')
  )X(Severity, Result);
GO



GO

CREATE PROCEDURE tSQLt.DropClass
    @ClassName NVARCHAR(MAX)
AS
BEGIN
/*SnipStart: CreateDropClassStatement.ps1*/
    DECLARE @Cmd NVARCHAR(MAX);

    WITH SchemaInfo(FullName, ItemType, SchemaId) AS
         (
           SELECT 
               QUOTENAME(S.name),
               'schema',
               S.schema_id
             FROM sys.schemas AS S
            WHERE S.schema_id = ISNULL(SCHEMA_ID(@ClassName), SCHEMA_ID(PARSENAME(@ClassName,1)))
         ),
         ConstraintInfo(FullName, ItemType) AS
         (/*FOREIGN KEYS need to be dropped before their tables*/
           SELECT 
               QUOTENAME(SCHEMA_NAME(O.schema_id))+'.'+QUOTENAME(O.name),
               O.type
             FROM sys.objects AS O
            JOIN SchemaInfo SI ON SI.SchemaId = O.schema_id
              AND O.type IN ('F')
         ),
         ObjectInfo(FullName, ItemType) AS
         (
           SELECT 
               QUOTENAME(SCHEMA_NAME(O.schema_id))+'.'+QUOTENAME(O.name),
               O.type
             FROM sys.objects AS O
            JOIN SchemaInfo SI ON SI.SchemaId = O.schema_id
              AND O.type NOT IN ('F')
         ),
         TypeInfo(FullName, ItemType) AS
         (
           SELECT 
               QUOTENAME(SCHEMA_NAME(T.schema_id))+'.'+QUOTENAME(T.name),
               'type'
             FROM sys.types AS T
            JOIN SchemaInfo SI ON SI.SchemaId = T.schema_id
         ),
         XMLSchemaInfo(FullName, ItemType) AS
         (
           SELECT 
               QUOTENAME(SCHEMA_NAME(XSC.schema_id))+'.'+QUOTENAME(XSC.name),
               'xml_schema_collection'
             FROM sys.xml_schema_collections AS XSC
            JOIN SchemaInfo SI ON SI.SchemaId = XSC.schema_id
         ),
         DropStatements(no,FullName,ItemType) AS
         (
           SELECT 10, FullName, ItemType
              FROM ConstraintInfo
             UNION ALL
           SELECT 20, FullName, ItemType
              FROM ObjectInfo
             UNION ALL
           SELECT 30, FullName, ItemType
              FROM TypeInfo
             UNION ALL
           SELECT 40, FullName, ItemType
              FROM XMLSchemaInfo
             UNION ALL
            SELECT 10000, FullName, ItemType
              FROM SchemaInfo
         ),
         StatementBlob(xml)AS
         (
           SELECT GDIC.cmd [text()]
             FROM DropStatements DS
            CROSS APPLY tSQLt.Private_GetDropItemCmd(DS.FullName, DS.ItemType) GDIC
            ORDER BY no
              FOR XML PATH(''), TYPE
         )
    SELECT @Cmd = xml.value('/', 'NVARCHAR(MAX)') 
      FROM StatementBlob;

    EXEC(@Cmd);
END;
/*SnipEnd: CreateDropClassStatement.ps1*/


GO

GO
CREATE PROCEDURE tSQLt.Uninstall
AS
BEGIN

  EXEC tSQLt.DropClass @ClassName = 'tSQLt';  
  
  IF(EXISTS(SELECT 1 FROM sys.assemblies WHERE name = 'tSQLtCLR'))DROP ASSEMBLY tSQLtCLR;

  IF USER_ID('tSQLt.TestClass') IS NOT NULL DROP USER [tSQLt.TestClass];

END;
GO


GO

GO
CREATE VIEW tSQLt.TestClasses
AS
  SELECT s.name AS Name, s.schema_id AS SchemaId
    FROM sys.schemas s
    LEFT JOIN sys.extended_properties ep
      ON ep.major_id = s.schema_id
   WHERE ep.name = N'tSQLt.TestClass'
      OR s.principal_id = USER_ID('tSQLt.TestClass');
GO


GO

GO
CREATE VIEW tSQLt.Tests
AS
  SELECT classes.SchemaId, classes.Name AS TestClassName, 
         procs.object_id AS ObjectId, procs.name AS Name
    FROM tSQLt.TestClasses classes
    JOIN sys.procedures procs ON classes.SchemaId = procs.schema_id
   WHERE LOWER(procs.name) LIKE 'test%';
GO


GO

CREATE VIEW tSQLt.Private_HostPlatform AS SELECT CAST('Windows' AS NVARCHAR(256)) AS host_platform;


GO

GO
CREATE FUNCTION tSQLt.Private_InstallationInfo()
RETURNS TABLE
AS
RETURN SELECT CAST(NULL AS NUMERIC(10,2)) AS SqlVersion;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_GetAssemblyKeyBytes
   @AssemblyKeyBytes VARBINARY(MAX) = NULL OUTPUT,
   @AssemblyKeyThumbPrint VARBINARY(MAX) = NULL OUTPUT
AS
  SELECT @AssemblyKeyBytes =
0x4D5A90000300000004000000FFFF0000B800000000000000400000000000000000000000000000000000000000000000000000000000000000000000800000000E1FBA0E00B409CD21B8014CCD21546869732070726F6772616D2063616E6E6F742062+
0x652072756E20696E20444F53206D6F64652E0D0D0A2400000000000000504500004C01030096AB0D620000000000000000E00022200B013000000A0000000600000000000042280000002000000040000000000010002000000002000004000000000000+
0x00040000000000000000800000000200001FA50000030040850000100000100000000010000010000000000000100000000000000000000000F02700004F00000000400000A003000000000000000000000000000000000000006000000C000000B82600+
0x001C0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000080000000000000000000000082000004800000000000000000000002E746578740000004808000000200000000A0000000200+
0x00000000000000000000000000200000602E72737263000000A00300000040000000040000000C0000000000000000000000000000400000402E72656C6F6300000C00000000600000000200000010000000000000000000000000000040000042000000+
0x000000000000000000000000002428000000000000480000000200050058200000E005000009000000000000000000000000000000382600008000000000000000000000000000000000000000000000000000000000000000000000001E02280F00000A+
0x2A42534A4201000100000000000C00000076322E302E35303732370000000005006C000000A8010000237E0000140200002C02000023537472696E67730000000040040000040000002355530044040000100000002347554944000000540400008C0100+
0x0023426C6F620000000000000002000001471400000900000000FA013300160000010000001000000002000000010000000F0000000E0000000100000001000000000078010100000000000600ED00DE0106005A01DE0106002100AC010F00FE01000006+
0x00490094010600D00094010600B100940106004101940106000D01940106002601940106007900940106003500BF0106001300BF0106009400940106006000940106000D028D010000000001000000000001000100000010002502140241000100010050+
0x20000000008618A601060001000900A60101001100A60106001900A6010A002900A60110003100A60110003900A60110004100A60110004900A60110005100A60110005900A60110006100A60115006900A60110007100A60110007900A60110008100A6+
0x0106002E000B00C5002E001300CE002E001B00ED002E002300F6002E002B000C012E0033000C012E003B000C012E00430012012E004B001D012E0053000C012E005B000C012E00630035012E006B005F012E0073006C0104800000010000000000000001+
0x0000002300140200000200000000000000000000001A000A000000000000000000003C4D6F64756C653E006D73636F726C696200477569644174747269627574650044656275676761626C6541747472696275746500436F6D56697369626C6541747472+
0x696275746500417373656D626C795469746C6541747472696275746500417373656D626C794B65794E616D6541747472696275746500417373656D626C7954726164656D61726B41747472696275746500417373656D626C7946696C6556657273696F6E+
0x41747472696275746500417373656D626C79436F6E66696775726174696F6E41747472696275746500417373656D626C794465736372697074696F6E41747472696275746500436F6D70696C6174696F6E52656C61786174696F6E734174747269627574+
0x6500417373656D626C7950726F6475637441747472696275746500417373656D626C79436F7079726967687441747472696275746500417373656D626C79436F6D70616E794174747269627574650052756E74696D65436F6D7061746962696C69747941+
0x7474726962757465007453514C74417373656D626C794B65792E646C6C0053797374656D0053797374656D2E5265666C656374696F6E002E63746F720053797374656D2E446961676E6F73746963730053797374656D2E52756E74696D652E496E746572+
0x6F7053657276696365730053797374656D2E52756E74696D652E436F6D70696C6572536572766963657300446562756767696E674D6F646573004F626A656374007453514C74417373656D626C794B657900656D707479000000000000E87A37CE594157+
0x4B8E10A5A20529C83700042001010803200001052001011111042001010E042001010208B77A5C561934E08980A00024000004800000940000000602000000240000525341310004000001000100B9AF416AD8DFEDEC08A5652FA257F1242BF4ED60EF5A+
0x7B84A429604D62C919C5663A9C7710A7C5DF9953B69EC89FCE85D71E051140B273F4C9BF890A2BC19C48F22D7B1F1D739F90EEBC5729555F7F8B63ED088BBB083B336F7E38B92D44CFE1C842F09632B85114772FF2122BC638C78D497C4E88C2D656C166+
0x050D6E1EF3940801000800000000001E01000100540216577261704E6F6E457863657074696F6E5468726F777301080100020000000000150100107453514C74417373656D626C794B657900000501000000000A0100057453514C74000017010012436F+
0x7079726967687420C2A920203230313900002901002430333536303035622D373166642D346466332D383530322D32376336613630366539653800000C010007312E302E302E3000001D0100187453514C745F4F6666696369616C5369676E696E674B65+
0x79000000008A7CEB639FDB751B31675EF00667629EA5F2DDAA2B03487EF3C4CC5795C4208F9D0C011F74720A6F10D7AA6FBAEBBBECFBA00BF276E0AAD463CA1973B5C7572550CACBD6EF4F4ACE8F45C2B4A1D7F4E09370E99DF4772A9FFE56682A8A704D+
0x6F371E21ED6FAAD2E3B3EB8641112A8404C828C454DC8EF913F5FE9D0806D936330000000096AB0D6200000000020000001C010000D4260000D4080000525344531F1F4EAE9D9C314583569F39C126FE5E01000000443A5C615C315C7453514C745C7453+
0x514C74434C525C7453514C74417373656D626C794B65795C6F626A5C437275697365436F6E74726F6C5C7453514C74417373656D626C794B65792E7064620000000000000000000000000000000000000000000000000000000000000000000000000000+
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000+
0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001828000000000000000000003228000000200000000000000000000000000000000000000000000024280000000000000000000000005F+
0x436F72446C6C4D61696E006D73636F7265652E646C6C0000000000FF250020001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000+
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000+
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000+
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000+
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001001000000018000080000000+
0x00000000000000000000000100010000003000008000000000000000000000000000000100000000004800000058400000440300000000000000000000440334000000560053005F00560045005200530049004F004E005F0049004E0046004F00000000+
0x00BD04EFFE00000100000001000000000000000100000000003F000000000000000400000002000000000000000000000000000000440000000100560061007200460069006C00650049006E0066006F00000000002400040000005400720061006E0073+
0x006C006100740069006F006E00000000000000B004A4020000010053007400720069006E006700460069006C00650049006E0066006F0000008002000001003000300030003000300034006200300000001A000100010043006F006D006D0065006E0074+
0x00730000000000000022000100010043006F006D00700061006E0079004E0061006D00650000000000000000004A0011000100460069006C0065004400650073006300720069007000740069006F006E00000000007400530051004C0074004100730073+
0x0065006D0062006C0079004B006500790000000000300008000100460069006C006500560065007200730069006F006E000000000031002E0030002E0030002E00300000004A001500010049006E007400650072006E0061006C004E0061006D00650000+
0x007400530051004C00740041007300730065006D0062006C0079004B00650079002E0064006C006C00000000004800120001004C006500670061006C0043006F007000790072006900670068007400000043006F00700079007200690067006800740020+
0x00A90020002000320030003100390000002A00010001004C006500670061006C00540072006100640065006D00610072006B00730000000000000000005200150001004F0072006900670069006E0061006C00460069006C0065006E0061006D00650000+
0x007400530051004C00740041007300730065006D0062006C0079004B00650079002E0064006C006C00000000002C0006000100500072006F0064007500630074004E0061006D006500000000007400530051004C0074000000340008000100500072006F+
0x006400750063007400560065007200730069006F006E00000031002E0030002E0030002E003000000038000800010041007300730065006D0062006C0079002000560065007200730069006F006E00000031002E0030002E0030002E0030000000000000+
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000+
0x000C0000004438000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000+
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000+
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000+
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000+
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000+
0x000000000000000000 
  ,@AssemblyKeyThumbPrint = 0xE8FFF6F136D7B53E ;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_GetSQLProductMajorVersion
AS
  RETURN CAST(PARSENAME(CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(MAX)),4) AS INT);
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_EnableCLR
AS
BEGIN
  EXEC master.sys.sp_configure @configname='clr enabled', @configvalue = 1;
  RECONFIGURE;
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.RemoveAssemblyKey
AS
BEGIN
  IF(NOT EXISTS(SELECT * FROM sys.fn_my_permissions(NULL,'server') AS FMP WHERE FMP.permission_name = 'CONTROL SERVER'))
  BEGIN
    RAISERROR('Only principals with CONTROL SERVER permission can execute this procedure.',16,10);
    RETURN -1;
  END;

  DECLARE @master_sys_sp_executesql NVARCHAR(MAX); SET @master_sys_sp_executesql = 'master.sys.sp_executesql';
  DECLARE @ProductMajorVersion INT;
  EXEC @ProductMajorVersion = tSQLt.Private_GetSQLProductMajorVersion;

  IF SUSER_ID('tSQLtAssemblyKey') IS NOT NULL DROP LOGIN tSQLtAssemblyKey;
  EXEC @master_sys_sp_executesql N'IF ASYMKEY_ID(''tSQLtAssemblyKey'') IS NOT NULL DROP ASYMMETRIC KEY tSQLtAssemblyKey;';
  EXEC @master_sys_sp_executesql N'IF EXISTS(SELECT * FROM sys.assemblies WHERE name = ''tSQLtAssemblyKey'') DROP ASSEMBLY tSQLtAssemblyKey;';

  DECLARE @cmd NVARCHAR(MAX);
  IF(@ProductMajorVersion>=14)
  BEGIN
    DECLARE @TrustedHash NVARCHAR(MAX);
    DECLARE @AssemblyKeyBytes VARBINARY(MAX);
    EXEC tSQLt.Private_GetAssemblyKeyBytes @AssemblyKeyBytes = @AssemblyKeyBytes OUT;
    SELECT @TrustedHash = CONVERT(NVARCHAR(MAX),HASHBYTES('SHA2_512',@AssemblyKeyBytes),1);
    SELECT @cmd = 
           'IF EXISTS(SELECT 1 FROM sys.trusted_assemblies WHERE hash = ' + @TrustedHash +' AND description = ''tSQLt Ephemeral'')'+
           'EXEC sys.sp_drop_trusted_assembly @hash = ' + @TrustedHash + ';';
    EXEC master.sys.sp_executesql @cmd;
  END;


END;
GO


GO

GO
CREATE PROCEDURE tSQLt.InstallAssemblyKey
AS
BEGIN
  IF(NOT EXISTS(SELECT * FROM sys.fn_my_permissions(NULL,'server') AS FMP WHERE FMP.permission_name = 'CONTROL SERVER'))
  BEGIN
    RAISERROR('Only principals with CONTROL SERVER permission can execute this procedure.',16,10);
    RETURN -1;
  END;

  DECLARE @cmd NVARCHAR(MAX);
  DECLARE @cmd2 NVARCHAR(MAX);
  DECLARE @master_sys_sp_executesql NVARCHAR(MAX); SET @master_sys_sp_executesql = 'master.sys.sp_executesql';
  DECLARE @ProductMajorVersion INT;
  EXEC @ProductMajorVersion = tSQLt.Private_GetSQLProductMajorVersion;

  DECLARE @AssemblyKeyBytes VARBINARY(MAX),
          @AssemblyKeyThumbPrint VARBINARY(MAX);

  EXEC tSQLt.Private_GetAssemblyKeyBytes @AssemblyKeyBytes OUT, @AssemblyKeyThumbPrint OUT;

  SET @cmd = 'IF EXISTS(SELECT * FROM sys.assemblies WHERE name = ''tSQLtAssemblyKey'') DROP ASSEMBLY tSQLtAssemblyKey;';
  EXEC @master_sys_sp_executesql @cmd;

  SET @cmd2 = 'SELECT @cmd = ''DROP ASSEMBLY ''+QUOTENAME(A.name)+'';'''+ 
              '  FROM master.sys.assemblies AS A'+
              ' WHERE A.clr_name LIKE ''tsqltassemblykey, %'';';
  EXEC sys.sp_executesql @cmd2,N'@cmd NVARCHAR(MAX) OUTPUT',@cmd OUT;
  EXEC @master_sys_sp_executesql @cmd;

  DECLARE @Hash VARBINARY(64) = NULL;
  IF(@ProductMajorVersion>=14)
  BEGIN
    SELECT @Hash = HASHBYTES('SHA2_512',@AssemblyKeyBytes);

    SELECT @cmd = 
           'IF NOT EXISTS (SELECT * FROM sys.trusted_assemblies WHERE [hash] = @Hash)'+
           'BEGIN'+
           '  EXEC sys.sp_add_trusted_assembly @hash = @Hash, @description = N''tSQLt Ephemeral'';'+
           'END ELSE BEGIN'+
           '  SELECT @Hash = NULL FROM sys.trusted_assemblies WHERE [hash] = @Hash AND description <> ''tSQLt Ephemeral'';'+
           'END;';
    EXEC @master_sys_sp_executesql @cmd, N'@Hash VARBINARY(64) OUTPUT',@Hash OUT;
  END;

  SELECT @cmd = 
         'CREATE ASSEMBLY tSQLtAssemblyKey AUTHORIZATION dbo FROM ' +
         CONVERT(NVARCHAR(MAX),@AssemblyKeyBytes,1) +
         ' WITH PERMISSION_SET = SAFE;'
  EXEC @master_sys_sp_executesql @cmd;

  IF SUSER_ID('tSQLtAssemblyKey') IS NOT NULL DROP LOGIN tSQLtAssemblyKey;

  SET @cmd = N'IF ASYMKEY_ID(''tSQLtAssemblyKey'') IS NOT NULL DROP ASYMMETRIC KEY tSQLtAssemblyKey;';
  EXEC @master_sys_sp_executesql @cmd;

  SET @cmd2 = 'SELECT @cmd = ISNULL(''DROP LOGIN ''+QUOTENAME(SP.name)+'';'','''')+''DROP ASYMMETRIC KEY '' + QUOTENAME(AK.name) + '';'''+
              '  FROM master.sys.asymmetric_keys AS AK'+
              '  LEFT JOIN master.sys.server_principals AS SP'+
              '    ON AK.sid = SP.sid'+
              ' WHERE AK.thumbprint = @AssemblyKeyThumbPrint;';
  EXEC sys.sp_executesql @cmd2,N'@cmd NVARCHAR(MAX) OUTPUT, @AssemblyKeyThumbPrint VARBINARY(MAX)',@cmd OUT, @AssemblyKeyThumbPrint;
  EXEC @master_sys_sp_executesql @cmd;

  SET @cmd = 'CREATE ASYMMETRIC KEY tSQLtAssemblyKey FROM ASSEMBLY tSQLtAssemblyKey;';
  EXEC @master_sys_sp_executesql @cmd;
 
  SET @cmd = 'CREATE LOGIN tSQLtAssemblyKey FROM ASYMMETRIC KEY tSQLtAssemblyKey;';
  EXEC @master_sys_sp_executesql @cmd;

  SET @cmd = 'DROP ASSEMBLY tSQLtAssemblyKey;';
  EXEC @master_sys_sp_executesql @cmd;

  IF(@Hash IS NOT NULL)
  BEGIN
    SELECT @cmd = 'EXEC sys.sp_drop_trusted_assembly @hash = @Hash;';
    EXEC @master_sys_sp_executesql @cmd, N'@Hash VARBINARY(64)',@Hash;
  END;

  IF(@ProductMajorVersion>=14)
  BEGIN
    SET @cmd = 'GRANT UNSAFE ASSEMBLY TO tSQLtAssemblyKey;';
  END
  ELSE
  BEGIN
    SET @cmd = 'GRANT EXTERNAL ACCESS ASSEMBLY TO tSQLtAssemblyKey;';
  END;

  EXEC @master_sys_sp_executesql @cmd;

END;
GO


GO

GO
CREATE PROCEDURE tSQLt.PrepareServer
AS
BEGIN
  EXEC tSQLt.Private_EnableCLR;
  EXEC tSQLt.InstallAssemblyKey;
END;
GO


GO

CREATE TABLE tSQLt.Private_NewTestClassList (
  ClassName NVARCHAR(450) PRIMARY KEY CLUSTERED
);


GO

GO
CREATE PROCEDURE tSQLt.Private_ResetNewTestClassList
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM tSQLt.Private_NewTestClassList;
END;
GO


GO

CREATE PROCEDURE tSQLt.Private_DisallowOverwritingNonTestSchema
  @ClassName NVARCHAR(MAX)
AS
BEGIN
  IF SCHEMA_ID(@ClassName) IS NOT NULL AND tSQLt.Private_IsTestClass(@ClassName) = 0
  BEGIN
    RAISERROR('Attempted to execute tSQLt.NewTestClass on ''%s'' which is an existing schema but not a test class', 16, 10, @ClassName);
  END
END;


GO

CREATE FUNCTION tSQLt.Private_QuoteClassNameForNewTestClass(@ClassName NVARCHAR(MAX))
  RETURNS NVARCHAR(MAX)
AS
BEGIN
  RETURN 
    CASE WHEN @ClassName LIKE '[[]%]' THEN @ClassName
         ELSE QUOTENAME(@ClassName)
     END;
END;


GO

CREATE PROCEDURE tSQLt.Private_MarkSchemaAsTestClass
  @QuotedClassName NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @UnquotedClassName NVARCHAR(MAX);

  SELECT @UnquotedClassName = name
    FROM sys.schemas
   WHERE QUOTENAME(name) = @QuotedClassName;

  EXEC sp_addextendedproperty @name = N'tSQLt.TestClass', 
                              @value = 1,
                              @level0type = 'SCHEMA',
                              @level0name = @UnquotedClassName;

  INSERT INTO tSQLt.Private_NewTestClassList(ClassName)
  SELECT @UnquotedClassName
   WHERE NOT EXISTS
             (
               SELECT * 
                 FROM tSQLt.Private_NewTestClassList AS NTC
                 WITH(UPDLOCK,ROWLOCK,HOLDLOCK)
                WHERE NTC.ClassName = @UnquotedClassName
             );
END;


GO

CREATE PROCEDURE tSQLt.NewTestClass
    @ClassName NVARCHAR(MAX)
AS
BEGIN
  BEGIN TRY
    EXEC tSQLt.Private_DisallowOverwritingNonTestSchema @ClassName;

    EXEC tSQLt.DropClass @ClassName = @ClassName;

    DECLARE @QuotedClassName NVARCHAR(MAX);
    SELECT @QuotedClassName = tSQLt.Private_QuoteClassNameForNewTestClass(@ClassName);

    EXEC ('CREATE SCHEMA ' + @QuotedClassName);  
    EXEC tSQLt.Private_MarkSchemaAsTestClass @QuotedClassName;
  END TRY
  BEGIN CATCH
    DECLARE @ErrMsg NVARCHAR(MAX);SET @ErrMsg = ERROR_MESSAGE() + ' (Error originated in ' + ERROR_PROCEDURE() + ')';
    DECLARE @ErrSvr INT;SET @ErrSvr = ERROR_SEVERITY();
    
    RAISERROR(@ErrMsg, @ErrSvr, 10);
  END CATCH;
END;


GO

CREATE PROCEDURE tSQLt.Fail
    @Message0 NVARCHAR(MAX) = '',
    @Message1 NVARCHAR(MAX) = '',
    @Message2 NVARCHAR(MAX) = '',
    @Message3 NVARCHAR(MAX) = '',
    @Message4 NVARCHAR(MAX) = '',
    @Message5 NVARCHAR(MAX) = '',
    @Message6 NVARCHAR(MAX) = '',
    @Message7 NVARCHAR(MAX) = '',
    @Message8 NVARCHAR(MAX) = '',
    @Message9 NVARCHAR(MAX) = ''
AS
BEGIN
   DECLARE @WarningMessage NVARCHAR(MAX);
   SET @WarningMessage = '';

   IF XACT_STATE() = -1
   BEGIN
     SET @WarningMessage = CHAR(13)+CHAR(10)+'Warning: Uncommitable transaction detected!';

     DECLARE @TranName NVARCHAR(MAX);
     SELECT @TranName = TranName
       FROM tSQLt.TestResult
      WHERE Id = (SELECT MAX(Id) FROM tSQLt.TestResult);

     DECLARE @TranCount INT;
     SET @TranCount = @@TRANCOUNT;
     ROLLBACK;
     WHILE(@TranCount>0)
     BEGIN
       BEGIN TRAN;
       SET @TranCount = @TranCount -1;
     END;
     SAVE TRAN @TranName;
   END;

   INSERT INTO #TestMessage(Msg)
   SELECT COALESCE(@Message0, '!NULL!')
        + COALESCE(@Message1, '!NULL!')
        + COALESCE(@Message2, '!NULL!')
        + COALESCE(@Message3, '!NULL!')
        + COALESCE(@Message4, '!NULL!')
        + COALESCE(@Message5, '!NULL!')
        + COALESCE(@Message6, '!NULL!')
        + COALESCE(@Message7, '!NULL!')
        + COALESCE(@Message8, '!NULL!')
        + COALESCE(@Message9, '!NULL!')
        + @WarningMessage;
        
   RAISERROR('tSQLt.Failure',16,10);
END;


GO

GO
CREATE TABLE tSQLt.TestResult(
    Id INT IDENTITY(1,1) CONSTRAINT [PK:tSQLt.TestResult] PRIMARY KEY CLUSTERED,
    Class NVARCHAR(MAX) NOT NULL,
    TestCase NVARCHAR(MAX) NOT NULL,
    Name AS (QUOTENAME(Class) + '.' + QUOTENAME(TestCase)),
    TranName NVARCHAR(MAX) NULL,
    Result NVARCHAR(MAX) NULL,
    Msg NVARCHAR(MAX) NULL,
    TestStartTime DATETIME2 NOT NULL CONSTRAINT [DF:TestResult(TestStartTime)] DEFAULT SYSDATETIME(),
    TestEndTime DATETIME2 NULL
);
GO
CREATE TABLE tSQLt.Run_LastExecution(
    TestName NVARCHAR(MAX),
    SessionId INT,
    LoginTime DATETIME
);
GO
CREATE PROCEDURE tSQLt.Private_Print 
    @Message NVARCHAR(MAX),
    @Severity INT = 0
AS 
BEGIN
    DECLARE @SPos INT;SET @SPos = 1;
    DECLARE @EPos INT;
    DECLARE @Len INT; SET @Len = LEN(@Message);
    DECLARE @SubMsg NVARCHAR(MAX);
    DECLARE @Cmd NVARCHAR(MAX);
    
    DECLARE @CleanedMessage NVARCHAR(MAX);
    SET @CleanedMessage = REPLACE(@Message,'%','%%');
    
    WHILE (@SPos <= @Len)
    BEGIN
      SET @EPos = CHARINDEX(CHAR(13)+CHAR(10),@CleanedMessage+CHAR(13)+CHAR(10),@SPos);
      SET @SubMsg = SUBSTRING(@CleanedMessage, @SPos, @EPos - @SPos);
      SET @Cmd = N'RAISERROR(@Msg,@Severity,10) WITH NOWAIT;';
      EXEC sp_executesql @Cmd, 
                         N'@Msg NVARCHAR(MAX),@Severity INT',
                         @SubMsg,
                         @Severity;
      SELECT @SPos = @EPos + 2,
             @Severity = 0; --Print only first line with high severity
    END

    RETURN 0;
END;
GO

CREATE PROCEDURE tSQLt.Private_PrintXML
    @Message XML
AS 
BEGIN
    SET NOCOUNT ON;
    SELECT CAST(@Message AS XML);--Required together with ":XML ON" sqlcmd statement to allow more than 1mb to be returned
    RETURN 0;
END;
GO


CREATE PROCEDURE tSQLt.GetNewTranName
  @TranName CHAR(32) OUTPUT
AS
BEGIN
  SELECT @TranName = LEFT('tSQLtTran'+REPLACE(CAST(NEWID() AS NVARCHAR(60)),'-',''),32);
END;
GO



CREATE PROCEDURE tSQLt.SetTestResultFormatter
    @Formatter NVARCHAR(4000)
AS
BEGIN
    IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE [name] = N'tSQLt.ResultsFormatter')
    BEGIN
        EXEC sp_dropextendedproperty @name = N'tSQLt.ResultsFormatter',
                                    @level0type = 'SCHEMA',
                                    @level0name = 'tSQLt',
                                    @level1type = 'PROCEDURE',
                                    @level1name = 'Private_OutputTestResults';
    END;

    EXEC sp_addextendedproperty @name = N'tSQLt.ResultsFormatter', 
                                @value = @Formatter,
                                @level0type = 'SCHEMA',
                                @level0name = 'tSQLt',
                                @level1type = 'PROCEDURE',
                                @level1name = 'Private_OutputTestResults';
END;
GO

CREATE FUNCTION tSQLt.GetTestResultFormatter()
RETURNS NVARCHAR(MAX)
AS
BEGIN
    DECLARE @FormatterName NVARCHAR(MAX);
    
    SELECT @FormatterName = CAST(value AS NVARCHAR(MAX))
    FROM sys.extended_properties
    WHERE name = N'tSQLt.ResultsFormatter'
      AND major_id = OBJECT_ID('tSQLt.Private_OutputTestResults');
      
    SELECT @FormatterName = COALESCE(@FormatterName, 'tSQLt.DefaultResultFormatter');
    
    RETURN @FormatterName;
END;
GO

CREATE PROCEDURE tSQLt.Private_OutputTestResults
  @TestResultFormatter NVARCHAR(MAX) = NULL
AS
BEGIN
    DECLARE @Formatter NVARCHAR(MAX);
    SELECT @Formatter = COALESCE(@TestResultFormatter, tSQLt.GetTestResultFormatter());
    EXEC (@Formatter);
END
GO

----------------------------------------------------------------------
CREATE FUNCTION tSQLt.Private_GetLastTestNameIfNotProvided(@TestName NVARCHAR(MAX))
RETURNS TABLE
AS
RETURN
  SELECT CASE WHEN (LTRIM(ISNULL(@TestName,'')) = '') THEN LE.TestName ELSE @TestName END TestName
    FROM tSQLt.Run_LastExecution LE
    RIGHT JOIN sys.dm_exec_sessions ES
      ON LE.SessionId = ES.session_id
      AND LE.LoginTime = ES.login_time
    WHERE ES.session_id = @@SPID;
GO

CREATE PROCEDURE tSQLt.Private_SaveTestNameForSession 
  @TestName NVARCHAR(MAX)
AS
BEGIN
  DELETE FROM tSQLt.Run_LastExecution
   WHERE SessionId = @@SPID;  

  INSERT INTO tSQLt.Run_LastExecution(TestName, SessionId, LoginTime)
  SELECT TestName = @TestName,
         session_id,
         login_time
    FROM sys.dm_exec_sessions
   WHERE session_id = @@SPID;
END
GO

----------------------------------------------------------------------

CREATE FUNCTION tSQLt.TestCaseSummary()
RETURNS TABLE
AS
RETURN WITH A(Cnt, SuccessCnt, SkippedCnt, FailCnt, ErrorCnt) AS (
                SELECT COUNT(1),
                       ISNULL(SUM(CASE WHEN Result = 'Success' THEN 1 ELSE 0 END), 0),
                       ISNULL(SUM(CASE WHEN Result = 'Skipped' THEN 1 ELSE 0 END), 0),
                       ISNULL(SUM(CASE WHEN Result = 'Failure' THEN 1 ELSE 0 END), 0),
                       ISNULL(SUM(CASE WHEN Result = 'Error' THEN 1 ELSE 0 END), 0)
                  FROM tSQLt.TestResult
                  
                )
       SELECT 'Test Case Summary: ' + CAST(Cnt AS NVARCHAR) + ' test case(s) executed, '+
                  CAST(SuccessCnt AS NVARCHAR) + ' succeeded, '+
                  CAST(SkippedCnt AS NVARCHAR) + ' skipped, '+
                  CAST(FailCnt AS NVARCHAR) + ' failed, '+
                  CAST(ErrorCnt AS NVARCHAR) + ' errored.' Msg,*
         FROM A;
GO

CREATE PROCEDURE tSQLt.AssertEquals
    @Expected SQL_VARIANT,
    @Actual SQL_VARIANT,
    @Message NVARCHAR(MAX) = ''
AS
BEGIN
    IF ((@Expected = @Actual) OR (@Actual IS NULL AND @Expected IS NULL))
      RETURN 0;

    DECLARE @Msg NVARCHAR(MAX);
    SELECT @Msg = 'Expected: <' + ISNULL(CAST(@Expected AS NVARCHAR(MAX)), 'NULL') + 
                  '> but was: <' + ISNULL(CAST(@Actual AS NVARCHAR(MAX)), 'NULL') + '>';
    IF((COALESCE(@Message,'') <> '') AND (@Message NOT LIKE '% ')) SET @Message = @Message + ' ';
    EXEC tSQLt.Fail @Message, @Msg;
END;
GO

/*******************************************************************************************/
/*******************************************************************************************/
/*******************************************************************************************/
CREATE FUNCTION tSQLt.Private_GetCleanSchemaName(@SchemaName NVARCHAR(MAX), @ObjectName NVARCHAR(MAX))
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN (SELECT SCHEMA_NAME(schema_id) 
              FROM sys.objects 
             WHERE object_id = CASE WHEN ISNULL(@SchemaName,'') in ('','[]')
                                    THEN OBJECT_ID(@ObjectName)
                                    ELSE OBJECT_ID(@SchemaName + '.' + @ObjectName)
                                END);
END;
GO

CREATE FUNCTION [tSQLt].[Private_GetCleanObjectName](@ObjectName NVARCHAR(MAX))
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN (SELECT OBJECT_NAME(OBJECT_ID(@ObjectName)));
END;
GO

CREATE FUNCTION tSQLt.Private_ResolveFakeTableNamesForBackwardCompatibility 
 (@TableName NVARCHAR(MAX), @SchemaName NVARCHAR(MAX))
RETURNS TABLE AS 
RETURN
  SELECT QUOTENAME(OBJECT_SCHEMA_NAME(object_id)) AS CleanSchemaName,
         QUOTENAME(OBJECT_NAME(object_id)) AS CleanTableName
     FROM (SELECT CASE
                    WHEN @SchemaName IS NULL THEN OBJECT_ID(@TableName)
                    ELSE COALESCE(OBJECT_ID(@SchemaName + '.' + @TableName),OBJECT_ID(@TableName + '.' + @SchemaName)) 
                  END object_id
          ) ids;
GO


/*******************************************************************************************/
/*******************************************************************************************/
/*******************************************************************************************/
CREATE FUNCTION tSQLt.Private_GetOriginalTableName(@SchemaName NVARCHAR(MAX), @TableName NVARCHAR(MAX)) --DELETE!!!
RETURNS NVARCHAR(MAX)
AS
BEGIN
  RETURN (SELECT CAST(value AS NVARCHAR(4000))
    FROM sys.extended_properties
   WHERE class_desc = 'OBJECT_OR_COLUMN'
     AND major_id = OBJECT_ID(@SchemaName + '.' + @TableName)
     AND minor_id = 0
     AND name = 'tSQLt.Private_TestDouble_OrgObjectName');
END;
GO

CREATE FUNCTION tSQLt.Private_GetOriginalTableInfo(@TableObjectId INT)
RETURNS TABLE
AS
  RETURN SELECT CAST(value AS NVARCHAR(4000)) OrgTableName,
                OBJECT_ID(QUOTENAME(OBJECT_SCHEMA_NAME(@TableObjectId)) + '.' + QUOTENAME(CAST(value AS NVARCHAR(4000)))) OrgTableObjectId
    FROM sys.extended_properties
   WHERE class_desc = 'OBJECT_OR_COLUMN'
     AND major_id = @TableObjectId
     AND minor_id = 0
     AND name = 'tSQLt.Private_TestDouble_OrgObjectName';
GO



CREATE FUNCTION [tSQLt].[F_Num](
       @N INT
)
RETURNS TABLE 
AS 
RETURN WITH C0(c) AS (SELECT 1 UNION ALL SELECT 1),
            C1(c) AS (SELECT 1 FROM C0 AS A CROSS JOIN C0 AS B),
            C2(c) AS (SELECT 1 FROM C1 AS A CROSS JOIN C1 AS B),
            C3(c) AS (SELECT 1 FROM C2 AS A CROSS JOIN C2 AS B),
            C4(c) AS (SELECT 1 FROM C3 AS A CROSS JOIN C3 AS B),
            C5(c) AS (SELECT 1 FROM C4 AS A CROSS JOIN C4 AS B),
            C6(c) AS (SELECT 1 FROM C5 AS A CROSS JOIN C5 AS B)
       SELECT TOP(CASE WHEN @N>0 THEN @N ELSE 0 END) ROW_NUMBER() OVER (ORDER BY c) no
         FROM C6;
GO

CREATE PROCEDURE [tSQLt].[Private_SetFakeViewOn_SingleView]
  @ViewName NVARCHAR(MAX)
AS
BEGIN
  DECLARE @Cmd NVARCHAR(MAX),
          @SchemaName NVARCHAR(MAX),
          @TriggerName NVARCHAR(MAX);
          
  SELECT @SchemaName = OBJECT_SCHEMA_NAME(ObjId),
         @ViewName = OBJECT_NAME(ObjId),
         @TriggerName = OBJECT_NAME(ObjId) + '_SetFakeViewOn'
    FROM (SELECT OBJECT_ID(@ViewName) AS ObjId) X;

  SET @Cmd = 
     'CREATE TRIGGER $$SCHEMA_NAME$$.$$TRIGGER_NAME$$
      ON $$SCHEMA_NAME$$.$$VIEW_NAME$$ INSTEAD OF INSERT AS
      BEGIN
         RAISERROR(''Test system is in an invalid state. SetFakeViewOff must be called if SetFakeViewOn was called. Call SetFakeViewOff after creating all test case procedures.'', 16, 10) WITH NOWAIT;
         RETURN;
      END;
     ';
      
  SET @Cmd = REPLACE(@Cmd, '$$SCHEMA_NAME$$', QUOTENAME(@SchemaName));
  SET @Cmd = REPLACE(@Cmd, '$$VIEW_NAME$$', QUOTENAME(@ViewName));
  SET @Cmd = REPLACE(@Cmd, '$$TRIGGER_NAME$$', QUOTENAME(@TriggerName));
  EXEC(@Cmd);

  EXEC sp_addextendedproperty @name = N'SetFakeViewOnTrigger', 
                               @value = 1,
                               @level0type = 'SCHEMA',
                               @level0name = @SchemaName, 
                               @level1type = 'VIEW',
                               @level1name = @ViewName,
                               @level2type = 'TRIGGER',
                               @level2name = @TriggerName;

  RETURN 0;
END;
GO

CREATE PROCEDURE [tSQLt].[SetFakeViewOn]
  @SchemaName NVARCHAR(MAX)
AS
BEGIN
  DECLARE @ViewName NVARCHAR(MAX);
    
  DECLARE viewNames CURSOR LOCAL FAST_FORWARD FOR
  SELECT QUOTENAME(OBJECT_SCHEMA_NAME(object_id)) + '.' + QUOTENAME([name]) AS viewName
    FROM sys.views
   WHERE schema_id = SCHEMA_ID(@SchemaName);
  
  OPEN viewNames;
  
  FETCH NEXT FROM viewNames INTO @ViewName;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    EXEC tSQLt.Private_SetFakeViewOn_SingleView @ViewName;
    
    FETCH NEXT FROM viewNames INTO @ViewName;
  END;
  
  CLOSE viewNames;
  DEALLOCATE viewNames;
END;
GO

CREATE PROCEDURE [tSQLt].[Private_SetFakeViewOff_SingleView]
  @ViewName NVARCHAR(MAX)
AS
BEGIN
  DECLARE @Cmd NVARCHAR(MAX),
          @SchemaName NVARCHAR(MAX),
          @TriggerName NVARCHAR(MAX);
          
  SELECT @SchemaName = QUOTENAME(OBJECT_SCHEMA_NAME(ObjId)),
         @TriggerName = QUOTENAME(OBJECT_NAME(ObjId) + '_SetFakeViewOn')
    FROM (SELECT OBJECT_ID(@ViewName) AS ObjId) X;
  
  SET @Cmd = 'DROP TRIGGER %SCHEMA_NAME%.%TRIGGER_NAME%;';
      
  SET @Cmd = REPLACE(@Cmd, '%SCHEMA_NAME%', @SchemaName);
  SET @Cmd = REPLACE(@Cmd, '%TRIGGER_NAME%', @TriggerName);
  
  EXEC(@Cmd);
END;
GO

CREATE PROCEDURE [tSQLt].[SetFakeViewOff]
  @SchemaName NVARCHAR(MAX)
AS
BEGIN
  DECLARE @ViewName NVARCHAR(MAX);
    
  DECLARE viewNames CURSOR LOCAL FAST_FORWARD FOR
   SELECT QUOTENAME(OBJECT_SCHEMA_NAME(t.parent_id)) + '.' + QUOTENAME(OBJECT_NAME(t.parent_id)) AS viewName
     FROM sys.extended_properties ep
     JOIN sys.triggers t
       on ep.major_id = t.object_id
     WHERE ep.name = N'SetFakeViewOnTrigger'  
  OPEN viewNames;
  
  FETCH NEXT FROM viewNames INTO @ViewName;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    EXEC tSQLt.Private_SetFakeViewOff_SingleView @ViewName;
    
    FETCH NEXT FROM viewNames INTO @ViewName;
  END;
  
  CLOSE viewNames;
  DEALLOCATE viewNames;
END;
GO

CREATE FUNCTION tSQLt.Private_GetQuotedFullName(@Objectid INT)
RETURNS NVARCHAR(517)
AS
BEGIN
    DECLARE @QuotedName NVARCHAR(517);
    SELECT @QuotedName = QUOTENAME(OBJECT_SCHEMA_NAME(@Objectid)) + '.' + QUOTENAME(OBJECT_NAME(@Objectid));
    RETURN @QuotedName;
END;
GO

CREATE FUNCTION tSQLt.Private_GetSchemaId(@SchemaName NVARCHAR(MAX))
RETURNS INT
AS
BEGIN
  RETURN (
    SELECT TOP(1) schema_id
      FROM sys.schemas
     WHERE @SchemaName IN (name, QUOTENAME(name), QUOTENAME(name, '"'))
     ORDER BY 
        CASE WHEN name = @SchemaName THEN 0 ELSE 1 END
  );
END;
GO

CREATE FUNCTION tSQLt.Private_IsTestClass(@TestClassName NVARCHAR(MAX))
RETURNS BIT
AS
BEGIN
  RETURN 
    CASE 
      WHEN EXISTS(
             SELECT 1 
               FROM tSQLt.TestClasses
              WHERE SchemaId = tSQLt.Private_GetSchemaId(@TestClassName)
            )
      THEN 1
      ELSE 0
    END;
END;
GO

CREATE FUNCTION tSQLt.Private_ResolveSchemaName(@Name NVARCHAR(MAX))
RETURNS TABLE 
AS
RETURN
  WITH ids(schemaId) AS
       (SELECT tSQLt.Private_GetSchemaId(@Name)
       ),
       idsWithNames(schemaId, quotedSchemaName) AS
        (SELECT schemaId,
         QUOTENAME(SCHEMA_NAME(schemaId))
         FROM ids
        )
  SELECT schemaId, 
         quotedSchemaName,
         CASE WHEN EXISTS(SELECT 1 FROM tSQLt.TestClasses WHERE TestClasses.SchemaId = idsWithNames.schemaId)
               THEN 1
              ELSE 0
         END AS isTestClass, 
         CASE WHEN schemaId IS NOT NULL THEN 1 ELSE 0 END AS isSchema
    FROM idsWithNames;
GO

CREATE FUNCTION tSQLt.Private_ResolveObjectName(@Name NVARCHAR(MAX))
RETURNS TABLE 
AS
RETURN
  WITH ids(schemaId, objectId) AS
       (SELECT SCHEMA_ID(OBJECT_SCHEMA_NAME(OBJECT_ID(@Name))),
               OBJECT_ID(@Name)
       ),
       idsWithNames(schemaId, objectId, quotedSchemaName, quotedObjectName) AS
        (SELECT schemaId, objectId,
         QUOTENAME(SCHEMA_NAME(schemaId)) AS quotedSchemaName, 
         QUOTENAME(OBJECT_NAME(objectId)) AS quotedObjectName
         FROM ids
        )
  SELECT schemaId, 
         objectId, 
         quotedSchemaName,
         quotedObjectName,
         quotedSchemaName + '.' + quotedObjectName AS quotedFullName, 
         CASE WHEN LOWER(quotedObjectName) LIKE '[[]test%]' 
               AND objectId = OBJECT_ID(quotedSchemaName + '.' + quotedObjectName,'P') 
              THEN 1 ELSE 0 END AS isTestCase
    FROM idsWithNames;
    
GO

CREATE FUNCTION tSQLt.Private_ResolveName(@Name NVARCHAR(MAX))
RETURNS TABLE 
AS
RETURN
  WITH resolvedNames(ord, schemaId, objectId, quotedSchemaName, quotedObjectName, quotedFullName, isTestClass, isTestCase, isSchema) AS
  (SELECT 1, schemaId, NULL, quotedSchemaName, NULL, quotedSchemaName, isTestClass, 0, 1
     FROM tSQLt.Private_ResolveSchemaName(@Name)
    UNION ALL
   SELECT 2, schemaId, objectId, quotedSchemaName, quotedObjectName, quotedFullName, 0, isTestCase, 0
     FROM tSQLt.Private_ResolveObjectName(@Name)
    UNION ALL
   SELECT 3, NULL, NULL, NULL, NULL, NULL, 0, 0, 0
   )
   SELECT TOP(1) schemaId, objectId, quotedSchemaName, quotedObjectName, quotedFullName, isTestClass, isTestCase, isSchema
     FROM resolvedNames
    WHERE schemaId IS NOT NULL 
       OR ord = 3
    ORDER BY ord
GO



GO

GO
CREATE PROCEDURE tSQLt.EnableExternalAccess
  @try BIT = 0,
  @enable BIT = 1
AS
BEGIN
  IF((SELECT HostPlatform FROM tSQLt.Info()) = 'Linux')
  BEGIN
    IF(@try = 0)
    BEGIN
      RAISERROR('tSQLt.EnableExternalAccess is not supported on Linux.',16,10);
    END;
    RETURN -1;
  END;
  BEGIN TRY
    IF @enable = 1
    BEGIN
      EXEC('ALTER ASSEMBLY tSQLtCLR WITH PERMISSION_SET = EXTERNAL_ACCESS;');
    END
    ELSE
    BEGIN
      EXEC('ALTER ASSEMBLY tSQLtCLR WITH PERMISSION_SET = SAFE;');
    END
  END TRY
  BEGIN CATCH
    IF(@try = 0)
    BEGIN
      DECLARE @Message NVARCHAR(4000);
      SET @Message = 'The attempt to ' +
                      CASE WHEN @enable = 1 THEN 'enable' ELSE 'disable' END +
                      ' tSQLt features requiring EXTERNAL_ACCESS failed' +
                      ': '+ERROR_MESSAGE();
      RAISERROR(@Message,16,10);
    END;
    RETURN -1;
  END CATCH;
  RETURN 0;
END;
GO


GO

CREATE TABLE tSQLt.Private_Configurations (
  Name NVARCHAR(100) PRIMARY KEY CLUSTERED,
  Value SQL_VARIANT
);


GO

GO
CREATE PROCEDURE tSQLt.Private_SetConfiguration
  @Name NVARCHAR(100),
  @Value SQL_VARIANT
AS
BEGIN
  IF(EXISTS(SELECT 1 FROM tSQLt.Private_Configurations WITH(ROWLOCK,UPDLOCK) WHERE Name = @Name))
  BEGIN
    UPDATE tSQLt.Private_Configurations SET
           Value = @Value
     WHERE Name = @Name;
  END;
  ELSE
  BEGIN
     INSERT tSQLt.Private_Configurations(Name,Value)
     VALUES(@Name,@Value);
  END;
END;
GO


GO

GO
CREATE FUNCTION tSQLt.Private_GetConfiguration(
  @Name NVARCHAR(100)
)
RETURNS TABLE
AS
RETURN
  SELECT PC.Name,
         PC.Value 
    FROM tSQLt.Private_Configurations AS PC
   WHERE PC.Name = @Name;
GO


GO

GO
CREATE PROCEDURE tSQLt.SetVerbose
  @Verbose BIT = 1
AS
BEGIN
  EXEC tSQLt.Private_SetConfiguration @Name = 'Verbose', @Value = @Verbose;
END;
GO


GO

CREATE TABLE tSQLt.CaptureOutputLog (
  Id INT IDENTITY(1,1) PRIMARY KEY CLUSTERED,
  OutputText NVARCHAR(MAX)
);


GO

CREATE PROCEDURE tSQLt.LogCapturedOutput @text NVARCHAR(MAX)
AS
BEGIN
  INSERT INTO tSQLt.CaptureOutputLog (OutputText) VALUES (@text);
END;


GO

GO
DECLARE @cmd NVARCHAR(MAX) = '';
SET @cmd = @cmd + --<-- force NVARCHAR(MAX)
'CREATE ASSEMBLY [tSQLtCLR] AUTHORIZATION [dbo] FROM '+
'0x4D5A90000300000004000000FFFF0000B800000000000000400000000000000000000000000000000000000000000000000000000000000000000000800000000E1FBA0E00B409CD21B8014CCD21546869732070726F6772616D2063616E6E6F742062'+
'652072756E20696E20444F53206D6F64652E0D0D0A2400000000000000504500004C01030095AB0D620000000000000000E00022200B013000004A000000080000000000006A690000002000000080000000000010002000000002000004000000000000'+
'00040000000000000000C0000000020000FEC60000030040850000100000100000000010000010000000000000100000000000000000000000186900004F000000008000001C0400000000000000000000000000000000000000A000000C000000E06700'+
'001C0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000080000000000000000000000082000004800000000000000000000002E746578740000007049000000200000004A0000000200'+
'00000000000000000000000000200000602E727372630000001C0400000080000000060000004C0000000000000000000000000000400000402E72656C6F6300000C00000000A00000000200000052000000000000000000000000000040000042000000'+
'000000000000000000000000004C6900000000000048000000020005005C3400000433000009000000000000000000000000000000606700008000000000000000000000000000000000000000000000000000000000000000000000001E02281200000A'+
'2A133004005400000001000011731300000A0A160B022803000006731400000A0C7201000070731500000A13042B261104096F1600000A2C1C0717580B0607096F1700000A186F1800000A281900000A6F1A00000A086F1B00000A250D2DD0062A5E0F00'+
'281C00000A2D080F00281D00000A2A72210000702A13300200270000000200001102A50200001B0A031200281E00000A281F00000A8118000001041200282000000A81140000012A001B3003006500000003000011140A18732100000A0B280600000673'+
'2200000A0A066F2300000A732400000A25066F2500000A250F01FE16140000016F2600000A6F2700000A6F2800000A26DE0A072C06076F2900000ADCDE170C722300007008730A0000067A062C06066F2A00000ADC2A0000000128000002000900384100'+
'0A00000000000002004B4D000D1C00000102000200585A000A000000001330040046000000040000117344000006256F490000060A6F4A0000060B732B00000A2572D8000070066F2C00000A2572F0000070178C4A0000016F2C00000A25721801007007'+
'6F2C00000A6F2D00000A2A1E02282E00000A2A220203282F00000A2A26020304283000000A2A26020304283100000A2A3A02281200000A02037D010000042A7A0203280F000006027B01000004027B010000046F460000066F4F0000062A220203280F00'+
'00062A4A027B01000004036F4B0000066F3200000A2A6A283300000A6F3400000A6F3500000A6F2600000A281900000A2A56283300000A6F3400000A6F3600000A283700000A2A00001330040032000000050000117238010070283800000A0A1200FE16'+
'270000016F2600000A725C01007072210000706F3900000A283A00000A281900000A2A00001B3005001A020000060000110F00281C00000A2C0B7260010070732F00000A7A0F01281C00000A2C0C7221000070281900000A10010F02281C00000A2C0C72'+
'21000070281900000A100273440000060F000F0128190000060A06281900000A6F4B00000604281A0000060B160C07166F3B00000A8E698D4F0000010D076F3C00000A13072B371207283D00000A13081613092B1D09110909110994110811099A6F3E00'+
'000A283F00000A9E110917581309110911088E6932DB0817580C1207284000000A2DC0DE0E1207FE160400001B6F2900000ADC16130A2B1809110A09110A94209B000000284100000A9E110A1758130A110A098E6932E116130409130B16130C2B16110B'+
'110C94130D110417110D58581304110C1758130C110C110B8E6932E211041758130411040817585A13041713051104734200000A1306076F3C00000A130738AE0000001207283D00000A130E11052D0811066F4300000A2616130F2B2B11067296010070'+
'6F4400000A110E110F9A281800000609110F9428170000066F4400000A26110F1758130F110F110E8E6932CD110672960100706F4400000A2611052C5016130511066F4300000A261613102B2B1106729A0100706F4400000A26110611066F4500000A72'+
'5C010070091110946F4600000A261110175813101110110E8E6932CD1106729A0100706F4400000A261207284000000A3A46FFFFFFDE0E1207FE160400001B6F2900000ADC11066F2600000A281900000A734700000A2A0000011C00000200780044BC00'+
'0E0000000002003901C1FA010E000000001330050035000000070000110228160000060A729E010070731500000A0F00FE16140000016F2600000A720202007017066F4800000A281900000A734700000A2A327E04000004026F4900000A2A0000133002'+
'00FA000000080000110F00FE16140000016F2600000A6F4A00000A0A150B160C160D16130438C900000008450600000005000000330000003F00000053000000760000008C00000038A00000000611049328150000063A92000000061104931F2D330717'+
'0C3883000000061104931F2F3304190C2B7711040B2B72061104931F2D336A180C2B66061104931F0D2E08061104931F0A3356160C2B52061104931F2A33081A0C0917580D2B42091631041A0C2B3A7220020070732F00000A7A061104931F2A33021B0C'+
'061104931F2F331D190C2B19061104931F2F330F0917590D092D04160C2B061A0C2B021A0C1104175813041104068E692F0707163F29FFFFFF072A9202734B00000A16723A02007003026F3E00000A59284600000A6F2600000A283A00000A2AD2026F3E'+
'00000A209B000000312502161F4B6F4C00000A723E02007002026F3E00000A1F4B591F4B6F4C00000A284D00000A2A022A133003004500000009000011724A02007002FE16140000016F2600000A283A00000A0A03FE16140000016F2600000A6F3E0000'+
'0A16311806726802007003FE16140000016F2600000A284D00000A0A062A00000013300400860200000A000011026F4E00000A0A734F00000A0B066F5000000A6F5100000A0C0F01FE16140000016F2600000A72210000706F5200000A2C47088D420000'+
'010D1613042B2A066F5000000A11046F5300000A13050911041105727E0200706F5400000A6F2600000AA211041758130411040832D107096F5500000A38000200000F01281B000006735600000A130613071613082B2E110711089A130911096F3E0000'+
'0A2C18110611097294020070729A0200706F3900000A6F5700000A110817581308110811078E6932CA0711066F5800000A6F5500000A38A3010000088D42000001130A16130B387E01000002110B6F5900000A2C0F110A110B729E020070A2385F010000'+
'066F5000000A110B6F5300000A72AC0200706F5400000AA52F000001130C110C1F0F3024110C1A59450400000074000000B8000000D6000000FC000000110C1F0F2E523805010000110C1F133BE8000000110C1F153BDF000000110C1F1F594504000000'+
'05000000D9000000590000006D00000038D4000000110A110B02110B6F5A00000A285B00000A281D000006A238CA000000110A110B02110B6F5A00000A285B00000A281F000006A238AE000000110A110B02110B6F5A00000A285B00000A281E000006A2'+
'3892000000110A110B02110B6F5A00000A2820000006A22B7E110A110B02110B6F5C00000A2821000006A22B6A110A110B02110B6F5D00000A130D120DFE16300000016F2600000AA22B4C110A110B02110B6F5E00000A130E120E285F00000A130F120F'+
'72C6020070286000000AA22B26110A110B02110B6F6100000A2822000006A22B12110A110B02110B6F6200000A6F2600000AA2110B1758130B110B026F6300000A3F75FEFFFF07110A6F5500000A026F6400000A3A52FEFFFF072A9A72F002007002FE16'+
'140000016F2600000A72F6020070284D00000A72FC020070286500000A2A8202720803007072210000706F3900000A729A02007072210000706F3900000A2A5E720C0300700F00286600000A8C33000001286700000A2A5E722A0300700F00286600000A'+
'8C33000001286700000A2A5E72620300700F00286600000A8C33000001286700000A2A72728C0300700F00286800000A736900000A8C33000001286700000A2A4672CC030070028C34000001286700000A2A00000013300300440000000B000011734B00'+
'000A7214040070284400000A0A0F00286A00000A0B160C2B1B0708910D061203721A040070286B00000A6F4400000A260817580C08078E6932DF066F2600000A2A2E7220040070732F00000A7A1A736C00000A7A00133004004100000000000000736D00'+
'000A251F20176F6E00000A251F0A176F6E00000A251F0D176F6E00000A251F09176F6E00000A251F0C176F6E00000A251F0B176F6E00000A80040000042A3A02281200000A02037D050000042A1B300300340000000C000011020328300000060A020428'+
'300000060B027B0500000406076F4D000006DE140C027B05000004086F6F00000A6F4E000006DE002A01100000000000001F1F0014070000021B300200370000000D000011140A027B05000004036F4B0000060A066F6400000A26030628320000060B03'+
'0728330000060728340000060CDE07062831000006DC082A0001100000020002002C2E0007000000002A022C06026F3200000A2A001B3003002F0000000E000011036F4E00000A0ADE240B72940400700F00FE16140000016F2600000A72B0040070284D'+
'00000A07732C0000067A062A000110000000000000090900241D0000019A032D2272940400700F00FE16140000016F2600000A72F8040070284D00000A732B0000067A2A001B3005000D0100000F00001172210000700A026F5000000A6F7000000A0B38'+
'D3000000076F7100000A742E0000010C0872340500706F5400000A6F2600000A7246050070287200000A39A8000000067208030070283A00000A0A026F7300000A6F7000000A0D2B64096F7100000A74390000011304110428350000062C4E1C8D420000'+
'01251606A225177250050070A2251811046F7400000AA225197254050070A2251A0811046F7400000A6F5400000A252D0426142B056F2600000AA2251B7258050070A2287500000A0A096F7600000A2D94DE1409753A000001130511052C0711056F2900'+
'000ADC06729A020070283A00000A0A076F7600000A3A22FFFFFFDE1407753A000001130511052C0711056F2900000ADC062A000000011C000002005A0070CA00140000000002001200E5F7001400000000AA026F7400000A725C0500701B6F7700000A2D'+
'15026F7400000A72620500701B6F7700000A16FE012A162A3A02281200000A02037D060000042A000013300400A30000001000001102032838000006027B06000004046F4B0000060A160B066F6300000A1631270717580B07281F00000A03287800000A'+
'287900000A2C080628390000062B08066F7A00000A2DD9066F3200000A07281F00000A03287B00000A287900000A2C431B8D420000012516726C050070A225171201287C00000AA22518729E050070A225190F01FE16180000016F2600000AA2251A72D0'+
'050070A2287500000A732B0000067A2A001330030054000000110000110316281F00000A287B00000A0A06287900000A2D14060F01287D00000A287E00000A287F00000A2B0106287900000A2C2272F40500700F01FE16180000016F2600000A72520600'+
'70284D00000A732B0000067A2A13300200290000001200001102283C0000060A288000000A06738100000A6F8200000A0206283A000006288000000A6F8300000A2A722B11288000000A0203283B0000066F8400000A026F6400000A2DE72A0000133003'+
'00230000001300001103738100000A026F6300000A8D0F0000010A02066F8500000A2625066F8600000A262A001B3003005100000014000011026F4E00000A283D000006256F8700000A8D3C0000010A160B6F8800000A0C2B151202288900000A0D0607'+
'09283E000006A20717580B1202288A00000A2DE2DE0E1202FE160800001B6F2900000ADC062A0000000110000002001F002241000E000000001B3002006600000015000011738B00000A0A026F5000000A6F7000000A0B2B35076F7100000A742E000001'+
'0C0872340500706F5400000A6F2600000A6F8C00000A726E060070287200000A2C0806086F8D00000A26076F7600000A2DC3DE1107753A0000010D092C06096F2900000ADC062A000001100000020012004153001100000000133005006D010000160000'+
'110272AC0200706F5400000AA52F0000010A02727E0200706F5400000A74420000010B0272780600706F5400000A74400000010C064523000000050000000D000000050000000D000000050000004B000000050000000500000005000000050000000D00'+
'00000500000026000000050000000500000005000000050000000500000005000000050000000500000026000000260000000500000086000000050000008600000086000000860000007D0000008600000005000000050000004B0000004B0000003881'+
'0000000706738E00000A2A070602728A0600706F5400000AA54F0000016A738F00000A2A02728A0600706F5400000AA54F0000010D0920FF7F00003102150D0706096A738F00000A2A07060272A00600706F5400000A289000000A289100000A0272C206'+
'00706F5400000A289000000A289100000A739200000A2A070608739300000A2A72DC0600701200FE162F0000016F2600000A72F2060070284D00000A739400000A7A4A7344000006732E00000602036F2F0000062A4A7344000006733600000602036F37'+
'0000062A327307000006026F050000062A467344000006730C000006026F0D0000062A467344000006730C000006026F0E0000062A3602281200000A0228470000062A72027B090000042D0D02284800000602177D0900000402289500000A2A1E027B08'+
'0000042A9E02739600000A7D07000004027B07000004723A0700706F9700000A027B070000046F2300000A2A32027B070000046F9800000A2A13300300260000000900001102726C070070281900000A284B000006256F6400000A2625166F9900000A0A'+
'6F3200000A062A32027B070000046F9A00000A2A00133003004D00000000000000027E9B00000A7D08000004027B0700000402FE064C000006739C00000A6F9D00000A732400000A25027B070000046F2500000A250F01FE16140000016F2600000A6F27'+
'00000A1A6F9E00000A2A000000133004004400000000000000027C08000004281C00000A2C10027221000070281900000A7D0800000402027B08000004046F9F00000A72B6070070283A00000A281900000A28A000000A7D080000042A133004004E0000'+
'0000000000732400000A25027B070000046F2500000A2572BC0700706F2700000A256FA100000A72EE070070036FA200000A26256FA100000A7200080070046FA200000A26251A6FA300000A6F2800000A262AF2732400000A25027B070000046F250000'+
'0A25720E0800706F2700000A256FA100000A7224080070036FA200000A26251A6FA300000A6F2800000A262A00133004004100000000000000732400000A25027B070000046F2500000A2572360800706F2700000A256FA100000A7266080070038C1400'+
'00016FA200000A26251A6FA300000A6F2800000A262A00000042534A4201000100000000000C00000076322E302E35303732370000000005006C000000800F0000237E0000EC0F0000A811000023537472696E6773000000009421000070080000235553'+
'00042A0000100000002347554944000000142A0000F008000023426C6F620000000000000002000001579FA2090902000000FA01330016000001000000650000000C000000100000004F0000005100000003000000A30000000800000013000000010000'+
'00160000000200000005000000050000000800000001000000040000000100000000003B0801000000000006005805630D0600ED05630D060078041C0D0F00830D00000600A3053A090600A0043A0906003B053A09060007053A090600D4053A09060078'+
'053A090600EC043A0906008C04440D0600BE0577080600B7043A090600C90E77080A002605A50C0A00D301A50C0600CA02870E0A009105A50C0A00C906920D0600370011010600CF0B6D000E00D710480E0A001F00920D0600280011010A00A6092D0F12'+
'009C03730E0600970A7A1106009F0A77080600290B1D0906007D101D090A00C20EA50C0A00D004A50C0600C70377080A00C002920D0A005306A50C0A003C11920D0A006504A50C0600410177080A009A0E920D0600180011010600320C5310A700E70C00'+
'000A009C0B2D0F0A009E028F000A00B8108F000A00AD038F000A001A08920D0A00E502920D0A005F03920D06006E0377080600DE0E77080600E70B6D0006006F0C6D000600830877080600D80C870E0A00BA088F000600D60277080A008808920D0A00BC'+
'00A50C0A00E201A50C0E0012001101FB00E70C00000600CC0377080A00E60D2D0F0600A20777080600DC0B6D001200EA09730E0A009909A90A0A009B012D0F0A005501A90A0A00250C2D0F0A000B0CA90A06008B0877080A008F0BA90A060030113A0906'+
'0052033A090600F50877080600220077080600E50777080A0078098F000A00E6038F000600E802770806001506770806000D0A77080A004C098F000600E70A77080A00A510A50C0A009403A50C0E000100110106001D0B08090600AA0F77080600FB0B77'+
'080600670A770806004D0077080E00630F25080A00470C2D0F0A00C80C8F000A0061092D0F0A00620C2D0F0A00BB038F00000000004400000000000100010001001000670E77003D0001000100000010000C0D77003D000100050001201000340A770075'+
'000100080000001000FF0C77003D0001000C00090110004A047700890002001000012010004D0A7700750005002A00000010008C0C77003D0005002E00000010007C0C77003D000600360081011000A70D77003D0007003F0000001000030277003D0007'+
'00440003010000B80D0000DD000A00500001001602900451805000940451805C0097043100F8019A040100160290040100160290040100C209A204010072027D0301003501A60406068000970456801A0FA9045680CB07A9045680BB07A9045680DA07A9'+
'0456805E0BA90456806D0BA9045020000000008618F20C060001005820000000009600E60FAD040100B8200000000091008607B4040200D020000000009100D90FBA04030004210000000086000B0648010600A0210000000091000E04C5040700502000'+
'0000008618F20C06000700F221000000008618F20C06000700FA21000000008618F20C100007000322000000008618F20CA00008000D22000000008418F20CA7000A001722000000008618F20CC9040C002622000000008300A80248010D004522000000'+
'0083003B1048010E004E220000000083006F0148010F006122000000009600360BCF0410007C220000000096000D11D404100094220000000096003303CF041000D4220000000096001207DA04100018250000000096007506E604130059250000000091'+
'004D0BEE0414006825000000009100D909F30415006E26000000009100C508F90416009326000000009100F507FF041800C826000000009100530F040519001C27000000009100DD100E051B00AE29000000009100BA0F1D051D00D5290000000091005D'+
'04FF041E00F6290000000091004A0725051F000E2A000000009100360725052000262A0000000091002007250521003E2A000000009100FD062C0522005B2A0000000091005A0733052300702A00000000910074073A052400C02A000000009608510841'+
'052500C02A00000000E6095A0855002500C02A000000009600440446052500C02A00000000C6007D073E002600CC2A00000000E6012C014D052600CC2A00000000E601570454052700D42A000000009118F80C5B052800F221000000008618F20C060028'+
'00FA21000000008618F20C100028000322000000008618F20CA00029000D22000000008418F20CA7002B00212B000000008618F20CC9042D00302B0000000086009B005F052E00802B000000008100A60167053000D42B000000009100B50B6D053100E0'+
'2B0000000091008602740532002C2C0000000091008A117F053400542C0000000091009B06880536008C2D000000009100BC0A8F053700B72D000000008618F20CC9043800C82D0000000086008E1096053900782E000000008100770B9E053B00D82E00'+
'00000091002F0D6D053C000D2F000000009100C800A4053D002C2F000000009100DD00AF053F005C2F000000009100ED0EBC054100CC2F000000009100340EC60542005030000000009100CF08D4054300C9310000000096009B00DD054400DC31000000'+
'0096007C0CE5054600EF31000000009600B409ED054800FC310000000096002D10ED0549000E320000000096003B10ED054A002032000000008618F20C06004B002E3200000000E6013C0406004B004B320000000086085402F3054B0053320000000081'+
'00D30E06004B007B32000000008100D00E06004B00883200000000860824033E004B00BA32000000008608F9023E004B00C8320000000086007E01F8054B002433000000008400640200064C0074330000000086000D0E08064E00CE3300000000860079'+
'0A100050000C340000000086001B1048015100000001006F10000001006F1000000100CF1002000200F80A02000300FD0800000100C401000001007E02000001007E0200000200250A000001003B0B00000200B01000000100160200000100C401000001'+
'00C40100000100C40100000100EF0200000200010A00000300CE0F00000100430F000001002A0100000100430F00000100151000000200050800000100FB0000000100EF0200000200010A00000100F40B00000200F80F00000100CE0F00000100190300'+
'0001003A06000001003A06000001003A06000001003A06000001003106000001004611000001001510000001001A0D00000100D110000001007E02000001007E0200000200250A000001003B0B00000200B010000001001602000001005F01000002008D'+
'0100000100C40100000100F40B00000100C40100000200F40B00000100C40100000200880000000100880000000100EA0800000100160200000100110B00000200C40100000100110B00000100AA0B00000100AA0B00000200030100000100AA0B000002'+
'00030100000100AA0B000001008800000001001A0E000001005F01000002008D0100000100050B00000200C40100000100C40100000100C40100000100C40100000100BC0100000100400C00000200FE0D00000100AD0600000200BC0600000100350200'+
'000100B31006008D00060091000B00E9000900F20C01001100F20C06001900F20C0A002900F20C10003100F20C10003900F20C10004100F20C10004900F20C10005100F20C10005900F20C10006100F20C15006900F20C15007100F20C10008100F20C06'+
'009900F20C06000901F20C1A003101F20C06007900F20C06000C00F20C0600B100F20C1000B900F20C1000B900B307390011027E083E001102A9074200A100080F47000C0031014D00190277033E00A1005A085500A1001A063E00140005116B00C10008'+
'0F700014001A067600D900F20C8400D100F20C10002902B10806003102F20C060031028A098B0079007D073E0039025F101000390250119100D1013C0406002902360406004102F20C060049026E089A004902D3063E00E900F20C0600E900F20C1000E9'+
'00F20CA000E900F20CA70059023604060061022411AF0061024A03B5006902F108BB0069029F08C1002901080FC60039013E01D4001102F001DA001102BB0EE0001C00650814011C00E40C1A0124006D0F6B001102EA0791008102D3102C0124004A1055'+
'008102B6082C015101F20C01005101800332015101CC0138015101EA0791005101A30F3F014101F20C4801B900F00152012C00181161011102F91071015101F20C06001102A90776011102BB0E7C0159028F02B2011C00F20C06006901B20EB801910279'+
'0F91001102130E390089026508BE0171016508C5011C003101CA013400F20C060034003101CA013400F110D70159024808DD0159026B03E2019101080FE9016101DB0EF20161011708F9016101E202000289011A06070299027D070B0261013911100259'+
'02420617025902830F910059022C015500B900140F1C0291011A0623021102C20E29029901030E2F029901F20C330229011A06C100A1027D070B02A902F20C06002C00F20C06002C0031014D00E90029023E009102E40C6E02C1016D0F740211026C1178'+
'026901280E7E02C9010A033E001102BB0E8402C1014A10550011020C088A02C10060119902D9014B06A3025902220F5500C1009308990279027D073E00C1005A085500D901080FB002D901400BB702C1028B03CA02E901F20CD002C902920FD802C90246'+
'010600C902C010D8026101CF0DE402E901DC0DE4023C00790F91003C00E40C060344006D0F6B0044004A1055003C00F20C06001102C00C3E003C00B20F2D03E101F20C4403E101F20C4C03D902D1035503E10213065B03E101F20C6303E101F20C6D03F1'+
'02F20C1000F90264067803D100F20C06002902E806100001033C04060059029F074200290201043E00A10060087D030903F20C8103D100440287033102C10B8E03090229023E00A100CD0997033102A30EA00319032406A6033902B703AE030E00080060'+
'0408000C006D0408002C007204080030007704080034007C0408003800810408003C008604080040008B0424007B00DB082E000B0020062E00130029062E001B0048062E00230051062E002B007B062E00330089062E003B00B8062E004300BE062E004B'+
'00CE062E005300B8062E005B00B8062E006300D9062E006B00DF0640007300FD06C3008300AF0840028B001E0860028B001E0880028B001E080000010000000600210059007B009500CE00E6004E0167018301870138024202490253025B029202AA02C3'+
'02DF02EA0219033903060001000B000300000060080E0600005E081306000066021706000028031C060000FD021C0602002300030002002400050002004600070002004900090002004A000B00310063000C0124015A01D001FD02100304800000010000'+
'00931FC90D01000000BE0377000000020000000000000000000000B503080100000000020000000000000000000000B5038F0000000000020000000000000000000000B503770800000000020000000000000000000000B503730E000000000C00060000'+
'00004C696E6B65644C6973744E6F64656031004C696E6B65644C69737460310053716C496E743332004B657956616C75655061697260320044696374696F6E6172796032003C4D6F64756C653E004743004E554C4C5F535452494E47004D41585F434F4C'+
'554D4E5F57494454480053797374656D2E494F007453514C74434C520076616C75655F5F00736368656D610053797374656D2E4461746100417373657274526573756C74536574734861766553616D654D657461446174610053716C4D65746144617461'+
'0073656E64456163685265636F72644F6644617461006372656174655265636F7264506F70756C61746564576974684461746100726F7744617461006D657461006D73636F726C69620053797374656D2E436F6C6C656374696F6E732E47656E65726963'+
'00526561640041646400646973706F736564004E6577477569640053656E64526573756C7473456E64004462436F6D6D616E64006578706563746564436F6D6D616E640045786563757465436F6D6D616E640065786563757465436F6D6D616E64006163'+
'7475616C436F6D6D616E640053716C436F6D6D616E6400637265617465536368656D61537472696E6746726F6D436F6D6D616E6400636F6D6D616E6400417070656E6400446174614163636573734B696E640053716C446174615265636F726400526570'+
'6C61636500576869746573706163650054657374446174616261736546616361646500746573744461746162617365466163616465006765745F4D657373616765006661696C7572654D657373616765006164645F496E666F4D65737361676500676574'+
'5F496E666F4D657373616765004F6E496E666F4D65737361676500696E666F4D657373616765006D65737361676500617474656D7074546F476574536368656D615461626C6500446174615461626C6500436170747572654F7574707574546F4C6F6754'+
'61626C6500494E756C6C61626C650049456E756D657261626C650049446973706F7361626C650047657453716C446F75626C65005461626C654E616D65006765745F44617461626173654E616D65006765745F436F6C756D6E4E616D6500636F6C756D6E'+
'4E616D65006765745F5365727665724E616D6500437265617465556E697175654F626A6563744E616D65004765744E616D6500417373656D626C794E616D650053716C4461746554696D65004765744461746554696D6500526561644C696E6500417070'+
'656E644C696E65006765745F506970650053716C50697065005472616E73616374696F6E53636F70650053716C446254797065007365745F436F6D6D616E64547970650056616C756554797065006765745F496E76617269616E7443756C747572650049'+
'6E7465726E616C44617461436F6C6C656374696F6E42617365006765745F446174616261736500437265617465436F6E6E656374696F6E537472696E67546F436F6E74657874446174616261736500436C6F736500446973706F73650050617273650074'+
'53514C745072697661746500577269746500756E71756F74650053716C4D6574686F644174747269627574650044656275676761626C6541747472696275746500436F6D56697369626C6541747472696275746500417373656D626C795469746C654174'+
'7472696275746500417373656D626C794B65794E616D654174747269627574650053716C55736572446566696E65645479706541747472696275746500417373656D626C7954726164656D61726B41747472696275746500417373656D626C79436F6E66'+
'696775726174696F6E4174747269627574650053716C46756E6374696F6E41747472696275746500417373656D626C794465736372697074696F6E41747472696275746500436F6D70696C6174696F6E52656C61786174696F6E73417474726962757465'+
'00417373656D626C7950726F647563744174747269627574650053716C466163657441747472696275746500417373656D626C79436F7079726967687441747472696275746500434C53436F6D706C69616E7441747472696275746500417373656D626C'+
'79436F6D70616E794174747269627574650052756E74696D65436F6D7061746962696C697479417474726962757465004578656375746500546F42797465006765745F56616C7565004164645769746856616C75650064746F56616C756500647456616C'+
'75650047657456616C7565006F705F54727565004942696E61727953657269616C697A6500537570707265737346696E616C697A6500476574416C74657253746174656D656E74576974686F7574536368656D6142696E64696E67006275696C64536368'+
'656D61537472696E67006578706563746564537472696E670061637475616C537472696E670053716C537472696E67006765745F436F6E6E656374696F6E537472696E67007365745F436F6E6E656374696F6E537472696E670053716C4461746554696D'+
'6532546F537472696E67005461626C65546F537472696E6700536D616C6C4461746554696D65546F537472696E670053716C4461746554696D65546F537472696E670053716C44617465546F537472696E670053716C4461746554696D654F6666736574'+
'546F537472696E670053716C42696E617279546F537472696E670047657450726F636564757265546578744173537472696E6700476574537472696E6700537562737472696E670049734D617463680041667465725365636F6E64446173680041667465'+
'72466972737444617368004166746572536C617368004D617468006765745F4C656E677468005472696D546F4D61784C656E677468006C656E67746800537461727473576974680047657453716C446563696D616C0053797374656D2E436F6D706F6E65'+
'6E744D6F64656C007453514C74434C522E646C6C00497344424E756C6C006765745F4E756C6C006765745F49734E756C6C006765745F4974656D007365745F4974656D0053797374656D005472696D00456E756D0053716C426F6F6C65616E006F705F4C'+
'6573735468616E004765745075626C69634B6579546F6B656E004F70656E004D696E0044617461436F6C756D6E00506164436F6C756D6E0063726561746553716C4D65746144617461466F72436F6C756D6E00636F6C756D6E006765745F56657273696F'+
'6E00416E6E6F746174696F6E0053797374656D2E476C6F62616C697A6174696F6E0053797374656D2E52756E74696D652E53657269616C697A6174696F6E0053797374656D2E5265666C656374696F6E0044617461436F6C756D6E436F6C6C656374696F'+
'6E0053716C506172616D65746572436F6C6C656374696F6E0044617461526F77436F6C6C656374696F6E007365745F436F6E6E656374696F6E004462436F6E6E656374696F6E0053716C436F6E6E656374696F6E004E6577436F6E6E656374696F6E0063'+
'6F6E6E656374696F6E006F705F4164646974696F6E004765745374617274506F736974696F6E005472616E73616374696F6E53636F70654F7074696F6E004F726465724F7074696F6E004E6F74496D706C656D656E746564457863657074696F6E00696E'+
'6E6572457863657074696F6E00436F6D6D616E644578656375746F72457863657074696F6E00496E76616C6964526573756C74536574457863657074696F6E00417267756D656E74457863657074696F6E006661696C5465737443617365416E64546872'+
'6F77457863657074696F6E005365637572697479457863657074696F6E0053797374656D2E446174612E436F6D6D6F6E00636F6C756D6E50726F7065727479497356616C6964466F724D65746144617461436F6D70617269736F6E00537472696E67436F'+
'6D70617269736F6E00416E6E6F746174696F6E4E6F00726573756C745365744E6F00726573756C747365744E6F0043756C74757265496E666F0053657269616C697A6174696F6E496E666F00696E666F006F705F426974776973654F7200497357686974'+
'65737061636543686172004166746572536C61736853746172004166746572537461720076616C6964617465526573756C745365744E756D626572004462446174615265616465720053716C44617461526561646572006461746152656164657200636C'+
'6F7365526561646572004578656375746552656164657200537472696E6752656164657200546578745265616465720042696E617279526561646572007265616465720049466F726D617450726F7669646572004462436F6E6E656374696F6E53747269'+
'6E674275696C6465720053716C436F6E6E656374696F6E537472696E674275696C6465720073656E6465720053716C496E666F4D6573736167654576656E7448616E646C65720053716C506172616D657465720042696E61727957726974657200526573'+
'756C7453657446696C746572004D65746144617461457175616C6974794173736572746572004D6963726F736F66742E53716C5365727665722E53657276657200546F4C6F77657200436F6D6D616E644265686176696F720049456E756D657261746F72'+
'00476574456E756D657261746F72002E63746F72002E6363746F72004F7574707574436170746F7200436F6D6D616E644578656375746F720053797374656D2E446961676E6F73746963730073656E64526573756C747365745265636F72647300537973'+
'74656D2E52756E74696D652E496E7465726F7053657276696365730053797374656D2E52756E74696D652E436F6D70696C6572536572766963657300446562756767696E674D6F6465730053797374656D2E446174612E53716C54797065730053746F72'+
'656450726F63656475726573004765745374617274506F736974696F6E5374617465730047657453716C56616C7565730053657456616C7565730053716C496E666F4D6573736167654576656E74417267730061726773006765745F5469636B73006173'+
'73657274457175616C7300636F6C756D6E44657461696C73006765745F436F6C756D6E7300676574446973706C61796564436F6C756D6E730053797374656D2E546578742E526567756C617245787072657373696F6E7300416E6E6F746174696F6E7300'+
'53797374656D2E5472616E73616374696F6E730053797374656D2E436F6C6C656374696F6E730053716C4368617273006765745F506172616D6574657273006765745F526F777300436F6E63617400466F726D6174004F626A65637400646973636F6E6E'+
'656374004765744461746554696D654F6666736574006372656174654D65746144617461466F72526573756C74736574006F705F496D706C696369740053706C69740044656661756C74004E657874526573756C740053797374656D2E446174612E5371'+
'6C436C69656E740063726561746553746174656D656E740067657453716C53746174656D656E7400436F6D706F6E656E74006765745F43757272656E74006765745F436F756E74006765745F4669656C64436F756E740053656E64526573756C74735374'+
'61727400496E7365727400436F6E76657274004164644C6173740053706C6974436F6C756D6E4E616D654C69737400436F6C756D6E4C6973740050726F63657373526F77466F72476574416E6E6F746174696F6E4C697374005072696E744F6E6C79436F'+
'6C756D6E4E616D65416C6961734C69737400696E707574006C6F6743617074757265644F757470757400436170747572654F75747075740053757070726573734F7574707574004D6F76654E6578740053797374656D2E54657874007365745F436F6D6D'+
'616E64546578740070726F636564757265546578740053747265616D696E67436F6E746578740073656E6453656C6563746564526573756C74536574546F53716C436F6E7465787400636F6E746578740044617461526F770053656E64526573756C7473'+
'526F7700726F77004D6178005265676578006765745461626C65537472696E67417272617900546F417272617900546F436861724172726179006765745F4B6579005369676E696E674B657900436F6E7461696E734B657900476574457865637574696E'+
'67417373656D626C790047657453716C42696E6172790073716C42696E61727900457865637574654E6F6E5175657279006F705F457175616C697479006F705F496E657175616C6974790053797374656D2E5365637572697479007468726F7745786365'+
'7074696F6E4966536368656D614973456D70747900001F5E005C0073002A002D002D005C005B0040007400530051004C0074003A0001010080B34500720072006F007200200063006F006E006E0065006300740069006E006700200074006F0020006400'+
'61007400610062006100730065002E00200059006F00750020006D006100790020006E00650065006400200074006F00200063007200650061007400650020007400530051004C007400200061007300730065006D0062006C0079002000770069007400'+
'68002000450058005400450052004E0041004C005F004100430043004500530053002E0000174400610074006100200053006F007500720063006500002749006E0074006500670072006100740065006400200053006500630075007200690074007900'+
'001F49006E0069007400690061006C00200043006100740061006C006F00670000237400530051004C0074005F00740065006D0070006F0062006A006500630074005F0000032D0001354F0062006A0065006300740020006E0061006D00650020006300'+
'61006E006E006F00740020006200650020004E0055004C004C0000037C0000032B0000634300520045004100540045005C0073002B00560049004500570028005C0073002A002E002A003F005C0073002A00290057004900540048005C0073002B005300'+
'4300480045004D004100420049004E00440049004E0047005C0073002B0041005300001D41004C00540045005200200056004900450057002400310041005300001975006E006500780070006500630074006500640020002F0000032000000B3C002E00'+
'2E002E003E00001D530045004C0045004300540020002A002000460052004F004D002000001520004F0052004400450052002000420059002000001543006F006C0075006D006E004E0061006D00650000055D005D0000035D00000D21004E0055004C00'+
'4C0021000019500072006F00760069006400650072005400790070006500002930002E0030003000300030003000300030003000300030003000300030003000300045002B00300000055D002C0000052C005B00000B5C005D002C005C005B0000035B00'+
'001D7B0030003A0079007900790079002D004D004D002D00640064007D0001377B0030003A0079007900790079002D004D004D002D00640064002000480048003A006D006D003A00730073002E006600660066007D0001297B0030003A00790079007900'+
'79002D004D004D002D00640064002000480048003A006D006D007D00013F7B0030003A0079007900790079002D004D004D002D00640064002000480048003A006D006D003A00730073002E0066006600660066006600660066007D0001477B0030003A00'+
'79007900790079002D004D004D002D00640064002000480048003A006D006D003A00730073002E00660066006600660066006600660020007A007A007A007D0001053000780000055800320000737400530051004C007400500072006900760061007400'+
'650020006900730020006E006F007400200069006E00740065006E00640065006400200074006F002000620065002000750073006500640020006F0075007400730069006400650020006F00660020007400530051004C0074002100001B540068006500'+
'200063006F006D006D0061006E00640020005B0000475D00200064006900640020006E006F0074002000720065007400750072006E00200061002000760061006C0069006400200072006500730075006C0074002000730065007400003B5D0020006400'+
'6900640020006E006F0074002000720065007400750072006E0020006100200072006500730075006C0074002000730065007400001149007300480069006400640065006E000009540072007500650000037B0000033A0000037D000005490073000009'+
'4200610073006500003145007800650063007500740069006F006E002000720065007400750072006E006500640020006F006E006C00790020000031200052006500730075006C00740053006500740073002E00200052006500730075006C0074005300'+
'6500740020005B0000235D00200064006F006500730020006E006F0074002000650078006900730074002E00005D52006500730075006C007400530065007400200069006E00640065007800200062006500670069006E00730020006100740020003100'+
'2E00200052006500730075006C007400530065007400200069006E0064006500780020005B00001B5D00200069007300200069006E00760061006C00690064002E0000097400720075006500001144006100740061005400790070006500001543006F00'+
'6C0075006D006E00530069007A00650000214E0075006D00650072006900630050007200650063006900730069006F006E0000194E0075006D0065007200690063005300630061006C006500001541007200670075006D0065006E00740020005B000047'+
'5D0020006900730020006E006F0074002000760061006C0069006400200066006F007200200052006500730075006C007400530065007400460069006C007400650072002E00003143006F006E007400650078007400200043006F006E006E0065006300'+
'740069006F006E003D0074007200750065003B000049530045004C004500430054002000530045005200560045005200500052004F0050004500520054005900280027005300650072007600650072004E0061006D006500270029003B0001050D000A00'+
'00317400530051004C0074002E0041007300730065007200740045007100750061006C00730053007400720069006E006700001145007800700065006300740065006400000D410063007400750061006C0000157400530051004C0074002E0046006100'+
'69006C0000114D006500730073006100670065003000002F7400530051004C0074002E004C006F006700430061007000740075007200650064004F0075007400700075007400000974006500780074000054E676F0AE1C744AB26E0953546BB505000420'+
'01010803200001052001011111042001010E0420010102062001011180810F0705151255020811510812590E125D0715125502081151042001020E0320000E0420010E0805000111510E0720020113001301032000020907011511650208115107151165'+
'02081151042000130005000111610804200013010807031269126D127106200101118111052001011269032000080407020E0E052002010E1C062002010E1275072002011279117D0500001281310520001281350520001281390420001D050700011180'+
'951D0505070111809D05000011809D0520020E0E0E0500020E0E0E2507110E151280A5011D0E081D0808021280A9151180AD011D0E1D0E08081D0808081D0E080807151280A5011D0E052001130008092000151180AD01130007151180AD011D0E050002'+
'0808080520001280A90620011280A90E0820031280A9080E08052001011151030701080720040E0E0E0808061512550203020520010213000907051D0308113008080420001D030520020E08080600030E0E0E0E0307010E2A07101280B5151280A5011D'+
'0E081D0E081280B9151280A5010E1D0E080E1D0E081180BD1180C11180C50D0520001280B50520001281450620011280B9080420011C0E05200101130006151280A5010E0520001D130004200102080620011180CD080800011180C91180CD0620011180'+
'D1080620011180C1080620011180C5080320000D0420010E0E062001118095080420011C080600021D0E0E0E0520001180CD0500020E0E1C0320000A042001010A0907041280A91D0508050607030E0E121C0907031280B11280B50E0707021280B51275'+
'1207060E1280E11280B91280E11280E51280E90520001280E10320001C050002020E0E0520001281590500010E1D0E072002020E11815D0607021280B1080900021180ED11611161060001021180ED0507011180ED0600011180ED020B00021180ED1180'+
'ED1180ED0607011D1280F1050000128165072001011D1280F1062001011280F50407011D1C052001081D1C1207041D1280F108151180FD011280B91280B908151280F9011280B9092000151180FD01130008151180FD011280B9130704151280F9011280'+
'B91280E11280B91280E90B20011512816901130013000A07041180BD0E12810108072002010E1180BD082003010E1180BD0A05000012816D070002051C128175092004010E1180BD05050A2003010E1180BD128101040001011C03061151052002011C18'+
'062001011281850820011280B111818908000211511151115105200012818D0720021281910E1C0620010111819508B77A5C561934E08980A00024000004800000940000000602000000240000525341310004000001000100B9AF416AD8DFEDEC08A565'+
'2FA257F1242BF4ED60EF5A7B84A429604D62C919C5663A9C7710A7C5DF9953B69EC89FCE85D71E051140B273F4C9BF890A2BC19C48F22D7B1F1D739F90EEBC5729555F7F8B63ED088BBB083B336F7E38B92D44CFE1C842F09632B85114772FF2122BC638'+
'C78D497C4E88C2D656C166050D6E1EF3940C21004E0055004C004C002100049B0000000400000000040100000004020000000403000000040400000004050000000306122C02060E02060807061512550203020306126902060203061130060001124911'+
'510500010E11510A0003011C1011611011510300000E05200101122C04000011510500001180950B00031280A11151115111510700011280A1115104000102030500010811510500020E0E080400010E0E0900020E1011511011510E0002151280A5011D'+
'0E1280B111510700011D0E1011510600010E1180C90600010E1180CD0600010E1180D10600010E118095040000111806000111181151062001011280D5062001011280D90300000107200201115111510520010E1151060001011280B10A00021280B511'+
'511280B10800020111511280B50600010E1280B5060001021280E507200201116111510520010111610A0002011280B11D1280F10C00021280F51280B11D1280F10900011D1280F11280B10D0001151280F9011280B91280B50800011280F11280B90700'+
'020111511151070002011161115105000101115104200011510720011280B11151072002011C128105052002010E0E04080011180328000204280011510328000E0801000800000000001E01000100540216577261704E6F6E457863657074696F6E5468'+
'726F77730108010002000000000029010024436F7079726967687420C2A9202073716C6974792E6E65742032303130202D203230313500000D0100087453514C74434C5200002E010029434C527320666F7220746865207453514C7420756E6974207465'+
'7374696E67206672616D65776F726B00000501000000000F01000A73716C6974792E6E657400000A0100057453514C7400000501000100001D0100187453514C745F4F6666696369616C5369676E696E674B65790000811F010005005455794D6963726F'+
'736F66742E53716C5365727665722E5365727665722E446174614163636573734B696E642C2053797374656D2E446174612C2056657273696F6E3D322E302E302E302C2043756C747572653D6E65757472616C2C205075626C69634B6579546F6B656E3D'+
'623737613563353631393334653038390A446174614163636573730000000054020F497344657465726D696E69737469630154020949735072656369736501540E0F5461626C65446566696E6974696F6E2A416E6E6F746174696F6E4E6F20494E542C20'+
'416E6E6F746174696F6E204E56415243484152284D415829540E1146696C6C526F774D6574686F644E616D651E50726F63657373526F77466F72476574416E6E6F746174696F6E4C697374808F010001005455794D6963726F736F66742E53716C536572'+
'7665722E5365727665722E446174614163636573734B696E642C2053797374656D2E446174612C2056657273696F6E3D322E302E302E302C2043756C747572653D6E65757472616C2C205075626C69634B6579546F6B656E3D6237376135633536313933'+
'34653038390A44617461416363657373010000002B010002000000020054080B4D61784279746553697A650100000054020D497346697865644C656E6774680112010001005408074D617853697A65FFFFFFFF0000EB06C2A28199175C1922F5244EB4E5'+
'C34276704E2B0009A88E85A27E4741464DB89E7361541154C9F705E6DD8FAA066C344E1BFA5475F9A78F2A40EFE883C693BC06F9E884930BA96DC66A978A6B46E807369489DB3AC6281D56A59DA5B714A02FAFC53F42C54D07638EB7A28B148F5BFA306A'+
'FC47356B5C63AD86B42E68C0510000000095AB0D6200000000020000001C010000FC670000FC490000525344537D89B6DEAF5FB54A96906274BAF65C4F01000000443A5C615C315C7453514C745C7453514C74434C525C7453514C74434C525C6F626A5C'+
'437275697365436F6E74726F6C5C7453514C74434C522E7064620000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'000000000000000000000000000000000000000000000000004069000000000000000000005A6900000020000000000000000000000000000000000000000000004C690000000000000000000000005F436F72446C6C4D61696E006D73636F7265652E64'+
'6C6C0000000000FF2500200010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100100000001800008000000000000000000000000000000100010000'+
'003000008000000000000000000000000000000100000000004800000058800000C00300000000000000000000C00334000000560053005F00560045005200530049004F004E005F0049004E0046004F0000000000BD04EFFE0000010000000100C90D93'+
'1F00000100C90D931F3F000000000000000400000002000000000000000000000000000000440000000100560061007200460069006C00650049006E0066006F00000000002400040000005400720061006E0073006C006100740069006F006E00000000'+
'000000B00420030000010053007400720069006E006700460069006C00650049006E0066006F000000FC02000001003000300030003000300034006200300000006C002A00010043006F006D006D0065006E0074007300000043004C0052007300200066'+
'006F007200200074006800650020007400530051004C007400200075006E00690074002000740065007300740069006E00670020006600720061006D00650077006F0072006B00000036000B00010043006F006D00700061006E0079004E0061006D0065'+
'0000000000730071006C006900740079002E006E0065007400000000003A0009000100460069006C0065004400650073006300720069007000740069006F006E00000000007400530051004C00740043004C005200000000003C000E000100460069006C'+
'006500560065007200730069006F006E000000000031002E0030002E0038003000380033002E00330035003200390000003A000D00010049006E007400650072006E0061006C004E0061006D00650000007400530051004C00740043004C0052002E0064'+
'006C006C00000000006C00240001004C006500670061006C0043006F007000790072006900670068007400000043006F0070007900720069006700680074002000A90020002000730071006C006900740079002E006E0065007400200032003000310030'+
'0020002D002000320030003100350000002A00010001004C006500670061006C00540072006100640065006D00610072006B007300000000000000000042000D0001004F0072006900670069006E0061006C00460069006C0065006E0061006D00650000'+
'007400530051004C00740043004C0052002E0064006C006C00000000002C0006000100500072006F0064007500630074004E0061006D006500000000007400530051004C007400000040000E000100500072006F00640075006300740056006500720073'+
'0069006F006E00000031002E0030002E0038003000380033002E003300350032003900000044000E00010041007300730065006D0062006C0079002000560065007200730069006F006E00000031002E0030002E0038003000380033002E003300350032'+
'00390000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000C0000'+
'006C3900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'+
'0000000000'+
' WITH PERMISSION_SET = SAFE;';
EXEC(@cmd);
GO



GO

GO

CREATE PROCEDURE tSQLt.ResultSetFilter @ResultsetNo INT, @Command NVARCHAR(MAX)
AS
EXTERNAL NAME tSQLtCLR.[tSQLtCLR.StoredProcedures].ResultSetFilter;
GO

CREATE PROCEDURE tSQLt.AssertResultSetsHaveSameMetaData @expectedCommand NVARCHAR(MAX), @actualCommand NVARCHAR(MAX)
AS
EXTERNAL NAME tSQLtCLR.[tSQLtCLR.StoredProcedures].AssertResultSetsHaveSameMetaData;
GO

CREATE TYPE tSQLt.[Private] EXTERNAL NAME tSQLtCLR.[tSQLtCLR.tSQLtPrivate];
GO

CREATE PROCEDURE tSQLt.NewConnection @command NVARCHAR(MAX)
AS
EXTERNAL NAME tSQLtCLR.[tSQLtCLR.StoredProcedures].NewConnection;
GO

CREATE PROCEDURE tSQLt.CaptureOutput @command NVARCHAR(MAX)
AS
EXTERNAL NAME tSQLtCLR.[tSQLtCLR.StoredProcedures].CaptureOutput;
GO

CREATE PROCEDURE tSQLt.SuppressOutput @command NVARCHAR(MAX)
AS
EXTERNAL NAME tSQLtCLR.[tSQLtCLR.StoredProcedures].SuppressOutput;
GO

CREATE FUNCTION tSQLt.Private_GetAnnotationList(@ProcedureDefinition NVARCHAR(MAX))
   RETURNS TABLE(AnnotationNo INT, Annotation NVARCHAR(MAX))
   AS EXTERNAL NAME tSQLtCLR.[tSQLtCLR.Annotations].GetAnnotationList;

GO



GO

CREATE PROCEDURE tSQLt.Private_PrepareFakeFunctionOutputTable
    @FakeDataSource NVARCHAR(MAX),
    @OutputTable    NVARCHAR(MAX) OUTPUT
AS
    BEGIN
        SET @OutputTable = tSQLt.Private::CreateUniqueObjectName();

        IF ( LOWER(LTRIM(@FakeDataSource)) LIKE 'select%'
             AND OBJECT_ID(@FakeDataSource) IS NULL
           )
            BEGIN
                SET @FakeDataSource = N'('+ @FakeDataSource + N') a';
            END;

        DECLARE @Cmd NVARCHAR(MAX) = N'SELECT * INTO ' + @OutputTable + N' FROM ' + @FakeDataSource;

        EXEC sp_executesql @Cmd;

        RETURN 0;
    END;


GO

GO
CREATE PROCEDURE tSQLt.TableToText
    @txt NVARCHAR(MAX) OUTPUT,
    @TableName NVARCHAR(MAX),
    @OrderBy NVARCHAR(MAX) = NULL,
    @PrintOnlyColumnNameAliasList NVARCHAR(MAX) = NULL
AS
BEGIN
    SET @txt = tSQLt.Private::TableToString(@TableName, @OrderBy, @PrintOnlyColumnNameAliasList);
END;
GO


GO

CREATE TABLE tSQLt.Private_RenamedObjectLog (
  Id INT IDENTITY(1,1) CONSTRAINT PK__Private_RenamedObjectLog__Id PRIMARY KEY CLUSTERED,
  ObjectId INT NOT NULL,
  OriginalName NVARCHAR(MAX) NOT NULL
);


GO

CREATE PROCEDURE tSQLt.Private_RenameObject
    @SchemaName NVARCHAR(MAX),
    @ObjectName NVARCHAR(MAX),
    @NewName NVARCHAR(MAX)
AS
BEGIN
   DECLARE @RenameCmd NVARCHAR(MAX);
   SET @RenameCmd = 'EXEC sp_rename ''' + 
                    REPLACE(@SchemaName + '.' + @ObjectName, '''', '''''') + ''', ''' + 
                    REPLACE(@NewName, '''', '''''') + ''',''OBJECT'';';
   
   EXEC tSQLt.SuppressOutput @RenameCmd;
END;


GO

CREATE PROCEDURE tSQLt.Private_MarkObjectBeforeRename
    @SchemaName NVARCHAR(MAX), 
    @OriginalName NVARCHAR(MAX)
AS
BEGIN
  INSERT INTO tSQLt.Private_RenamedObjectLog (ObjectId, OriginalName) 
  VALUES (OBJECT_ID(@SchemaName + '.' + @OriginalName), @OriginalName);
END;


GO

CREATE PROCEDURE tSQLt.Private_RenameObjectToUniqueName
    @SchemaName NVARCHAR(MAX),
    @ObjectName NVARCHAR(MAX),
    @NewName NVARCHAR(MAX) = NULL OUTPUT
AS
BEGIN
   SET @NewName=ISNULL(@NewName, tSQLt.Private::CreateUniqueObjectName());
   
   EXEC tSQLt.Private_MarkObjectBeforeRename @SchemaName, @ObjectName;

   EXEC tSQLt.Private_RenameObject @SchemaName,
                                   @ObjectName,
                                   @NewName;

END;


GO

CREATE PROCEDURE tSQLt.Private_RenameObjectToUniqueNameUsingObjectId
    @ObjectId INT,
    @NewName NVARCHAR(MAX) = NULL OUTPUT
AS
BEGIN
   DECLARE @SchemaName NVARCHAR(MAX);
   DECLARE @ObjectName NVARCHAR(MAX);
   
   SELECT @SchemaName = QUOTENAME(OBJECT_SCHEMA_NAME(@ObjectId)), @ObjectName = QUOTENAME(OBJECT_NAME(@ObjectId));
   
   EXEC tSQLt.Private_RenameObjectToUniqueName @SchemaName,@ObjectName, @NewName OUTPUT;
END;


GO

GO
CREATE PROCEDURE tSQLt.RemoveObject 
    @ObjectName NVARCHAR(MAX),
    @NewName NVARCHAR(MAX) = NULL OUTPUT,
    @IfExists INT = 0
AS
BEGIN
  DECLARE @ObjectId INT;
  SELECT @ObjectId = OBJECT_ID(@ObjectName);
  
  IF(@ObjectId IS NULL)
  BEGIN
    IF(@IfExists = 1) RETURN;
    RAISERROR('%s does not exist!',16,10,@ObjectName);
  END;

  EXEC tSQLt.Private_RenameObjectToUniqueNameUsingObjectId @ObjectId, @NewName = @NewName OUTPUT;
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.RemoveObjectIfExists 
    @ObjectName NVARCHAR(MAX),
    @NewName NVARCHAR(MAX) = NULL OUTPUT
AS
BEGIN
  EXEC tSQLt.RemoveObject @ObjectName = @ObjectName, @NewName = @NewName OUT, @IfExists = 1;
END;
GO


GO

CREATE FUNCTION tSQLt.Private_GetFormattedErrorInfo()
RETURNS TABLE
AS
RETURN
  SELECT 'Message: ' + ISNULL(ERROR_MESSAGE(),'<NULL>') + ' | Procedure: ' + ISNULL(ERROR_PROCEDURE(),'<NULL>') + ISNULL(' (' + CAST(ERROR_LINE() AS NVARCHAR(MAX)) + ')','') + ' | Severity, State: ' + ISNULL(CAST(ERROR_SEVERITY() AS NVARCHAR(MAX)),'<NULL>') + ', ' + ISNULL(CAST(ERROR_STATE() AS NVARCHAR(MAX)), '<NULL>') + ' | Number: ' + ISNULL(CAST(ERROR_NUMBER() AS NVARCHAR(MAX)), '<NULL>') AS FormattedError;
GO


GO

GO
CREATE FUNCTION tSQLt.Private_HandleMessageAndResult (
  @PrevMessage NVARCHAR(MAX),
  @PrevResult NVARCHAR(MAX),
  @NewMessage NVARCHAR(MAX),
  @NewResult NVARCHAR(MAX)
)
RETURNS TABLE
AS
RETURN
  SELECT CASE WHEN ISNULL(@PrevMessage,'') NOT LIKE '%[^ '+CHAR(9)+']%' AND @PrevResult = 'Success' THEN '' 
              ELSE CASE WHEN @PrevMessage NOT LIKE '%[^ '+CHAR(9)+']%' THEN '<empty>' ELSE ISNULL(@PrevMessage,'<NULL>') END+' [Result: '+
                   CASE WHEN @PrevResult NOT LIKE '%[^ '+CHAR(9)+']%' THEN '<empty>' ELSE ISNULL(@PrevResult,'<NULL>') END+'] || ' 
         END+
         CASE WHEN @NewMessage NOT LIKE '%[^ '+CHAR(9)+']%' THEN '<empty>' ELSE ISNULL(@NewMessage,'<NULL>') END Message,
         (SELECT TOP(1) Result FROM tSQLt.Private_Results WHERE Result IN (@PrevResult, @NewResult) ORDER BY Severity DESC) Result;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_CleanTestResult
AS
BEGIN
   DELETE FROM tSQLt.TestResult;
END;
GO


GO

GO
CREATE FUNCTION tSQLt.Private_ListTestAnnotations(
  @TestObjectId INT
)
RETURNS TABLE
AS
RETURN
  SELECT 
      GAL.AnnotationNo,
      REPLACE(GAL.Annotation,'''','''''') AS EscapedAnnotationString,
      'tSQLt.'+GAL.Annotation AS Annotation
    FROM tSQLt.Private_GetAnnotationList(OBJECT_DEFINITION(@TestObjectId))AS GAL;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_ProcessTestAnnotations
  @TestObjectId INT
AS
BEGIN
  DECLARE @Cmd NVARCHAR(MAX);
  DECLARE @UnmatchedQuotesAnnotation NVARCHAR(MAX);
  CREATE TABLE #AnnotationCommands(AnnotationOrderNo INT, AnnotationString NVARCHAR(MAX), AnnotationCmd NVARCHAR(MAX));

  SELECT * INTO #AnnotationList FROM tSQLt.Private_ListTestAnnotations(@TestObjectId);
  SET @UnmatchedQuotesAnnotation = NULL;
  SELECT TOP(1) @UnmatchedQuotesAnnotation = AL.Annotation 
    FROM #AnnotationList AS AL 
   WHERE (LEN(AL.Annotation ) - LEN(REPLACE(AL.Annotation, '''', '')))%2=1
   ORDER BY AL.AnnotationNo;

  IF(@UnmatchedQuotesAnnotation IS NOT NULL)
  BEGIN
    RAISERROR('Annotation has unmatched quote: %s',16,10,@UnmatchedQuotesAnnotation);
  END;

  SELECT @Cmd = 
    'DECLARE @EM NVARCHAR(MAX),@ES INT,@ET INT,@EP NVARCHAR(MAX);'+
    (
      SELECT 
         'BEGIN TRY;INSERT INTO #AnnotationCommands '+
                'SELECT '+
                 CAST(AL.AnnotationNo AS NVARCHAR(MAX))+','+
                 ''''+AL.EscapedAnnotationString+''''+
                 ',A.AnnotationCmd FROM '+
         AL.Annotation+' AS A;'+
         ';END TRY BEGIN CATCH;'+
         'SELECT @EM=ERROR_MESSAGE(),'+--REPLACE(ERROR_MESSAGE(),'''''''',''''''''''''),'+
                '@ES=ERROR_SEVERITY(),'+
                '@ET=ERROR_STATE();'+
         'RAISERROR(''There is an internal error for annotation: %s'+CHAR(13)+CHAR(10)+
                    '  caused by {%i,%i} %s'',16,10,'''+
                    AL.EscapedAnnotationString+
                    ''',@ES,@ET,@EM);'+
         'END CATCH;' 
        FROM #AnnotationList AS AL
       ORDER BY AL.AnnotationNo
         FOR XML PATH,TYPE
    ).value('.','NVARCHAR(MAX)');

  IF(@Cmd IS NOT NULL)
  BEGIN
  --PRINT '--------------------------------';
  --PRINT @Cmd
  --PRINT '--------------------------------';
  BEGIN TRY
    EXEC(@Cmd);
  END TRY
  BEGIN CATCH
    DECLARE @EM NVARCHAR(MAX),@ES INT,@ET INT,@EP NVARCHAR(MAX);
    SELECT @EM=REPLACE(ERROR_MESSAGE(),'''',''''''),
           @ES=ERROR_SEVERITY(),
           @ET=ERROR_STATE();
    DECLARE @NewErrorMessage NVARCHAR(MAX)=
              'There is a problem with the annotations:'+CHAR(13)+CHAR(10)+
              'Original Error: {%i,%i} %s'
    RAISERROR(@NewErrorMessage,16,10,@ES,@ET,@EM);
  END CATCH;
  --PRINT '--------------------------------';


    SELECT @Cmd = 
    'DECLARE @EM NVARCHAR(MAX),@ES INT,@ET INT,@EP NVARCHAR(MAX);'+
    (
      SELECT 
         'BEGIN TRY;'+
         'IF(NOT EXISTS(SELECT 1 FROM #SkipTest)) BEGIN '+
         AnnotationCmd+
         ';END'+
         ';END TRY BEGIN CATCH;'+
         'SELECT @EM=ERROR_MESSAGE(),'+--REPLACE(ERROR_MESSAGE(),'''''''',''''''''''''),'+
                '@ES=ERROR_SEVERITY(),'+
                '@ET=ERROR_STATE(),'+
                '@EP=ERROR_PROCEDURE();'+
         'RAISERROR(''There is a problem with this annotation: %s'+CHAR(13)+CHAR(10)+
                    'Original Error: {%i,%i;%s} %s'',16,10,'''+
                    REPLACE(AnnotationString,'''','''''')+
                    ''',@ES,@ET,@EP,@EM);'+
         'END CATCH;' 
        FROM #AnnotationCommands
       ORDER BY AnnotationOrderNo
         FOR XML PATH,TYPE
    ).value('.','NVARCHAR(MAX)');

    IF(@Cmd IS NOT NULL)
    BEGIN
    --PRINT '--------------------------------';
    --PRINT @Cmd
    --PRINT '--------------------------------';
      EXEC(@Cmd);
    END;

  END;

END;
GO


GO

CREATE PROCEDURE tSQLt.ExpectException
@ExpectedMessage NVARCHAR(MAX) = NULL,
@ExpectedSeverity INT = NULL,
@ExpectedState INT = NULL,
@Message NVARCHAR(MAX) = NULL,
@ExpectedMessagePattern NVARCHAR(MAX) = NULL,
@ExpectedErrorNumber INT = NULL
AS
BEGIN
 IF(EXISTS(SELECT 1 FROM #ExpectException WHERE ExpectException = 1))
 BEGIN
   DELETE #ExpectException;
   RAISERROR('Each test can only contain one call to tSQLt.ExpectException.',16,10);
 END;
 
 INSERT INTO #ExpectException(ExpectException, ExpectedMessage, ExpectedSeverity, ExpectedState, ExpectedMessagePattern, ExpectedErrorNumber, FailMessage)
 VALUES(1, @ExpectedMessage, @ExpectedSeverity, @ExpectedState, @ExpectedMessagePattern, @ExpectedErrorNumber, @Message);
END;


GO

CREATE PROCEDURE tSQLt.ExpectNoException
  @Message NVARCHAR(MAX) = NULL
AS
BEGIN
 IF(EXISTS(SELECT 1 FROM #ExpectException WHERE ExpectException = 0))
 BEGIN
   DELETE #ExpectException;
   RAISERROR('Each test can only contain one call to tSQLt.ExpectNoException.',16,10);
 END;
 IF(EXISTS(SELECT 1 FROM #ExpectException WHERE ExpectException = 1))
 BEGIN
   DELETE #ExpectException;
   RAISERROR('tSQLt.ExpectNoException cannot follow tSQLt.ExpectException inside a single test.',16,10);
 END;
 
 INSERT INTO #ExpectException(ExpectException, FailMessage)
 VALUES(0, @Message);
END;


GO

GO
CREATE FUNCTION tSQLt.Private_SqlVersion()
RETURNS TABLE
AS
RETURN
  SELECT 
      CAST(SERVERPROPERTY('ProductVersion')AS NVARCHAR(128)) ProductVersion,
      CAST(SERVERPROPERTY('Edition')AS NVARCHAR(128)) Edition
GO


GO

GO
CREATE FUNCTION tSQLt.Private_SplitSqlVersion(@ProductVersion NVARCHAR(128))
/* Important: Do not rename the @ProducVersion parameter! */
RETURNS TABLE
AS
RETURN
/* Important: Do not rename the @ProducVersion parameter! */
/*StartSnip*/
SELECT REVERSE(PARSENAME(X.RP,1)) Major,
       REVERSE(PARSENAME(X.RP,2)) Minor, 
       REVERSE(PARSENAME(X.RP,3)) Build,
       REVERSE(PARSENAME(X.RP,4)) Revision
  FROM (SELECT REVERSE(@ProductVersion)) AS X(RP)
/*EndSnip*/
;
/* Important: Do not rename the @ProducVersion parameter! */
GO


GO

GO
CREATE FUNCTION tSQLt.FriendlySQLServerVersion(@ProductVersion NVARCHAR(128))
/* Important: Do not rename the @ProductVersion parameter! */
RETURNS TABLE
AS
RETURN
/* Important: Do not rename the @ProductVersion parameter! */
/*StartSnip*/
  SELECT 
      @ProductVersion ProductVersion, 
      CASE 
        WHEN SSV.Major = '15' THEN '2019' 
        WHEN SSV.Major = '14' THEN '2017' 
        WHEN SSV.Major = '13' THEN '2016' 
        WHEN SSV.Major = '12' THEN '2014' 
        WHEN SSV.Major = '11' THEN '2012' 
        WHEN SSV.Major = '10' AND SSV.Minor IN ('50','5') THEN '2008R2' 
        WHEN SSV.Major = '10' AND SSV.Minor IN ('00','0') THEN '2008' 
       END FriendlyVersion
/*EndSnip*/
/* Important: Do not rename the @ProductVersion parameter! */
    FROM tSQLt.Private_SplitSqlVersion(@ProductVersion) AS SSV;
GO


GO

GO
CREATE FUNCTION tSQLt.Info()
RETURNS TABLE
AS
RETURN
SELECT Version = '1.0.8083.3529',
       ClrVersion = (SELECT tSQLt.Private::Info()),
       ClrSigningKey = (SELECT tSQLt.Private::SigningKey()),
       InstalledOnSqlVersion = (SELECT SqlVersion FROM tSQLt.Private_InstallationInfo()),
       V.SqlVersion,
       V.SqlBuild,
       V.SqlEdition,
       V.HostPlatform
  FROM
  (
    SELECT CAST(PSSV.Major+'.'+PSSV.Minor AS NUMERIC(10,2)) AS SqlVersion,
           CAST(PSSV.Build+'.'+PSSV.Revision AS NUMERIC(10,2)) AS SqlBuild,
           PSV.Edition AS SqlEdition,
           PHP.host_platform AS HostPlatform
          FROM tSQLt.Private_SqlVersion() AS PSV
         CROSS APPLY tSQLt.Private_SplitSqlVersion(PSV.ProductVersion) AS PSSV
         CROSS JOIN tSQLt.Private_HostPlatform AS PHP
  )V;
GO


GO

GO
CREATE TABLE tSQLt.Private_Seize(
  Kaput BIT CONSTRAINT [Private_Seize:PK] PRIMARY KEY CONSTRAINT [Private_Seize:CHK] CHECK(Kaput=1)
);
GO
CREATE TABLE tSQLt.Private_Seize_NoTruncate(
  NoTruncate BIT CONSTRAINT [Private_Seize_NoTruncate(NoTruncate):FK] FOREIGN KEY REFERENCES tSQLt.Private_Seize(Kaput)
);
GO
CREATE TRIGGER tSQLt.Private_Seize_Stop ON tSQLt.Private_Seize INSTEAD OF DELETE,UPDATE
AS
BEGIN 
  RAISERROR('This is a private table that you should not mess with!',16,10);
END;
GO

  


GO

GO
CREATE PROCEDURE tSQLt.Private_Init
AS
BEGIN
  EXEC tSQLt.Private_CleanTestResult;

  DECLARE @enable BIT; SET @enable = 1;
  DECLARE @version_match BIT;SET @version_match = 0;
  BEGIN TRY
    EXEC sys.sp_executesql N'SELECT @r = CASE WHEN I.Version = I.ClrVersion THEN 1 ELSE 0 END FROM tSQLt.Info() AS I;',N'@r BIT OUTPUT',@version_match OUT;
  END TRY
  BEGIN CATCH
    RAISERROR('Cannot access CLR. Assembly might be in an invalid state. Try running EXEC tSQLt.EnableExternalAccess @enable = 0; or reinstalling tSQLt.',16,10);
    RETURN;
  END CATCH;
  SELECT @version_match = CASE WHEN I.SqlVersion = I.InstalledOnSqlVersion THEN 1 ELSE 0 END FROM tSQLt.Info() AS I WHERE @version_match = 1;
  IF(@version_match = 0 OR EXISTS(SELECT 1 FROM tSQLt.Private_Seize))
  BEGIN
    RAISERROR('tSQLt is in an invalid state. Please reinstall tSQLt.',16,10);
    RETURN;
  END;

  IF(NOT EXISTS(SELECT 1 FROM tSQLt.Info() WHERE SqlEdition = 'SQL Azure'))
  BEGIN
    EXEC tSQLt.EnableExternalAccess @enable = @enable, @try = 1;
  END;
END;
GO


GO

IF((SELECT SqlVersion FROM tSQLt.Info())>=14)
BEGIN
  EXEC('CREATE OR ALTER VIEW tSQLt.Private_HostPlatform AS SELECT host_platform FROM sys.dm_os_host_info;');
END;


GO

GO
CREATE VIEW tSQLt.Private_NoTransactionTableAction
AS
SELECT CAST(Name AS NVARCHAR(MAX)) Name, CAST(Action AS NVARCHAR(MAX)) Action
  FROM(
    VALUES('[tSQLt].[Private_NewTestClassList]','Hide'),
          ('[tSQLt].[Run_LastExecution]','Hide'),
          ('[tSQLt].[Private_Configurations]','Restore'),
          ('[tSQLt].[CaptureOutputLog]','Truncate'),
          ('[tSQLt].[Private_RenamedObjectLog]','Ignore'),
          ('[tSQLt].[Private_Seize]','Ignore'),
          ('[tSQLt].[Private_Seize_NoTruncate]','Ignore'),
          ('[tSQLt].[TestResult]','Restore')
  )X(Name, Action);
GO


GO

CREATE PROCEDURE tSQLt.Private_MarktSQLtTempObject
  @ObjectName NVARCHAR(MAX),
  @ObjectType NVARCHAR(MAX),
  @NewNameOfOriginalObject NVARCHAR(4000) = NULL
AS
BEGIN
  DECLARE @UnquotedSchemaName NVARCHAR(MAX);
  DECLARE @UnquotedObjectName NVARCHAR(MAX);
  DECLARE @UnquotedParentName NVARCHAR(MAX);
  DECLARE @TempObjectFlagOn BIT = 1;
  SELECT 
      @UnquotedSchemaName = SCHEMA_NAME(O.schema_id),
      @UnquotedObjectName = O.name,
      @UnquotedParentName = OBJECT_NAME(O.parent_object_id)
    FROM sys.objects O 
   WHERE O.object_id = OBJECT_ID(@ObjectName);

  IF(@UnquotedParentName IS NULL)
  BEGIN
    EXEC sys.sp_addextendedproperty 
       @name = N'tSQLt.IsTempObject',
       @value = @TempObjectFlagOn, 
       @level0type = N'SCHEMA', @level0name = @UnquotedSchemaName, 
       @level1type = @ObjectType,  @level1name = @UnquotedObjectName;   

    IF(@NewNameOfOriginalObject IS NOT NULL)
    BEGIN
      EXEC sys.sp_addextendedproperty 
         @name = N'tSQLt.Private_TestDouble_OrgObjectName', 
         @value = @NewNameOfOriginalObject, 
         @level0type = N'SCHEMA', @level0name = @UnquotedSchemaName, 
         @level1type = @ObjectType,  @level1name = @UnquotedObjectName;
    END;
  END;
  ELSE
  BEGIN
    EXEC sys.sp_addextendedproperty 
       @name = N'tSQLt.IsTempObject',
       @value = @TempObjectFlagOn, 
       @level0type = N'SCHEMA', @level0name = @UnquotedSchemaName, 
       @level1type = N'TABLE',  @level1name = @UnquotedParentName,
       @level2type = @ObjectType,  @level2name = @UnquotedObjectName;

    IF(@NewNameOfOriginalObject IS NOT NULL)
    BEGIN
      EXEC sys.sp_addextendedproperty 
         @name = N'tSQLt.Private_TestDouble_OrgObjectName', 
         @value = @NewNameOfOriginalObject, 
         @level0type = N'SCHEMA', @level0name = @UnquotedSchemaName, 
         @level1type = N'TABLE',  @level1name = @UnquotedParentName,
         @level2type = @ObjectType,  @level2name = @UnquotedObjectName;
    END;
  END;
END;


GO

GO
CREATE PROCEDURE tSQLt.Private_NoTransactionHandleTable
@Action NVARCHAR(MAX),
@FullTableName NVARCHAR(MAX),
@TableAction NVARCHAR(MAX)
AS
BEGIN
  DECLARE @cmd NVARCHAR(MAX);
  BEGIN TRY
    IF (OBJECT_ID(@FullTableName) IS NULL AND @TableAction <> 'Hide')
    BEGIN
      RAISERROR('Table %s does not exist.',16,10,@FullTableName);
    END;
    IF (@Action = 'Save')
    BEGIN
      IF (@TableAction = 'Restore')
      BEGIN
        IF(NOT EXISTS(SELECT 1 FROM #TableBackupLog TBL WHERE TBL.OriginalName = @FullTableName))
        BEGIN
          DECLARE @NewQuotedNameForBackupTable NVARCHAR(MAX) = '[tSQLt].'+QUOTENAME(tSQLt.Private::CreateUniqueObjectName());
          SET @cmd = 'SELECT * INTO '+@NewQuotedNameForBackupTable+' FROM '+@FullTableName+';';
          EXEC (@cmd);
          INSERT INTO #TableBackupLog (OriginalName, BackupName) VALUES (@FullTableName, @NewQuotedNameForBackupTable);
          EXEC tSQLt.Private_MarktSQLtTempObject @ObjectName = @NewQuotedNameForBackupTable, @ObjectType = N'TABLE', @NewNameOfOriginalObject = NULL; 
        END;
      END;
      ELSE IF (@TableAction = 'Hide')
      BEGIN
        IF (NOT EXISTS (SELECT 1 FROM tSQLt.Private_RenamedObjectLog ROL WHERE QUOTENAME(OBJECT_SCHEMA_NAME(ROL.ObjectId))+'.'+OriginalName = @FullTableName))
        BEGIN
          IF(OBJECT_ID(@FullTableName) IS NULL)
          BEGIN
            RAISERROR('Table %s does not exist.',16,10,@FullTableName);
          END;
          EXEC tSQLt.RemoveObject @ObjectName = @FullTableName;
        END;
      END;
      ELSE IF (@TableAction IN ('Truncate', 'Ignore'))
      BEGIN
        RETURN;
      END;
      ELSE
      BEGIN
        RAISERROR('Invalid @TableAction parameter value.',16,10);
      END;
    END;
    ELSE IF (@Action = 'Reset')
    BEGIN
      IF (@TableAction = 'Restore')
      BEGIN
        BEGIN TRAN;
          DECLARE @BackupTableName TABLE(TableName NVARCHAR(MAX)); 
          DELETE FROM #TableBackupLog OUTPUT DELETED.BackupName INTO @BackupTableName WHERE OriginalName = @FullTableName;
          IF(EXISTS(SELECT 1 FROM @BackupTableName AS BTN))
          BEGIN
            SET @cmd = 'DELETE FROM ' + @FullTableName + ';';
            IF (EXISTS(SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@FullTableName) AND is_identity = 1))
            BEGIN
              SET @cmd = @cmd + 'SET IDENTITY_INSERT ' + @FullTableName + ' ON;';
            END;
            SET @cmd = @cmd + 'INSERT INTO ' + @FullTableName +'(';
            DECLARE @ColumnList NVARCHAR(MAX) = STUFF((SELECT ','+QUOTENAME(name) FROM sys.columns WHERE object_id = OBJECT_ID(@FullTableName) AND is_computed = 0 ORDER BY column_id FOR XML PATH(''),TYPE).value('.','NVARCHAR(MAX)'),1,1,'');
            SET @cmd = @cmd + @ColumnList;
            SET @cmd = @cmd + ') SELECT ' + @ColumnList + ' FROM ' + (SELECT TableName FROM @BackupTableName)+';';
            EXEC(@cmd);
          END;
        COMMIT;
      END;
      ELSE IF (@TableAction = 'Truncate')
      BEGIN
        EXEC('DELETE FROM ' + @FullTableName +';');
      END;
      ELSE IF (@TableAction IN ('Ignore','Hide')) 
      BEGIN
        /* Hidden tables will be restored by UndoTestDoubles. */
        RETURN;
      END;
      ELSE
      BEGIN
        RAISERROR('Invalid @TableAction parameter value.', 16, 10);
      END;
    END;
    ELSE
    BEGIN
      RAISERROR('Invalid @Action parameter value.',16,10);
    END;
  END TRY
  BEGIN CATCH
    DECLARE @ErrorLine INT = ERROR_LINE();
    DECLARE @ErrorProcedure NVARCHAR(MAX) = ERROR_PROCEDURE();
    DECLARE @ErrorMessage NVARCHAR(MAX) = ERROR_MESSAGE();
    DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
    DECLARE @ErrorState INT = ERROR_STATE();
    RAISERROR('tSQLt is in an unknown state: Stopping execution. (%s | Procedure: %s | Line: %i)', @ErrorSeverity, @ErrorState, @ErrorMessage, @ErrorProcedure, @ErrorLine);
  END CATCH;
END;
GO
--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--
--DECLARE @TempMsg58 NVARCHAR(MAX) = FORMATMESSAGE('HandleTable(58) - @BackupTableName = %s, @FullTableName = %s, XACT_STATE = %i, SummaryError = %i',(SELECT TableName FROM @BackupTableName), @FullTableName, XACT_STATE(), CAST((SELECT PGC.Value FROM tSQLt.Private_GetConfiguration('SummaryError') AS PGC) AS INT));RAISERROR(@TempMsg58, 0,1) WITH NOWAIT;
--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--XX--



GO

GO
CREATE PROCEDURE tSQLt.Private_NoTransactionHandleTables
  @Action NVARCHAR(MAX)
AS
BEGIN
  DECLARE @cmd NVARCHAR(MAX) = (
    SELECT 'EXEC tSQLt.Private_NoTransactionHandleTable @Action = '''+@Action+''', @FullTableName = '''+X.Name+''', @TableAction = '''+X.Action+''';'
      FROM tSQLt.Private_NoTransactionTableAction X
     WHERE X.Action <> 'Ignore'
       FOR XML PATH(''),TYPE
  ).value('.','NVARCHAR(MAX)');
  EXEC(@cmd);
END;
GO


GO

CREATE PROCEDURE tSQLt.Private_CleanUpCmdHandler
  @CleanUpCmd NVARCHAR(MAX),
  @TestResult NVARCHAR(MAX) OUTPUT,
  @TestMsg NVARCHAR(MAX) OUTPUT,
  @ResultInCaseOfError NVARCHAR(MAX) = 'Error'
AS
BEGIN
  BEGIN TRY
    EXEC(@CleanUpCmd);
  END TRY
  BEGIN CATCH
    DECLARE @NewMsg NVARCHAR(MAX) = 'Error during clean up: (' + (SELECT FormattedError FROM tSQLt.Private_GetFormattedErrorInfo())  + ')';
    SELECT @TestMsg = Message, @TestResult = Result FROM tSQLt.Private_HandleMessageAndResult(@TestMsg /*PrevMsg*/, @TestResult /*PrevResult*/, @NewMsg /*NewMsg*/, @ResultInCaseOfError /*NewResult*/);
  END CATCH;
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_CleanUp
  @FullTestName NVARCHAR(MAX),
  @Result NVARCHAR(MAX) OUTPUT,
  @ErrorMsg NVARCHAR(MAX) OUTPUT
AS
BEGIN

  EXEC tSQLt.Private_CleanUpCmdHandler 
         @CleanUpCmd = 'EXEC tSQLt.Private_NoTransactionHandleTables @Action=''Reset'';',
         @TestResult = @Result OUT,
         @TestMsg = @ErrorMsg OUT,
         @ResultInCaseOfError = 'FATAL';

  EXEC tSQLt.Private_CleanUpCmdHandler 
         @CleanUpCmd = 'EXEC tSQLt.UndoTestDoubles @Force = 0;',
         @TestResult = @Result OUT,
         @TestMsg = @ErrorMsg OUT,
         @ResultInCaseOfError = 'Abort';

END;
GO


GO

GO
CREATE FUNCTION tSQLt.Private_AssertNoSideEffects_GenerateCommand(
  @BeforeExecutionObjectSnapshotTableName NVARCHAR(MAX),
  @AfterExecutionObjectSnapshotTableName NVARCHAR(MAX)
)
RETURNS TABLE
AS
RETURN
  SELECT '
    SELECT * INTO #ObjectDiscrepancies
      FROM(
        (SELECT ''Deleted'' [Status], B.* FROM '+@BeforeExecutionObjectSnapshotTableName+' AS B EXCEPT SELECT ''Deleted'' [Status],* FROM '+@AfterExecutionObjectSnapshotTableName+' AS A)
         UNION ALL
        (SELECT ''Added'' [Status], A.* FROM '+@AfterExecutionObjectSnapshotTableName+' AS A EXCEPT SELECT ''Added'' [Status], * FROM '+@BeforeExecutionObjectSnapshotTableName+' AS B)
      )D;
    IF(EXISTS(SELECT 1 FROM #ObjectDiscrepancies))
    BEGIN
      DECLARE @TableToText NVARCHAR(MAX);
      EXEC tSQLt.TableToText @TableName = ''#ObjectDiscrepancies'' ,@txt = @TableToText OUTPUT, @OrderBy = ''[Status] ASC, SchemaName ASC, ObjectName ASC'';
      RAISERROR(''After the test executed, there were unexpected or missing objects in the database: %s'',16,10,@TableToText);
    END;' Command;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_AssertNoSideEffects
  @BeforeExecutionObjectSnapshotTableName NVARCHAR(MAX),
  @AfterExecutionObjectSnapshotTableName NVARCHAR(MAX),
  @TestResult NVARCHAR(MAX) OUTPUT,
  @TestMsg NVARCHAR(MAX) OUTPUT
AS
BEGIN
  DECLARE @Command NVARCHAR(MAX) = (SELECT Command FROM tSQLt.Private_AssertNoSideEffects_GenerateCommand(@BeforeExecutionObjectSnapshotTableName, @AfterExecutionObjectSnapshotTableName));
  EXEC tSQLt.Private_CleanUpCmdHandler @CleanUpCmd=@Command, @TestResult=@TestResult OUT, @TestMsg=@TestMsg OUT;
END;
GO


GO


CREATE PROCEDURE tSQLt.Private_GetClassHelperProcedureName
  @TestClassId INT = NULL,
  @SetupProcName NVARCHAR(MAX) OUTPUT,
  @CleanUpProcName NVARCHAR(MAX) OUTPUT
AS
BEGIN
    SELECT @SetupProcName = tSQLt.Private_GetQuotedFullName(object_id)
      FROM sys.procedures
     WHERE schema_id = @TestClassId
       AND LOWER(name) = 'setup';
    SELECT @CleanUpProcName = tSQLt.Private_GetQuotedFullName(object_id)
      FROM sys.procedures
     WHERE schema_id = @TestClassId
       AND LOWER(name) = 'cleanup';
END;
GO

CREATE PROCEDURE tSQLt.Private_RunTest_TestExecution
  @TestName NVARCHAR(MAX),
  @SetUp NVARCHAR(MAX),
  @CleanUp NVARCHAR(MAX),
  @NoTransactionFlag BIT,
  @TranName CHAR(32),
  @Result NVARCHAR(MAX) OUTPUT,
  @Msg NVARCHAR(MAX) OUTPUT,
  @TestEndTime DATETIME2 OUTPUT
AS
BEGIN
  DECLARE @TransactionStartedFlag BIT = 0;
  DECLARE @PreExecTrancount INT = NULL;
  DECLARE @TestExecutionCmd NVARCHAR(MAX) = 'EXEC ' + @TestName;
  DECLARE @CleanUpProcedureExecutionCmd NVARCHAR(MAX) = NULL;

    BEGIN TRY

      IF(@NoTransactionFlag = 0)
      BEGIN
        BEGIN TRAN;
        SET @TransactionStartedFlag = 1;
        SAVE TRAN @TranName;
      END;
      ELSE
      BEGIN
        SELECT object_id ObjectId, SCHEMA_NAME(schema_id) SchemaName, name ObjectName, type_desc ObjectType INTO #BeforeExecutionObjectSnapshot FROM sys.objects;
        EXEC tSQLt.Private_NoTransactionHandleTables @Action = 'Save';
      END;

      SET @PreExecTrancount = @@TRANCOUNT;
    
      DECLARE @TmpMsg NVARCHAR(MAX);
      SET @TestEndTime = NULL;
      BEGIN TRY
        IF (@SetUp IS NOT NULL)
        BEGIN
          EXEC @SetUp;
        END;

        EXEC (@TestExecutionCmd);

        IF(EXISTS(SELECT 1 FROM #ExpectException WHERE ExpectException = 1))
        BEGIN
          SET @TmpMsg = COALESCE((SELECT FailMessage FROM #ExpectException)+' ','')+'Expected an error to be raised.';
          EXEC tSQLt.Fail @TmpMsg;
        END
        SET @TestEndTime = SYSDATETIME();
      END TRY
      BEGIN CATCH
          SET @TestEndTime = ISNULL(@TestEndTime,SYSDATETIME());
          IF ERROR_MESSAGE() LIKE '%tSQLt.Failure%'
          BEGIN
              SELECT @Msg = Msg FROM #TestMessage;
              SET @Result = 'Failure';
          END
          ELSE
          BEGIN
            DECLARE @ErrorInfo NVARCHAR(MAX);
            SELECT @ErrorInfo = FormattedError FROM tSQLt.Private_GetFormattedErrorInfo();

            IF(EXISTS(SELECT 1 FROM #ExpectException))
            BEGIN
              DECLARE @ExpectException INT;
              DECLARE @ExpectedMessage NVARCHAR(MAX);
              DECLARE @ExpectedMessagePattern NVARCHAR(MAX);
              DECLARE @ExpectedSeverity INT;
              DECLARE @ExpectedState INT;
              DECLARE @ExpectedErrorNumber INT;
              DECLARE @FailMessage NVARCHAR(MAX);
              SELECT @ExpectException = ExpectException,
                     @ExpectedMessage = ExpectedMessage, 
                     @ExpectedSeverity = ExpectedSeverity,
                     @ExpectedState = ExpectedState,
                     @ExpectedMessagePattern = ExpectedMessagePattern,
                     @ExpectedErrorNumber = ExpectedErrorNumber,
                     @FailMessage = FailMessage
                FROM #ExpectException;

              IF(@ExpectException = 1)
              BEGIN
                SET @Result = 'Success';
                SET @TmpMsg = COALESCE(@FailMessage+' ','')+'Exception did not match expectation!';
                IF(ERROR_MESSAGE() <> @ExpectedMessage)
                BEGIN
                  SET @TmpMsg = @TmpMsg +CHAR(13)+CHAR(10)+
                             'Expected Message: <'+@ExpectedMessage+'>'+CHAR(13)+CHAR(10)+
                             'Actual Message  : <'+ERROR_MESSAGE()+'>';
                  SET @Result = 'Failure';
                END
                IF(ERROR_MESSAGE() NOT LIKE @ExpectedMessagePattern)
                BEGIN
                  SET @TmpMsg = @TmpMsg +CHAR(13)+CHAR(10)+
                             'Expected Message to be like <'+@ExpectedMessagePattern+'>'+CHAR(13)+CHAR(10)+
                             'Actual Message            : <'+ERROR_MESSAGE()+'>';
                  SET @Result = 'Failure';
                END
                IF(ERROR_NUMBER() <> @ExpectedErrorNumber)
                BEGIN
                  SET @TmpMsg = @TmpMsg +CHAR(13)+CHAR(10)+
                             'Expected Error Number: '+CAST(@ExpectedErrorNumber AS NVARCHAR(MAX))+CHAR(13)+CHAR(10)+
                             'Actual Error Number  : '+CAST(ERROR_NUMBER() AS NVARCHAR(MAX));
                  SET @Result = 'Failure';
                END
                IF(ERROR_SEVERITY() <> @ExpectedSeverity)
                BEGIN
                  SET @TmpMsg = @TmpMsg +CHAR(13)+CHAR(10)+
                             'Expected Severity: '+CAST(@ExpectedSeverity AS NVARCHAR(MAX))+CHAR(13)+CHAR(10)+
                             'Actual Severity  : '+CAST(ERROR_SEVERITY() AS NVARCHAR(MAX));
                  SET @Result = 'Failure';
                END
                IF(ERROR_STATE() <> @ExpectedState)
                BEGIN
                  SET @TmpMsg = @TmpMsg +CHAR(13)+CHAR(10)+
                             'Expected State: '+CAST(@ExpectedState AS NVARCHAR(MAX))+CHAR(13)+CHAR(10)+
                             'Actual State  : '+CAST(ERROR_STATE() AS NVARCHAR(MAX));
                  SET @Result = 'Failure';
                END
                IF(@Result = 'Failure')
                BEGIN
                  SET @Msg = @TmpMsg;
                END
              END 
              ELSE
              BEGIN
                  SET @Result = 'Failure';
                  SET @Msg = 
                    COALESCE(@FailMessage+' ','')+
                    'Expected no error to be raised. Instead this error was encountered:'+
                    CHAR(13)+CHAR(10)+
                    @ErrorInfo;
              END
            END;
            ELSE
            BEGIN
              SET @Result = 'Error';
              SET @Msg = @ErrorInfo;
            END; 
          END;
      END CATCH;
    END TRY
    BEGIN CATCH
        SET @Result = 'Error';
        SET @Msg = ERROR_MESSAGE();
    END CATCH

    --TODO:NoTran
    ---- Compare @@Trancount, throw up arms if it doesn't match
    --TODO:NoTran
    BEGIN TRY
      IF(@TransactionStartedFlag = 1)
      BEGIN
        ROLLBACK TRAN @TranName;
      END;
    END TRY
    BEGIN CATCH
        DECLARE @PostExecTrancount INT;
        SET @PostExecTrancount = @PreExecTrancount - @@TRANCOUNT;
        IF (@@TRANCOUNT > 0) ROLLBACK;
        BEGIN TRAN;
        IF(   @Result <> 'Success'
           OR @PostExecTrancount <> 0
          )
        BEGIN
          SELECT @Msg = COALESCE(@Msg, '<NULL>') + ' (There was also a ROLLBACK ERROR --> ' + FormattedError + ')' FROM tSQLt.Private_GetFormattedErrorInfo();
          SET @Result = 'Error';
        END;
    END CATCH;  
    IF (@NoTransactionFlag = 1)
    BEGIN
      SET @CleanUpProcedureExecutionCmd = (
        (
          SELECT 'EXEC tSQLt.Private_CleanUpCmdHandler ''EXEC '+ REPLACE(NT.CleanUpProcedureName,'''','''''') +';'', @Result OUT, @Msg OUT;'
            FROM #NoTransaction NT
           ORDER BY OrderId
             FOR XML PATH(''),TYPE
        ).value('.','NVARCHAR(MAX)')
      );
      IF(@CleanUpProcedureExecutionCmd IS NOT NULL)
      BEGIN
        EXEC sys.sp_executesql @CleanUpProcedureExecutionCmd, N'@Result NVARCHAR(MAX) OUTPUT, @Msg NVARCHAR(MAX) OUTPUT', @Result OUT, @Msg OUT;
      END;

      IF(@CleanUp IS NOT NULL)
      BEGIN
        EXEC tSQLt.Private_CleanUpCmdHandler @CleanUp, @Result OUT, @Msg OUT;
      END;

      DECLARE @CleanUpErrorMsg NVARCHAR(MAX);
      EXEC tSQLt.Private_CleanUp @FullTestName = @TestName, @Result = @Result OUT, @ErrorMsg = @CleanUpErrorMsg OUT;
      SET @Msg = @Msg + ISNULL(' ' + @CleanUpErrorMsg, '');

      SELECT object_id ObjectId, SCHEMA_NAME(schema_id) SchemaName, name ObjectName, type_desc ObjectType INTO #AfterExecutionObjectSnapshot FROM sys.objects;
      EXEC tSQLt.Private_AssertNoSideEffects
             @BeforeExecutionObjectSnapshotTableName ='#BeforeExecutionObjectSnapshot',
             @AfterExecutionObjectSnapshotTableName = '#AfterExecutionObjectSnapshot',
             @TestResult = @Result OUT,
             @TestMsg = @Msg OUT
    END;
    IF(@TransactionStartedFlag = 1)
    BEGIN
      COMMIT;
    END;
END;
GO

CREATE PROCEDURE tSQLt.Private_RunTest
   @TestName NVARCHAR(MAX),
   @SetUp NVARCHAR(MAX) = NULL,
   @CleanUp NVARCHAR(MAX) = NULL
AS
BEGIN
    DECLARE @OuterPerimeterTrancount INT = @@TRANCOUNT;

    DECLARE @Msg NVARCHAR(MAX); SET @Msg = '';
    DECLARE @Msg2 NVARCHAR(MAX); SET @Msg2 = '';
    DECLARE @TestClassName NVARCHAR(MAX); SET @TestClassName = '';
    DECLARE @TestProcName NVARCHAR(MAX); SET @TestProcName = '';
    DECLARE @Result NVARCHAR(MAX);
    DECLARE @TranName CHAR(32) = NULL;
    DECLARE @TestResultId INT;
    DECLARE @TestObjectId INT;
    DECLARE @TestEndTime DATETIME2 = NULL;

    DECLARE @VerboseMsg NVARCHAR(MAX);
    DECLARE @Verbose BIT;
    SET @Verbose = ISNULL((SELECT CAST(Value AS BIT) FROM tSQLt.Private_GetConfiguration('Verbose')),0);
    
    TRUNCATE TABLE tSQLt.CaptureOutputLog;
    CREATE TABLE #TestMessage(Msg NVARCHAR(MAX));
    CREATE TABLE #ExpectException(ExpectException INT,ExpectedMessage NVARCHAR(MAX), ExpectedSeverity INT, ExpectedState INT, ExpectedMessagePattern NVARCHAR(MAX), ExpectedErrorNumber INT, FailMessage NVARCHAR(MAX));
    CREATE TABLE #SkipTest(SkipTestMessage NVARCHAR(MAX) DEFAULT '');
    CREATE TABLE #NoTransaction(OrderId INT IDENTITY(1,1),CleanUpProcedureName NVARCHAR(MAX));
    CREATE TABLE #TableBackupLog(OriginalName NVARCHAR(MAX), BackupName NVARCHAR(MAX));


    IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE name = N'SetFakeViewOnTrigger')
    BEGIN
      RAISERROR('Test system is in an invalid state. SetFakeViewOff must be called if SetFakeViewOn was called. Call SetFakeViewOff after creating all test case procedures.', 16, 10) WITH NOWAIT;
      RETURN -1;
    END;

    
    SELECT @TestClassName = OBJECT_SCHEMA_NAME(OBJECT_ID(@TestName)),
           @TestProcName = tSQLt.Private_GetCleanObjectName(@TestName),
           @TestObjectId = OBJECT_ID(@TestName);
           
    INSERT INTO tSQLt.TestResult(Class, TestCase, TranName, Result) 
        SELECT @TestClassName, @TestProcName, @TranName, 'A severe error happened during test execution. Test did not finish.'
        OPTION(MAXDOP 1);
    SELECT @TestResultId = SCOPE_IDENTITY();

    IF(@Verbose = 1)
    BEGIN
      SET @VerboseMsg = 'tSQLt.Run '''+@TestName+'''; --Starting';
      EXEC tSQLt.Private_Print @Message =@VerboseMsg, @Severity = 0;
    END;


    SET @Result = 'Success';
    DECLARE @SkipTestFlag BIT = 0;
    DECLARE @NoTransactionFlag BIT = 0;

    BEGIN TRY
      EXEC tSQLt.Private_ProcessTestAnnotations @TestObjectId=@TestObjectId;
      SET @SkipTestFlag = CASE WHEN EXISTS(SELECT 1 FROM #SkipTest) THEN 1 ELSE 0 END;
      SET @NoTransactionFlag = CASE WHEN EXISTS(SELECT 1 FROM #NoTransaction) THEN 1 ELSE 0 END;

      IF(@SkipTestFlag = 0)
      BEGIN
        IF(@NoTransactionFlag = 0)
        BEGIN
          EXEC tSQLt.GetNewTranName @TranName OUT;
          UPDATE tSQLt.TestResult SET TranName = @TranName WHERE Id = @TestResultId;
        END;
        EXEC tSQLt.Private_RunTest_TestExecution
          @TestName,
          @SetUp,
          @CleanUp,
          @NoTransactionFlag,
          @TranName,
          @Result OUT,
          @Msg OUT,
          @TestEndTime OUT;

      END;
      ELSE
      BEGIN
        DECLARE @TmpMsg NVARCHAR(MAX);
        SELECT 
            @Result = 'Skipped',
            @Msg = ST.SkipTestMessage 
          FROM #SkipTest AS ST;
        SET @TmpMsg = '-->'+@TestName+' skipped: '+@Msg;
        EXEC tSQLt.Private_Print @Message = @TmpMsg;
        SET @TestEndTime = SYSDATETIME();
      END;
    END TRY
    BEGIN CATCH
      SET @Result = 'Error';
      SET @Msg = ISNULL(NULLIF(@Msg,'') + ' ','')+ERROR_MESSAGE();
      --SET @TestEndTime = SYSDATETIME();
    END CATCH;
----------------------------------------------------------------------------------------------
    If(@Result NOT IN ('Success','Skipped'))
    BEGIN
      SET @Msg2 = @TestName + ' failed: (' + @Result + ') ' + @Msg;
      EXEC tSQLt.Private_Print @Message = @Msg2, @Severity = 0;
    END;
    IF EXISTS(SELECT 1 FROM tSQLt.TestResult WHERE Id = @TestResultId)
    BEGIN
        UPDATE tSQLt.TestResult SET
            Result = @Result,
            Msg = @Msg,
            TestEndTime = @TestEndTime
         WHERE Id = @TestResultId;
    END;
    ELSE
    BEGIN
        INSERT tSQLt.TestResult(Class, TestCase, TranName, Result, Msg)
        SELECT @TestClassName, 
               @TestProcName,  
               '?', 
               'Error', 
               'TestResult entry is missing; Original outcome: ' + @Result + ', ' + @Msg;
    END;    

    IF(@Verbose = 1)
    BEGIN
      SET @VerboseMsg = 'tSQLt.Run '''+@TestName+'''; --Finished';
      EXEC tSQLt.Private_Print @Message =@VerboseMsg, @Severity = 0;
      --DECLARE @AsciiArtLine NVARCHAR(MAX) = CASE WHEN @Result<>'Success' THEN REPLICATE(CHAR(168),150)+' '+CHAR(155)+CHAR(155)+' '+@Result + ' ' +CHAR(139)+CHAR(139) ELSE '' END + CHAR(13)+CHAR(10) + CHAR(173);
      --EXEC tSQLt.Private_Print @Message = @AsciiArtLine, @Severity = 0;
    END;

    IF(@Result = 'FATAL')
    BEGIN
      INSERT INTO tSQLt.Private_Seize VALUES(1);   
      RAISERROR('The last test has invalidated the current installation of tSQLt. Please reinstall tSQLt.',16,10);
    END;
    IF(@Result = 'Abort')
    BEGIN
      RAISERROR('Aborting the current execution of tSQLt due to a severe error.', 16, 10);
    END;

    IF(@OuterPerimeterTrancount != @@TRANCOUNT) RAISERROR('tSQLt is in an invalid state: Stopping Execution. (Mismatching TRANCOUNT: %i <> %i))',16,10,@OuterPerimeterTrancount, @@TRANCOUNT);

END;
GO

CREATE PROCEDURE tSQLt.Private_RunTestClass
  @TestClassName NVARCHAR(MAX)
AS
BEGIN
    DECLARE @TestCaseName NVARCHAR(MAX);
    DECLARE @TestClassId INT; SET @TestClassId = tSQLt.Private_GetSchemaId(@TestClassName);
    DECLARE @SetupProcName NVARCHAR(MAX);
    DECLARE @CleanUpProcName NVARCHAR(MAX);
    EXEC tSQLt.Private_GetClassHelperProcedureName @TestClassId, @SetupProcName OUT, @CleanUpProcName OUT;
    
    DECLARE @cmd NVARCHAR(MAX) = (
      (
        SELECT 'EXEC tSQLt.Private_RunTest '''+REPLACE(tSQLt.Private_GetQuotedFullName(object_id),'''','''''')+''', '+ISNULL(''''+REPLACE(@SetupProcName,'''','''''')+'''','NULL')+', '+ISNULL(''''+REPLACE(@CleanUpProcName,'''','''''')+'''','NULL')+';'
          FROM sys.procedures
         WHERE schema_id = @TestClassId
           AND LOWER(name) LIKE 'test%'
         ORDER BY NEWID()
           FOR XML PATH(''),TYPE
      ).value('.','NVARCHAR(MAX)')
    );
    EXEC(@cmd);
END;
GO

CREATE PROCEDURE tSQLt.Private_Run
   @TestName NVARCHAR(MAX),
   @TestResultFormatter NVARCHAR(MAX)
AS
BEGIN
SET NOCOUNT ON;
    DECLARE @FullName NVARCHAR(MAX);
    DECLARE @TestClassId INT;
    DECLARE @IsTestClass BIT;
    DECLARE @IsTestCase BIT;
    DECLARE @IsSchema BIT;
    DECLARE @SetUp NVARCHAR(MAX);SET @SetUp = NULL;
    
    SELECT @TestName = TestName FROM tSQLt.Private_GetLastTestNameIfNotProvided(@TestName);
    EXEC tSQLt.Private_SaveTestNameForSession @TestName;
    
    SELECT @TestClassId = schemaId,
           @FullName = quotedFullName,
           @IsTestClass = isTestClass,
           @IsSchema = isSchema,
           @IsTestCase = isTestCase
      FROM tSQLt.Private_ResolveName(@TestName);

    IF @IsSchema = 1
    BEGIN
        EXEC tSQLt.Private_RunTestClass @FullName;
    END
    
    IF @IsTestCase = 1
    BEGIN
      DECLARE @SetupProcName NVARCHAR(MAX);
      DECLARE @CleanUpProcName NVARCHAR(MAX);
      EXEC tSQLt.Private_GetClassHelperProcedureName @TestClassId, @SetupProcName OUT, @CleanUpProcName OUT;

      EXEC tSQLt.Private_RunTest @FullName, @SetupProcName, @CleanUpProcName;
    END;

    EXEC tSQLt.Private_OutputTestResults @TestResultFormatter;
END;
GO


CREATE PROCEDURE tSQLt.Private_RunCursor
  @TestResultFormatter NVARCHAR(MAX),
  @GetCursorCallback NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @TestClassName NVARCHAR(MAX);
  DECLARE @TestProcName NVARCHAR(MAX);

  CREATE TABLE #TestClassesForRunCursor(Name NVARCHAR(MAX));
  EXEC @GetCursorCallback;
----  
  DECLARE @cmd NVARCHAR(MAX) = (
    (
      SELECT 'EXEC tSQLt.Private_RunTestClass '''+REPLACE(Name, '''' ,'''''')+''';'
        FROM #TestClassesForRunCursor
         FOR XML PATH(''),TYPE
    ).value('.','NVARCHAR(MAX)')
  );
  EXEC(@cmd);
  
  EXEC tSQLt.Private_OutputTestResults @TestResultFormatter;
END;
GO

CREATE PROCEDURE tSQLt.Private_GetCursorForRunAll
AS
BEGIN
  INSERT INTO #TestClassesForRunCursor
   SELECT Name
     FROM tSQLt.TestClasses;
END;
GO

CREATE PROCEDURE tSQLt.Private_RunAll
  @TestResultFormatter NVARCHAR(MAX)
AS
BEGIN
  EXEC tSQLt.Private_RunCursor @TestResultFormatter = @TestResultFormatter, @GetCursorCallback = 'tSQLt.Private_GetCursorForRunAll';
END;
GO

CREATE PROCEDURE tSQLt.Private_GetCursorForRunNew
AS
BEGIN
  INSERT INTO #TestClassesForRunCursor
   SELECT TC.Name
     FROM tSQLt.TestClasses AS TC
     JOIN tSQLt.Private_NewTestClassList AS PNTCL
       ON PNTCL.ClassName = TC.Name;
END;
GO

CREATE PROCEDURE tSQLt.Private_RunNew
  @TestResultFormatter NVARCHAR(MAX)
AS
BEGIN
  EXEC tSQLt.Private_RunCursor @TestResultFormatter = @TestResultFormatter, @GetCursorCallback = 'tSQLt.Private_GetCursorForRunNew';
END;
GO

CREATE PROCEDURE tSQLt.Private_RunMethodHandler
  @RunMethod NVARCHAR(MAX),
  @TestResultFormatter NVARCHAR(MAX) = NULL,
  @TestName NVARCHAR(MAX) = NULL
AS
BEGIN
  SELECT @TestResultFormatter = ISNULL(@TestResultFormatter,tSQLt.GetTestResultFormatter());

  EXEC tSQLt.Private_Init;
  IF(@@ERROR = 0)
  BEGIN  
    IF(EXISTS(SELECT * FROM sys.parameters AS P WHERE P.object_id = OBJECT_ID(@RunMethod) AND name = '@TestName'))
    BEGIN
      EXEC @RunMethod @TestName = @TestName, @TestResultFormatter = @TestResultFormatter;
    END;
    ELSE
    BEGIN  
      EXEC @RunMethod @TestResultFormatter = @TestResultFormatter;
    END;
  END;
END;
GO

--------------------------------------------------------------------------------

GO
CREATE PROCEDURE tSQLt.RunAll
AS
BEGIN
  EXEC tSQLt.Private_RunMethodHandler @RunMethod = 'tSQLt.Private_RunAll';
END;
GO

CREATE PROCEDURE tSQLt.RunNew
AS
BEGIN
  EXEC tSQLt.Private_RunMethodHandler @RunMethod = 'tSQLt.Private_RunNew';
END;
GO

CREATE PROCEDURE tSQLt.RunTest
   @TestName NVARCHAR(MAX)
AS
BEGIN
  RAISERROR('tSQLt.RunTest has been retired. Please use tSQLt.Run instead.', 16, 10);
END;
GO

CREATE PROCEDURE tSQLt.Run
   @TestName NVARCHAR(MAX) = NULL,
   @TestResultFormatter NVARCHAR(MAX) = NULL
AS
BEGIN
  EXEC tSQLt.Private_RunMethodHandler @RunMethod = 'tSQLt.Private_Run', @TestResultFormatter = @TestResultFormatter, @TestName = @TestName; 
END;
GO
CREATE PROCEDURE tSQLt.Private_InputBuffer
  @InputBuffer NVARCHAR(MAX) OUTPUT
AS
BEGIN
  CREATE TABLE #inputbuffer(EventType sysname, Parameters SMALLINT, EventInfo NVARCHAR(MAX));
  INSERT INTO #inputbuffer
  EXEC('DBCC INPUTBUFFER(@@SPID) WITH NO_INFOMSGS;');
  SELECT @InputBuffer = I.EventInfo FROM #inputbuffer AS I;
END;
GO
CREATE PROCEDURE tSQLt.RunC
AS
BEGIN
  DECLARE @TestName NVARCHAR(MAX);SET @TestName = NULL;
  DECLARE @InputBuffer NVARCHAR(MAX);
  EXEC tSQLt.Private_InputBuffer @InputBuffer = @InputBuffer OUT;
  IF(@InputBuffer LIKE 'EXEC tSQLt.RunC;--%')
  BEGIN
    SET @TestName = LTRIM(RTRIM(STUFF(@InputBuffer,1,18,'')));
  END;
  EXEC tSQLt.Run @TestName = @TestName;
END;
GO

CREATE PROCEDURE tSQLt.RunWithXmlResults
   @TestName NVARCHAR(MAX) = NULL
AS
BEGIN
  EXEC tSQLt.Run @TestName = @TestName, @TestResultFormatter = 'tSQLt.XmlResultFormatter';
END;
GO

CREATE PROCEDURE tSQLt.RunWithNullResults
    @TestName NVARCHAR(MAX) = NULL
AS
BEGIN
  EXEC tSQLt.Run @TestName = @TestName, @TestResultFormatter = 'tSQLt.NullTestResultFormatter';
END;
GO
CREATE FUNCTION tSQLt.Private_PrepareTestResultForOutput()
RETURNS TABLE
AS
RETURN
  SELECT ROW_NUMBER() OVER(ORDER BY Result DESC, Name ASC) No,Name [Test Case Name],
         RIGHT(SPACE(7)+CAST(DATEDIFF(MILLISECOND,TestStartTime,TestEndTime) AS VARCHAR(7)),7) AS [Dur(ms)], Result
    FROM tSQLt.TestResult;
GO
CREATE PROCEDURE tSQLt.DefaultResultFormatter
AS
BEGIN
    DECLARE @TestList NVARCHAR(MAX);
    DECLARE @Dashes NVARCHAR(MAX);
    DECLARE @CountSummaryMsg NVARCHAR(MAX);
    DECLARE @NewLine NVARCHAR(MAX);
    DECLARE @IsSuccess INT;
    DECLARE @SuccessCnt INT;
    DECLARE @Severity INT;
    DECLARE @SummaryError INT;
    
    SELECT *
      INTO #TestResultOutput
      FROM tSQLt.Private_PrepareTestResultForOutput() AS PTRFO;
    
    EXEC tSQLt.TableToText @TestList OUTPUT, '#TestResultOutput', 'No';

    SELECT @CountSummaryMsg = Msg, 
           @IsSuccess = 1 - SIGN(FailCnt + ErrorCnt),
           @SuccessCnt = SuccessCnt
      FROM tSQLt.TestCaseSummary();
      
    SELECT @SummaryError = CAST(PC.Value AS INT)
      FROM tSQLt.Private_Configurations AS PC
     WHERE PC.Name = 'SummaryError';

    SELECT @Severity = 16*(1-@IsSuccess);
    IF(@SummaryError = 0)
    BEGIN
      SET @Severity = 0;
    END;
    
    SELECT @Dashes = REPLICATE('-',LEN(@CountSummaryMsg)),
           @NewLine = CHAR(13)+CHAR(10);
    
    
    EXEC tSQLt.Private_Print @NewLine,0;
    EXEC tSQLt.Private_Print '+----------------------+',0;
    EXEC tSQLt.Private_Print '|Test Execution Summary|',0;
    EXEC tSQLt.Private_Print '+----------------------+',0;
    EXEC tSQLt.Private_Print @NewLine,0;
    EXEC tSQLt.Private_Print @TestList,0;
    EXEC tSQLt.Private_Print @Dashes,0;
    EXEC tSQLt.Private_Print @CountSummaryMsg, @Severity;
    EXEC tSQLt.Private_Print @Dashes,0;
END;
GO

CREATE PROCEDURE tSQLt.XmlResultFormatter
AS
BEGIN
    DECLARE @XmlOutput XML;

    SELECT @XmlOutput = (
      SELECT *--Tag, Parent, [testsuites!1!hide!hide], [testsuite!2!name], [testsuite!2!tests], [testsuite!2!errors], [testsuite!2!failures], [testsuite!2!timestamp], [testsuite!2!time], [testcase!3!classname], [testcase!3!name], [testcase!3!time], [failure!4!message]  
        FROM (
          SELECT 1 AS Tag,
                 NULL AS Parent,
                 'root' AS [testsuites!1!hide!hide],
                 NULL AS [testsuite!2!id],
                 NULL AS [testsuite!2!name],
                 NULL AS [testsuite!2!tests],
                 NULL AS [testsuite!2!errors],
                 NULL AS [testsuite!2!failures],
                 NULL AS [testsuite!2!skipped],
                 NULL AS [testsuite!2!timestamp],
                 NULL AS [testsuite!2!time],
                 NULL AS [testsuite!2!hostname],
                 NULL AS [testsuite!2!package],
                 NULL AS [properties!3!hide!hide],
                 NULL AS [testcase!4!classname],
                 NULL AS [testcase!4!name],
                 NULL AS [testcase!4!time],
                 NULL AS [failure!5!message],
                 NULL AS [failure!5!type],
                 NULL AS [error!6!message],
                 NULL AS [error!6!type],
                 NULL AS [skipped!7!message],
                 NULL AS [skipped!7!type],
                 NULL AS [system-out!8!hide],
                 NULL AS [system-err!9!hide]
          UNION ALL
          SELECT 2 AS Tag, 
                 1 AS Parent,
                 'root',
                 ROW_NUMBER()OVER(ORDER BY Class),
                 Class,
                 COUNT(1),
                 SUM(CASE Result WHEN 'Error' THEN 1 ELSE 0 END),
                 SUM(CASE Result WHEN 'Failure' THEN 1 ELSE 0 END),
                 SUM(CASE Result WHEN 'Skipped' THEN 1 ELSE 0 END),
                 CONVERT(VARCHAR(19),MIN(TestResult.TestStartTime),126),
                 CAST(CAST(DATEDIFF(MILLISECOND,MIN(TestResult.TestStartTime),MAX(TestResult.TestEndTime))/1000.0 AS NUMERIC(20,3))AS VARCHAR(MAX)),
                 CAST(SERVERPROPERTY('ServerName') AS NVARCHAR(MAX)),
                 'tSQLt',
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL
            FROM tSQLt.TestResult
          GROUP BY Class
          UNION ALL
          SELECT 3 AS Tag,
                 2 AS Parent,
                 'root',
                 NULL,
                 Class,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 Class,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL
            FROM tSQLt.TestResult
           GROUP BY Class
          UNION ALL
          SELECT 4 AS Tag,
                 2 AS Parent,
                 'root',
                 NULL,
                 Class,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 Class,
                 TestCase,
                 CAST(CAST(DATEDIFF(MILLISECOND,TestResult.TestStartTime,TestResult.TestEndTime)/1000.0 AS NUMERIC(20,3))AS VARCHAR(MAX)),
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL
            FROM tSQLt.TestResult
          UNION ALL
          SELECT 5 AS Tag,
                 4 AS Parent,
                 'root',
                 NULL,
                 Class,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 Class,
                 TestCase,
                 CAST(CAST(DATEDIFF(MILLISECOND,TestResult.TestStartTime,TestResult.TestEndTime)/1000.0 AS NUMERIC(20,3))AS VARCHAR(MAX)),
                 Msg,
                 'tSQLt.Fail',
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL
            FROM tSQLt.TestResult
           WHERE Result IN ('Failure')
          UNION ALL
          SELECT 6 AS Tag,
                 4 AS Parent,
                 'root',
                 NULL,
                 Class,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 Class,
                 TestCase,
                 CAST(CAST(DATEDIFF(MILLISECOND,TestResult.TestStartTime,TestResult.TestEndTime)/1000.0 AS NUMERIC(20,3))AS VARCHAR(MAX)),
                 NULL,
                 NULL,
                 Msg,
                 'SQL Error',
                 NULL,
                 NULL,
                 NULL,
                 NULL
            FROM tSQLt.TestResult
           WHERE Result IN ( 'Error')
          UNION ALL
          SELECT 7 AS Tag,
                 4 AS Parent,
                 'root',
                 NULL,
                 Class,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 Class,
                 TestCase,
                 CAST(CAST(DATEDIFF(MILLISECOND,TestResult.TestStartTime,TestResult.TestEndTime)/1000.0 AS NUMERIC(20,3))AS VARCHAR(MAX)),
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 Msg,
                 NULL,
                 NULL,
                 NULL
            FROM tSQLt.TestResult
           WHERE Result IN ( 'Skipped')
          UNION ALL
          SELECT 8 AS Tag,
                 2 AS Parent,
                 'root',
                 NULL,
                 Class,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 Class,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL
            FROM tSQLt.TestResult
           GROUP BY Class
          UNION ALL
          SELECT 9 AS Tag,
                 2 AS Parent,
                 'root',
                 NULL,
                 Class,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 Class,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL,
                 NULL
            FROM tSQLt.TestResult
           GROUP BY Class
        ) AS X
       ORDER BY [testsuite!2!name],CASE WHEN Tag IN (8,9) THEN 1 ELSE 0 END, [testcase!4!name], Tag
       FOR XML EXPLICIT
       );

    EXEC tSQLt.Private_PrintXML @XmlOutput;
END;
GO

CREATE PROCEDURE tSQLt.NullTestResultFormatter
AS
BEGIN
  RETURN 0;
END;
GO

CREATE PROCEDURE tSQLt.RunTestClass
   @TestClassName NVARCHAR(MAX)
AS
BEGIN
    EXEC tSQLt.Run @TestClassName;
END
GO    
--Build-



      --SELECT 3 X, @SkipTestFlag SkipTestFlag, 
      --       @NoTransactionFlag NoTransactionFlag,
      --       @TransactionStartedFlag TransactionStartedFlag,
      --       @PreExecTrancount PreExecTrancount,
      --       @@TRANCOUNT Trancount,
      --       @TestName TestName,
      --       @Result Result,
      --       @Msg Msg;


GO

GO
CREATE VIEW tSQLt.Private_SysTypes AS SELECT * FROM sys.types AS T;
GO
IF((SELECT SqlVersion FROM tSQLt.Info())=9)
BEGIN
  EXEC('ALTER VIEW tSQLt.Private_SysTypes AS SELECT *,0 is_table_type FROM sys.types AS T;');
END;
GO


GO

GO
CREATE FUNCTION tSQLt.Private_GetFullTypeName(@TypeId INT, @Length INT, @Precision INT, @Scale INT, @CollationName NVARCHAR(MAX))
RETURNS TABLE
AS
RETURN SELECT X.SchemaName + '.' + X.Name + X.Suffix + X.Collation AS TypeName, X.SchemaName, X.Name, X.Suffix, X.is_table_type AS IsTableType
FROM(
  SELECT QUOTENAME(SCHEMA_NAME(T.schema_id)) SchemaName, QUOTENAME(T.name) Name,
              CASE WHEN T.max_length = -1
                    THEN ''
                   WHEN @Length = -1
                    THEN '(MAX)'
                   WHEN T.name LIKE 'n%char'
                    THEN '(' + CAST(@Length / 2 AS NVARCHAR) + ')'
                   WHEN T.name LIKE '%char' OR T.name LIKE '%binary'
                    THEN '(' + CAST(@Length AS NVARCHAR) + ')'
                   WHEN T.name IN ('decimal', 'numeric')
                    THEN '(' + CAST(@Precision AS NVARCHAR) + ',' + CAST(@Scale AS NVARCHAR) + ')'
                   WHEN T.name IN ('datetime2', 'datetimeoffset', 'time')
                    THEN '(' + CAST(@Scale AS NVARCHAR) + ')'     
                   ELSE ''
               END Suffix,
              CASE WHEN @CollationName IS NULL OR T.is_user_defined = 1 THEN ''
                   ELSE ' COLLATE ' + @CollationName
               END Collation,
               T.is_table_type
          FROM tSQLt.Private_SysTypes AS T WHERE T.user_type_id = @TypeId
          )X;


GO

IF((SELECT SqlVersion FROM tSQLt.Info())>9)
BEGIN
  EXEC('CREATE VIEW tSQLt.Private_SysIndexes AS SELECT * FROM sys.indexes;');
END
ELSE
BEGIN
  EXEC('CREATE VIEW tSQLt.Private_SysIndexes AS SELECT *,0 AS has_filter,'''' AS filter_definition FROM sys.indexes;');
END;


GO

GO
CREATE FUNCTION tSQLt.Private_ScriptIndex
(
  @object_id INT,
  @index_id INT
)
RETURNS TABLE
AS
RETURN
  SELECT I.index_id,
         I.name AS index_name,
         I.is_primary_key,
         I.is_unique,
         I.is_disabled,
         'CREATE ' +
         CASE WHEN I.is_unique = 1 THEN 'UNIQUE ' ELSE '' END +
         CASE I.type
           WHEN 1 THEN 'CLUSTERED'
           WHEN 2 THEN 'NONCLUSTERED'
           WHEN 5 THEN 'CLUSTERED COLUMNSTORE'
           WHEN 6 THEN 'NONCLUSTERED COLUMNSTORE'
           ELSE '{Index Type Not Supported!}' 
         END +
         ' INDEX ' +
         QUOTENAME(I.name)+
         ' ON ' + QUOTENAME(OBJECT_SCHEMA_NAME(@object_id)) + '.' + QUOTENAME(OBJECT_NAME(@object_id)) +
         CASE WHEN I.type NOT IN (5)
           THEN
             '('+ 
             CL.column_list +
             ')'
           ELSE ''
         END +
         CASE WHEN I.has_filter = 1
           THEN 'WHERE' + I.filter_definition
           ELSE ''
         END +
         CASE WHEN I.is_hypothetical = 1
           THEN 'WITH(STATISTICS_ONLY = -1)'
           ELSE ''
         END +
         ';' AS create_cmd
    FROM tSQLt.Private_SysIndexes AS I
   CROSS APPLY
   (
     SELECT
      (
        SELECT 
          CASE WHEN OIC.rn > 1 THEN ',' ELSE '' END +
          CASE WHEN OIC.rn = 1 AND OIC.is_included_column = 1 AND I.type NOT IN (6) THEN ')INCLUDE(' ELSE '' END +
          QUOTENAME(OIC.name) +
          CASE WHEN OIC.is_included_column = 0
            THEN CASE WHEN OIC.is_descending_key = 1 THEN 'DESC' ELSE 'ASC' END
            ELSE ''
          END
          FROM
          (
            SELECT C.name,
                   IC.is_descending_key, 
                   IC.key_ordinal,
                   IC.is_included_column,
                   ROW_NUMBER()OVER(PARTITION BY IC.is_included_column ORDER BY IC.key_ordinal, IC.index_column_id) AS rn
              FROM sys.index_columns AS IC
              JOIN sys.columns AS C
                ON IC.column_id = C.column_id
               AND IC.object_id = C.object_id
             WHERE IC.object_id = I.object_id
               AND IC.index_id = I.index_id
          )OIC
         ORDER BY OIC.is_included_column, OIC.rn
           FOR XML PATH(''),TYPE
      ).value('.','NVARCHAR(MAX)') AS column_list
   )CL
   WHERE I.object_id = @object_id
     AND I.index_id = ISNULL(@index_id,I.index_id);
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_RemoveSchemaBinding
  @object_id INT
AS
BEGIN
  DECLARE @cmd NVARCHAR(MAX);
  SELECT @cmd = tSQLt.[Private]::GetAlterStatementWithoutSchemaBinding(SM.definition)
    FROM sys.sql_modules AS SM
   WHERE SM.object_id = @object_id;
   EXEC(@cmd);
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_RemoveSchemaBoundReferences
  @object_id INT
AS
BEGIN
  DECLARE @cmd NVARCHAR(MAX);
  SELECT @cmd = 
  (
    SELECT 
      'EXEC tSQLt.Private_RemoveSchemaBoundReferences @object_id = '+STR(SED.referencing_id)+';'+
      'EXEC tSQLt.Private_RemoveSchemaBinding @object_id = '+STR(SED.referencing_id)+';'
      FROM
      (
        SELECT DISTINCT SEDI.referencing_id,SEDI.referenced_id 
          FROM sys.sql_expression_dependencies AS SEDI
         WHERE SEDI.is_schema_bound_reference = 1
      ) AS SED 
     WHERE SED.referenced_id = @object_id
       FOR XML PATH(''),TYPE
  ).value('.','NVARCHAR(MAX)');
  EXEC(@cmd);
END;
GO


GO

GO
CREATE FUNCTION tSQLt.Private_GetForeignKeyParColumns(
    @ConstraintObjectId INT
)
RETURNS TABLE
AS
RETURN SELECT STUFF((
                 SELECT ','+QUOTENAME(pci.name) FROM sys.foreign_key_columns c
                   JOIN sys.columns pci
                   ON pci.object_id = c.parent_object_id
                  AND pci.column_id = c.parent_column_id
                   WHERE @ConstraintObjectId = c.constraint_object_id
                   FOR XML PATH(''),TYPE
                   ).value('.','NVARCHAR(MAX)'),1,1,'')  AS ColNames
GO

CREATE FUNCTION tSQLt.Private_GetForeignKeyRefColumns(
    @ConstraintObjectId INT
)
RETURNS TABLE
AS
RETURN SELECT STUFF((
                 SELECT ','+QUOTENAME(rci.name) FROM sys.foreign_key_columns c
                   JOIN sys.columns rci
                  ON rci.object_id = c.referenced_object_id
                  AND rci.column_id = c.referenced_column_id
                   WHERE @ConstraintObjectId = c.constraint_object_id
                   FOR XML PATH(''),TYPE
                   ).value('.','NVARCHAR(MAX)'),1,1,'')  AS ColNames;
GO

CREATE FUNCTION tSQLt.Private_GetForeignKeyDefinition(
    @SchemaName NVARCHAR(MAX),
    @ParentTableName NVARCHAR(MAX),
    @ForeignKeyName NVARCHAR(MAX),
    @NoCascade BIT
)
RETURNS TABLE
AS
RETURN SELECT 'CONSTRAINT ' + name + ' FOREIGN KEY (' +
              parCols + ') REFERENCES ' + refName + '(' + refCols + ')'+
              CASE WHEN @NoCascade = 1 THEN ''
                ELSE delete_referential_action_cmd + ' ' + update_referential_action_cmd 
              END AS cmd,
              CASE 
                WHEN RefTableIsFakedInd = 1
                  THEN 'CREATE UNIQUE INDEX ' + tSQLt.Private::CreateUniqueObjectName() + ' ON ' + refName + '(' + refCols + ');' 
                ELSE '' 
              END CreIdxCmd
         FROM (SELECT QUOTENAME(SCHEMA_NAME(k.schema_id)) AS SchemaName,
                      QUOTENAME(k.name) AS name,
                      QUOTENAME(OBJECT_NAME(k.parent_object_id)) AS parName,
                      QUOTENAME(SCHEMA_NAME(refTab.schema_id)) + '.' + QUOTENAME(refTab.name) AS refName,
                      parCol.ColNames AS parCols,
                      refCol.ColNames AS refCols,
                      'ON UPDATE '+
                      CASE k.update_referential_action
                        WHEN 0 THEN 'NO ACTION'
                        WHEN 1 THEN 'CASCADE'
                        WHEN 2 THEN 'SET NULL'
                        WHEN 3 THEN 'SET DEFAULT'
                      END AS update_referential_action_cmd,
                      'ON DELETE '+
                      CASE k.delete_referential_action
                        WHEN 0 THEN 'NO ACTION'
                        WHEN 1 THEN 'CASCADE'
                        WHEN 2 THEN 'SET NULL'
                        WHEN 3 THEN 'SET DEFAULT'
                      END AS delete_referential_action_cmd,
                      CASE WHEN e.name IS NULL THEN 0
                           ELSE 1 
                       END AS RefTableIsFakedInd
                 FROM sys.foreign_keys k
                 CROSS APPLY tSQLt.Private_GetForeignKeyParColumns(k.object_id) AS parCol
                 CROSS APPLY tSQLt.Private_GetForeignKeyRefColumns(k.object_id) AS refCol
                 LEFT JOIN sys.extended_properties e
                   ON e.name = 'tSQLt.Private_TestDouble_OrgObjectName'
                  AND e.value = OBJECT_NAME(k.referenced_object_id)
                 JOIN sys.tables refTab
                   ON COALESCE(e.major_id,k.referenced_object_id) = refTab.object_id
                WHERE k.parent_object_id = OBJECT_ID(@SchemaName + '.' + @ParentTableName)
                  AND k.object_id = OBJECT_ID(@SchemaName + '.' + @ForeignKeyName)
               )x;
GO


GO

GO
CREATE FUNCTION tSQLt.Private_GetQuotedTableNameForConstraint(@ConstraintObjectId INT)
RETURNS TABLE
AS
RETURN
  SELECT QUOTENAME(SCHEMA_NAME(newtbl.schema_id)) + '.' + QUOTENAME(OBJECT_NAME(newtbl.object_id)) QuotedTableName,
         SCHEMA_NAME(newtbl.schema_id) SchemaName,
         OBJECT_NAME(newtbl.object_id) TableName,
         OBJECT_NAME(constraints.parent_object_id) OrgTableName
      FROM sys.objects AS constraints
      JOIN sys.extended_properties AS p
      JOIN sys.objects AS newtbl
        ON newtbl.object_id = p.major_id
       AND p.minor_id = 0
       AND p.class_desc = 'OBJECT_OR_COLUMN'
       AND p.name = 'tSQLt.Private_TestDouble_OrgObjectName'
        ON OBJECT_NAME(constraints.parent_object_id) = CAST(p.value AS NVARCHAR(4000))
       AND constraints.schema_id = newtbl.schema_id
       AND constraints.object_id = @ConstraintObjectId;
GO

CREATE FUNCTION tSQLt.Private_FindConstraint
(
  @TableObjectId INT,
  @ConstraintName NVARCHAR(MAX)
)
RETURNS TABLE
AS
RETURN
  SELECT TOP(1) constraints.object_id AS ConstraintObjectId, type_desc AS ConstraintType
    FROM sys.objects constraints
    CROSS JOIN tSQLt.Private_GetOriginalTableInfo(@TableObjectId) orgTbl
   WHERE @ConstraintName IN (constraints.name, QUOTENAME(constraints.name))
     AND constraints.parent_object_id = orgTbl.OrgTableObjectId
   ORDER BY LEN(constraints.name) ASC;
GO

CREATE FUNCTION tSQLt.Private_ResolveApplyConstraintParameters
(
  @A NVARCHAR(MAX),
  @B NVARCHAR(MAX),
  @C NVARCHAR(MAX)
)
RETURNS TABLE
AS 
RETURN
  SELECT ConstraintObjectId, ConstraintType
    FROM tSQLt.Private_FindConstraint(OBJECT_ID(@A), @B)
   WHERE @C IS NULL
   UNION ALL
  SELECT *
    FROM tSQLt.Private_FindConstraint(OBJECT_ID(@A + '.' + @B), @C)
   UNION ALL
  SELECT *
    FROM tSQLt.Private_FindConstraint(OBJECT_ID(@C + '.' + @A), @B);
GO

CREATE PROCEDURE tSQLt.Private_ApplyCheckConstraint
  @ConstraintObjectId INT
AS
BEGIN
  DECLARE @Cmd NVARCHAR(MAX);
  DECLARE @NewNameOfOriginalConstraint NVARCHAR(MAX);
  DECLARE @QuotedFullConstraintName NVARCHAR(MAX);
  SELECT @Cmd = 'CONSTRAINT ' + QUOTENAME(name) + ' CHECK' + definition 
    FROM sys.check_constraints
   WHERE object_id = @ConstraintObjectId;
  
  DECLARE @QuotedTableName NVARCHAR(MAX);
  
  SELECT @QuotedTableName = QuotedTableName FROM tSQLt.Private_GetQuotedTableNameForConstraint(@ConstraintObjectId);

  SELECT @Cmd = 'ALTER TABLE ' + @QuotedTableName + ' ADD ' + @Cmd,
         @QuotedFullConstraintName = QUOTENAME(SCHEMA_NAME(schema_id))+'.'+QUOTENAME(name)
    FROM sys.objects 
   WHERE object_id = @ConstraintObjectId;

  EXEC tSQLt.Private_RenameObjectToUniqueNameUsingObjectId @ConstraintObjectId, @NewName = @NewNameOfOriginalConstraint OUT;

  EXEC (@Cmd);

  EXEC tSQLt.Private_MarktSQLtTempObject @ObjectName = @QuotedFullConstraintName, @ObjectType = 'CONSTRAINT', @NewNameOfOriginalObject = @NewNameOfOriginalConstraint;
END; 
GO

CREATE PROCEDURE tSQLt.Private_ApplyForeignKeyConstraint 
  @ConstraintObjectId INT,
  @NoCascade BIT
AS
BEGIN
  DECLARE @SchemaName NVARCHAR(MAX);
  DECLARE @OrgTableName NVARCHAR(MAX);
  DECLARE @TableName NVARCHAR(MAX);
  DECLARE @ConstraintName NVARCHAR(MAX);
  DECLARE @CreateFkCmd NVARCHAR(MAX);
  DECLARE @AlterTableCmd NVARCHAR(MAX);
  DECLARE @CreateIndexCmd NVARCHAR(MAX);
  DECLARE @FinalCmd NVARCHAR(MAX);
  DECLARE @NewNameOfOriginalConstraint NVARCHAR(MAX);
  DECLARE @QuotedFullConstraintName NVARCHAR(MAX);

  
  SELECT @SchemaName = SchemaName,
         @OrgTableName = OrgTableName,
         @TableName = TableName,
         @ConstraintName = OBJECT_NAME(@ConstraintObjectId),
         @QuotedFullConstraintName = QUOTENAME(SchemaName)+'.'+QUOTENAME(OBJECT_NAME(@ConstraintObjectId))
    FROM tSQLt.Private_GetQuotedTableNameForConstraint(@ConstraintObjectId);
      
  SELECT @CreateFkCmd = cmd, @CreateIndexCmd = CreIdxCmd
    FROM tSQLt.Private_GetForeignKeyDefinition(@SchemaName, @OrgTableName, @ConstraintName, @NoCascade);
  SELECT @AlterTableCmd = 'ALTER TABLE ' + QUOTENAME(@SchemaName) + '.' + QUOTENAME(@TableName) + 
                          ' ADD ' + @CreateFkCmd;
  SELECT @FinalCmd = @CreateIndexCmd + @AlterTableCmd;

  EXEC tSQLt.Private_RenameObjectToUniqueName @SchemaName, @ConstraintName, @NewName = @NewNameOfOriginalConstraint OUTPUT;
  EXEC (@FinalCmd);

  EXEC tSQLt.Private_MarktSQLtTempObject @ObjectName = @QuotedFullConstraintName, @ObjectType = 'CONSTRAINT', @NewNameOfOriginalObject = @NewNameOfOriginalConstraint;

END;
GO

CREATE PROCEDURE tSQLt.Private_ApplyUniqueConstraint 
  @ConstraintObjectId INT
AS
BEGIN
  DECLARE @SchemaName NVARCHAR(MAX);
  DECLARE @TableName NVARCHAR(MAX);
  DECLARE @ConstraintName NVARCHAR(MAX);
  DECLARE @CreateConstraintCmd NVARCHAR(MAX);
  DECLARE @AlterColumnsCmd NVARCHAR(MAX);
  DECLARE @NewNameOfOriginalConstraint NVARCHAR(MAX);
  DECLARE @QuotedFullConstraintName NVARCHAR(MAX);
  
  SELECT @SchemaName = SchemaName,
         @TableName = TableName,
         @ConstraintName = OBJECT_NAME(@ConstraintObjectId),
         @QuotedFullConstraintName = QUOTENAME(SchemaName)+'.'+QUOTENAME(OBJECT_NAME(@ConstraintObjectId))
    FROM tSQLt.Private_GetQuotedTableNameForConstraint(@ConstraintObjectId);
      
  SELECT @AlterColumnsCmd = NotNullColumnCmd,
         @CreateConstraintCmd = CreateConstraintCmd
    FROM tSQLt.Private_GetUniqueConstraintDefinition(@ConstraintObjectId, QUOTENAME(@SchemaName) + '.' + QUOTENAME(@TableName));

  EXEC tSQLt.Private_RenameObjectToUniqueName @SchemaName, @ConstraintName, @NewName = @NewNameOfOriginalConstraint OUTPUT;
  EXEC (@AlterColumnsCmd);
  EXEC (@CreateConstraintCmd);

  EXEC tSQLt.Private_MarktSQLtTempObject @ObjectName = @QuotedFullConstraintName, @ObjectType = 'CONSTRAINT', @NewNameOfOriginalObject = @NewNameOfOriginalConstraint;
END;
GO

CREATE FUNCTION tSQLt.Private_GetConstraintType(@TableObjectId INT, @ConstraintName NVARCHAR(MAX))
RETURNS TABLE
AS
RETURN
  SELECT object_id,type,type_desc
    FROM sys.objects 
   WHERE object_id = OBJECT_ID(SCHEMA_NAME(schema_id)+'.'+@ConstraintName)
     AND parent_object_id = @TableObjectId;
GO

CREATE PROCEDURE tSQLt.ApplyConstraint
       @TableName NVARCHAR(MAX),
       @ConstraintName NVARCHAR(MAX),
       @SchemaName NVARCHAR(MAX) = NULL, --parameter preserved for backward compatibility. Do not use. Will be removed soon.
       @NoCascade BIT = 0
AS
BEGIN
  DECLARE @ConstraintType NVARCHAR(MAX);
  DECLARE @ConstraintObjectId INT;
  
  SELECT @ConstraintType = ConstraintType, @ConstraintObjectId = ConstraintObjectId
    FROM tSQLt.Private_ResolveApplyConstraintParameters (@TableName, @ConstraintName, @SchemaName);

  IF @ConstraintType = 'CHECK_CONSTRAINT'
  BEGIN
    EXEC tSQLt.Private_ApplyCheckConstraint @ConstraintObjectId;
    RETURN 0;
  END

  IF @ConstraintType = 'FOREIGN_KEY_CONSTRAINT'
  BEGIN
    EXEC tSQLt.Private_ApplyForeignKeyConstraint @ConstraintObjectId, @NoCascade;
    RETURN 0;
  END;  
   
  IF @ConstraintType IN('UNIQUE_CONSTRAINT', 'PRIMARY_KEY_CONSTRAINT')
  BEGIN
    EXEC tSQLt.Private_ApplyUniqueConstraint @ConstraintObjectId;
    RETURN 0;
  END;  
   
  RAISERROR ('ApplyConstraint could not resolve the object names, ''%s'', ''%s''. Be sure to call ApplyConstraint and pass in two parameters, such as: EXEC tSQLt.ApplyConstraint ''MySchema.MyTable'', ''MyConstraint''', 
             16, 10, @TableName, @ConstraintName);
  RETURN 0;
END;
GO


GO

CREATE PROCEDURE tSQLt.Private_ValidateFakeTableParameters
  @SchemaName NVARCHAR(MAX),
  @OrigTableName NVARCHAR(MAX),
  @OrigSchemaName NVARCHAR(MAX)
AS
BEGIN
   IF @SchemaName IS NULL
   BEGIN
        DECLARE @FullName NVARCHAR(MAX); SET @FullName = @OrigTableName + COALESCE('.' + @OrigSchemaName, '');
        
        RAISERROR ('FakeTable could not resolve the object name, ''%s''. (When calling tSQLt.FakeTable, avoid the use of the @SchemaName parameter, as it is deprecated.)', 
                   16, 10, @FullName);
   END;
END;


GO

GO
CREATE FUNCTION tSQLt.Private_GetDataTypeOrComputedColumnDefinition(@UserTypeId INT, @MaxLength INT, @Precision INT, @Scale INT, @CollationName NVARCHAR(MAX), @ObjectId INT, @ColumnId INT, @ReturnDetails BIT)
RETURNS TABLE
AS
RETURN SELECT 
              COALESCE(cc.IsComputedColumn, 0) AS IsComputedColumn,
              COALESCE(cc.ComputedColumnDefinition, GFTN.TypeName) AS ColumnDefinition
        FROM (SELECT @UserTypeId, @MaxLength, @Precision, @Scale, @CollationName, @ObjectId, @ColumnId, @ReturnDetails) 
             AS V(UserTypeId, MaxLength, Precision, Scale, CollationName, ObjectId, ColumnId, ReturnDetails)
       CROSS APPLY tSQLt.Private_GetFullTypeName(V.UserTypeId, V.MaxLength, V.Precision, V.Scale, V.CollationName) AS GFTN
        LEFT JOIN (SELECT 1 AS IsComputedColumn,
                          ' AS '+ cci.definition + CASE WHEN cci.is_persisted = 1 THEN ' PERSISTED' ELSE '' END AS ComputedColumnDefinition,
                          cci.object_id,
                          cci.column_id
                     FROM sys.computed_columns cci
                  )cc
               ON cc.object_id = V.ObjectId
              AND cc.column_id = V.ColumnId
              AND V.ReturnDetails = 1;               


GO

CREATE FUNCTION tSQLt.Private_GetIdentityDefinition(@ObjectId INT, @ColumnId INT, @ReturnDetails BIT)
RETURNS TABLE
AS
RETURN SELECT 
              COALESCE(IsIdentity, 0) AS IsIdentityColumn,
              COALESCE(IdentityDefinition, '') AS IdentityDefinition
        FROM (SELECT 1) X(X)
        LEFT JOIN (SELECT 1 AS IsIdentity,
                          ' IDENTITY(' + CAST(seed_value AS NVARCHAR(MAX)) + ',' + CAST(increment_value AS NVARCHAR(MAX)) + ')' AS IdentityDefinition, 
                          object_id, 
                          column_id
                     FROM sys.identity_columns
                  ) AS id
               ON id.object_id = @ObjectId
              AND id.column_id = @ColumnId
              AND @ReturnDetails = 1;               


GO

GO
CREATE FUNCTION tSQLt.Private_GetDefaultConstraintDefinition(@ObjectId INT, @ColumnId INT, @ReturnDetails BIT)
RETURNS TABLE
AS
RETURN SELECT 
              COALESCE(IsDefault, 0) AS IsDefault,
              COALESCE(DefaultDefinition, '') AS DefaultDefinition
        FROM (SELECT 1) X(X)
        LEFT JOIN (SELECT 1 AS IsDefault,' DEFAULT '+ definition AS DefaultDefinition,parent_object_id,parent_column_id
                     FROM sys.default_constraints
                  )dc
               ON dc.parent_object_id = @ObjectId
              AND dc.parent_column_id = @ColumnId
              AND @ReturnDetails = 1;               


GO

GO
CREATE FUNCTION tSQLt.Private_GetUniqueConstraintDefinition
(
    @ConstraintObjectId INT,
    @QuotedTableName NVARCHAR(MAX)
)
RETURNS TABLE
AS
RETURN
  SELECT 'ALTER TABLE '+
         @QuotedTableName +
         ' ADD CONSTRAINT ' +
         QUOTENAME(OBJECT_NAME(@ConstraintObjectId)) +
         ' ' +
         CASE WHEN KC.type_desc = 'UNIQUE_CONSTRAINT' 
              THEN 'UNIQUE'
              ELSE 'PRIMARY KEY'
           END +
         '(' +
         STUFF((
                 SELECT ','+QUOTENAME(C.name)
                   FROM sys.index_columns AS IC
                   JOIN sys.columns AS C
                     ON IC.object_id = C.object_id
                    AND IC.column_id = C.column_id
                  WHERE KC.unique_index_id = IC.index_id
                    AND KC.parent_object_id = IC.object_id
                    FOR XML PATH(''),TYPE
               ).value('.','NVARCHAR(MAX)'),
               1,
               1,
               ''
              ) +
         ');' AS CreateConstraintCmd,
         CASE WHEN KC.type_desc = 'UNIQUE_CONSTRAINT' 
              THEN ''
              ELSE (
                     SELECT 'ALTER TABLE ' +
                            @QuotedTableName +
                            ' ALTER COLUMN ' +
                            QUOTENAME(C.name)+
                            cc.ColumnDefinition +
                            ' NOT NULL;'
                       FROM sys.index_columns AS IC
                       JOIN sys.columns AS C
                         ON IC.object_id = C.object_id
                        AND IC.column_id = C.column_id
                      CROSS APPLY tSQLt.Private_GetDataTypeOrComputedColumnDefinition(C.user_type_id, C.max_length, C.precision, C.scale, C.collation_name, C.object_id, C.column_id, 0) cc
                      WHERE KC.unique_index_id = IC.index_id
                        AND KC.parent_object_id = IC.object_id
                        FOR XML PATH(''),TYPE
                   ).value('.','NVARCHAR(MAX)')
           END AS NotNullColumnCmd
    FROM sys.key_constraints AS KC
   WHERE KC.object_id = @ConstraintObjectId;
GO


GO

GO
CREATE FUNCTION tSQLt.Private_CreateFakeTableStatement(
  @OriginalTableObjectId INT,
  @FullFakeTableName NVARCHAR(MAX),
  @Identity BIT,
  @ComputedColumns BIT,
  @Defaults BIT,
  @PreserveNOTNULL BIT
)
RETURNS TABLE
AS
RETURN
  SELECT 
      'CREATE TABLE ' + @FullFakeTableName + '(' + STUFF(Cols,1,1,'') + ')' CreateTableStatement,
      'CREATE TYPE ' + @FullFakeTableName + ' AS TABLE(' + STUFF(Cols,1,1,'') + ')' CreateTableTypeStatement
    FROM 
    (
      SELECT
      (
        SELECT
           ',' +
           QUOTENAME(name) + 
           cc.ColumnDefinition +
           dc.DefaultDefinition + 
           id.IdentityDefinition +
           CASE WHEN cc.IsComputedColumn = 1 OR id.IsIdentityColumn = 1 
                THEN ''
                ELSE CASE WHEN @PreserveNOTNULL = 1 AND c.is_nullable = 0 THEN ' NOT NULL' ELSE ' NULL' END
           END
          FROM sys.columns c
         CROSS APPLY tSQLt.Private_GetDataTypeOrComputedColumnDefinition(c.user_type_id, c.max_length, c.precision, c.scale, c.collation_name, c.object_id, c.column_id, @ComputedColumns) cc
         CROSS APPLY tSQLt.Private_GetDefaultConstraintDefinition(c.object_id, c.column_id, @Defaults) AS dc
         CROSS APPLY tSQLt.Private_GetIdentityDefinition(c.object_id, c.column_id, @Identity) AS id
         WHERE object_id = @OriginalTableObjectId
         ORDER BY column_id
         FOR XML PATH(''), TYPE
      ).value('.', 'NVARCHAR(MAX)')
    ) AS X(Cols);
GO


GO

CREATE PROCEDURE tSQLt.Private_CreateFakeOfTable
  @SchemaName NVARCHAR(MAX),
  @TableName NVARCHAR(MAX),
  @OrigTableObjectId INT,
  @Identity BIT,
  @ComputedColumns BIT,
  @Defaults BIT
AS
BEGIN
   DECLARE @cmd NVARCHAR(MAX) =
     (SELECT CreateTableStatement 
        FROM tSQLt.Private_CreateFakeTableStatement(@OrigTableObjectId, @SchemaName+'.'+@TableName,@Identity,@ComputedColumns,@Defaults,0));
   EXEC (@cmd);
END;


GO

CREATE PROCEDURE tSQLt.FakeTable
    @TableName NVARCHAR(MAX),
    @SchemaName NVARCHAR(MAX) = NULL, --parameter preserved for backward compatibility. Do not use. Will be removed soon.
    @Identity BIT = NULL,
    @ComputedColumns BIT = NULL,
    @Defaults BIT = NULL
AS
BEGIN
   DECLARE @OrigObjectCleanQuotedSchemaName NVARCHAR(MAX);
   DECLARE @OrigObjectCleanQuotedName NVARCHAR(MAX);
   DECLARE @OrigObjectNewName NVARCHAR(4000);
   DECLARE @OrigObjectFullName NVARCHAR(MAX) = NULL;
   DECLARE @TargetObjectFullName NVARCHAR(MAX) = NULL;
   DECLARE @OriginalObjectObjectId INT;
   DECLARE @TargetObjectObjectId INT;
      
   IF(@TableName NOT IN (PARSENAME(@TableName,1),QUOTENAME(PARSENAME(@TableName,1)))
      AND @SchemaName IS NOT NULL)
   BEGIN
     RAISERROR('When @TableName is a multi-part identifier, @SchemaName must be NULL!',16,10);
   END

   SELECT @OrigObjectCleanQuotedSchemaName = CleanSchemaName,
          @OrigObjectCleanQuotedName = CleanTableName
     FROM tSQLt.Private_ResolveFakeTableNamesForBackwardCompatibility(@TableName, @SchemaName);
   
   EXEC tSQLt.Private_ValidateFakeTableParameters @OrigObjectCleanQuotedSchemaName,@TableName,@SchemaName;

   SET @OrigObjectFullName = @OrigObjectCleanQuotedSchemaName + '.' + @OrigObjectCleanQuotedName;

   EXEC tSQLt.Private_RenameObjectToUniqueName @OrigObjectCleanQuotedSchemaName, @OrigObjectCleanQuotedName, @OrigObjectNewName OUTPUT;

   SET @OriginalObjectObjectId = OBJECT_ID(@OrigObjectCleanQuotedSchemaName + '.' + QUOTENAME(@OrigObjectNewName));

   SELECT @TargetObjectFullName = S.base_object_name
     FROM sys.synonyms AS S 
    WHERE S.object_id = @OriginalObjectObjectId;

   IF(@TargetObjectFullName IS NOT NULL)
   BEGIN
     IF(COALESCE(OBJECT_ID(@TargetObjectFullName,'U'),OBJECT_ID(@TargetObjectFullName,'V')) IS NULL)
     BEGIN
       RAISERROR('Cannot fake synonym %s as it is pointing to %s, which is not a table or view!',16,10,@OrigObjectFullName,@TargetObjectFullName);
     END;
     SET @TargetObjectObjectId = OBJECT_ID(@TargetObjectFullName);
   END;
   ELSE
   BEGIN
     SET @TargetObjectObjectId = @OriginalObjectObjectId;
   END;

   EXEC tSQLt.Private_CreateFakeOfTable @OrigObjectCleanQuotedSchemaName, @OrigObjectCleanQuotedName, @TargetObjectObjectId, @Identity, @ComputedColumns, @Defaults;

   EXEC tSQLt.Private_MarktSQLtTempObject @OrigObjectFullName, N'TABLE', @OrigObjectNewName;
END


GO

CREATE PROCEDURE tSQLt.Private_GenerateCreateProcedureSpyStatement
    @ProcedureObjectId INT,
    @OriginalProcedureName NVARCHAR(MAX),
    @UnquotedNewNameOfProcedure NVARCHAR(MAX) = NULL,
    @LogTableName NVARCHAR(MAX),
    @CommandToExecute NVARCHAR(MAX),
    @CallOriginal BIT,
    @CreateProcedureStatement NVARCHAR(MAX) OUTPUT,
    @CreateLogTableStatement NVARCHAR(MAX) OUTPUT
AS
BEGIN
    DECLARE @ProcParmListForInsert NVARCHAR(MAX) = '';
    DECLARE @ProcParmListForCall NVARCHAR(MAX) = '';
    DECLARE @TableColList NVARCHAR(MAX) = '';
    DECLARE @ProcParmTypeList NVARCHAR(MAX) = '';
    DECLARE @TableColTypeList NVARCHAR(MAX) = '';

    DECLARE @SeparatorWithoutCursor CHAR(1) = '';
    DECLARE @SeparatorWithCursor CHAR(1) = '';
    DECLARE @ParamName sysname;
    DECLARE @TypeName sysname;
    DECLARE @IsOutput BIT;
    DECLARE @IsCursorRef BIT;
    DECLARE @IsTableType BIT;
            
    DECLARE Parameters CURSOR FOR
     SELECT p.name, t.TypeName, p.is_output, p.is_cursor_ref, t.IsTableType
       FROM sys.parameters p
       CROSS APPLY tSQLt.Private_GetFullTypeName(p.user_type_id,p.max_length,p.precision,p.scale,NULL) t
      WHERE object_id = @ProcedureObjectId;
    
    OPEN Parameters;
    
    FETCH NEXT FROM Parameters INTO @ParamName, @TypeName, @IsOutput, @IsCursorRef, @IsTableType;
    WHILE (@@FETCH_STATUS = 0)
    BEGIN
        IF @IsCursorRef = 0
        BEGIN
            SELECT @ProcParmListForInsert = @ProcParmListForInsert + @SeparatorWithoutCursor + 
                                   CASE WHEN @IsTableType = 1 
                                     THEN '(SELECT * FROM '+@ParamName+' FOR XML PATH(''row''),TYPE,ROOT('''+STUFF(@ParamName,1,1,'')+'''))' 
                                     ELSE @ParamName 
                                   END, 
                   @TableColList = @TableColList + @SeparatorWithoutCursor + '[' + STUFF(@ParamName,1,1,'') + ']', 
                   @ProcParmTypeList = @ProcParmTypeList + @SeparatorWithCursor + @ParamName + ' ' + @TypeName + 
                                       CASE WHEN @IsTableType = 1 THEN ' READONLY' ELSE ' = NULL ' END+ 
                                       CASE WHEN @IsOutput = 1 THEN ' OUT' ELSE '' END, 
                   @TableColTypeList = @TableColTypeList + ',[' + STUFF(@ParamName,1,1,'') + '] ' + 
                          CASE 
                               WHEN @IsTableType = 1
                               THEN 'XML'
                               WHEN @TypeName LIKE '%nchar%'
                                 OR @TypeName LIKE '%nvarchar%'
                               THEN 'NVARCHAR(MAX)'
                               WHEN @TypeName LIKE '%char%'
                               THEN 'VARCHAR(MAX)'
                               ELSE @TypeName
                          END + ' NULL';

            SELECT @SeparatorWithoutCursor = ',';        
        END
        ELSE
        BEGIN
            SELECT @ProcParmTypeList = @ProcParmTypeList + @SeparatorWithCursor + @ParamName + ' CURSOR VARYING OUTPUT';
        END;
        SELECT 
            @ProcParmListForCall = @ProcParmListForCall + @SeparatorWithCursor + @ParamName + 
            CASE 
              WHEN @IsOutput = 1 AND @IsCursorRef <> 1
                THEN ' OUT' 
              ELSE '' 
            END;
        SELECT @SeparatorWithCursor = ',';

        FETCH NEXT FROM Parameters INTO @ParamName, @TypeName, @IsOutput, @IsCursorRef, @IsTableType;
    END;
    
    CLOSE Parameters;
    DEALLOCATE Parameters;
    
    DECLARE @InsertStmt NVARCHAR(MAX);
    SELECT @InsertStmt = 'INSERT INTO ' + @LogTableName + 
                         CASE WHEN @TableColList = '' THEN ' DEFAULT VALUES'
                              ELSE ' (' + @TableColList + ') SELECT ' + @ProcParmListForInsert
                         END + ';';
                         
    SELECT @CreateLogTableStatement = 'CREATE TABLE ' + @LogTableName + ' (_id_ int IDENTITY(1,1) PRIMARY KEY CLUSTERED ' + @TableColTypeList + ');';

    SELECT @CreateProcedureStatement = 
             'CREATE PROCEDURE ' + @OriginalProcedureName + ' ' + @ProcParmTypeList + 
             ' AS BEGIN ' + 
                ISNULL(@InsertStmt,'') + 
                ISNULL('DECLARE @SpyProcedureOriginalObjectName NVARCHAR(MAX) = '''+REPLACE(QUOTENAME(OBJECT_SCHEMA_NAME(@ProcedureObjectId))+'.'+QUOTENAME(@UnquotedNewNameOfProcedure),'''','''''')+''';','')+
                ISNULL(@CommandToExecute + ';', '') +
                CHAR(13)+CHAR(10)+/*CR,LF*/
                CASE WHEN @CallOriginal = 1 
                     THEN 'EXEC @SpyProcedureOriginalObjectName ' + @ProcParmListForCall + ';'
                     ELSE ''
                END +
             ' RETURN;' +
             ' END;';
    --RAISERROR(@CreateProcedureStatement, 0, 1) WITH NOWAIT;

    RETURN;
END;


GO

CREATE PROCEDURE tSQLt.Private_CreateProcedureSpy
    @ProcedureObjectId INT,
    @OriginalProcedureName NVARCHAR(MAX),
    @LogTableName NVARCHAR(MAX),
    @CommandToExecute NVARCHAR(MAX) = NULL
AS
BEGIN

    RETURN;
END;


GO

GO
CREATE PROCEDURE tSQLt.Private_ValidateProcedureCanBeUsedWithSpyProcedure
    @ProcedureName NVARCHAR(MAX)
AS
BEGIN
    IF NOT EXISTS(SELECT 1 FROM sys.procedures WHERE object_id = OBJECT_ID(@ProcedureName))
    BEGIN
      RAISERROR('Cannot use SpyProcedure on %s because the procedure does not exist', 16, 10, @ProcedureName) WITH NOWAIT;
    END;
    
    IF (1020 < (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(@ProcedureName)))
    BEGIN
      RAISERROR('Cannot use SpyProcedure on procedure %s because it contains more than 1020 parameters', 16, 10, @ProcedureName) WITH NOWAIT;
    END;
END;
GO




GO

CREATE PROCEDURE tSQLt.SpyProcedure
    @ProcedureName NVARCHAR(MAX),
    @CommandToExecute NVARCHAR(MAX) = NULL,
    @CallOriginal BIT = 0
AS
BEGIN
    DECLARE @ProcedureObjectId INT;
    SELECT @ProcedureObjectId = OBJECT_ID(@ProcedureName);

    EXEC tSQLt.Private_ValidateProcedureCanBeUsedWithSpyProcedure @ProcedureName;

    DECLARE @LogTableName NVARCHAR(MAX);
    SELECT @LogTableName = QUOTENAME(OBJECT_SCHEMA_NAME(@ProcedureObjectId)) + '.' + QUOTENAME(OBJECT_NAME(@ProcedureObjectId)+'_SpyProcedureLog');

    DECLARE @CreateProcedureStatement NVARCHAR(MAX);
    DECLARE @CreateLogTableStatement NVARCHAR(MAX);

    DECLARE @NewNameOfOriginalObject NVARCHAR(MAX) =  tSQLt.Private::CreateUniqueObjectName();

    EXEC tSQLt.Private_GenerateCreateProcedureSpyStatement
           @ProcedureObjectId = @ProcedureObjectId,
           @OriginalProcedureName = @ProcedureName,
           @UnquotedNewNameOfProcedure = @NewNameOfOriginalObject,
           @LogTableName = @LogTableName,
           @CommandToExecute = @CommandToExecute,
           @CallOriginal = @CallOriginal,
           @CreateProcedureStatement = @CreateProcedureStatement OUT,
           @CreateLogTableStatement = @CreateLogTableStatement OUT;

    DECLARE @LogTableObjectId INT = OBJECT_ID(@LogTableName);
    IF(@LogTableObjectId IS NOT NULL)
    BEGIN
      EXEC tSQLt.Private_RenameObjectToUniqueNameUsingObjectId @ObjectId = @LogTableObjectId;
    END;
    EXEC(@CreateLogTableStatement);

    EXEC tSQLt.Private_RenameObjectToUniqueNameUsingObjectId @ProcedureObjectId, @NewName = @NewNameOfOriginalObject OUTPUT;
    EXEC(@CreateProcedureStatement);

    EXEC tSQLt.Private_MarktSQLtTempObject @ProcedureName, N'PROCEDURE', @NewNameOfOriginalObject;
    EXEC tSQLt.Private_MarktSQLtTempObject @LogTableName, N'TABLE', NULL;

    RETURN 0;
END;


GO

GO
CREATE FUNCTION tSQLt.Private_GetCommaSeparatedColumnList (@Table NVARCHAR(MAX), @ExcludeColumn NVARCHAR(MAX))
RETURNS NVARCHAR(MAX)
AS 
BEGIN
  RETURN STUFF((
     SELECT ',' + CASE WHEN system_type_id = TYPE_ID('timestamp') THEN ';TIMESTAMP columns are unsupported!;' ELSE QUOTENAME(name) END 
       FROM sys.columns 
      WHERE object_id = OBJECT_ID(@Table) 
        AND name <> @ExcludeColumn 
      ORDER BY column_id
     FOR XML PATH(''), TYPE).value('.','NVARCHAR(MAX)')
    ,1, 1, '');
        
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_CreateResultTableForCompareTables
 @ResultTable NVARCHAR(MAX),
 @ResultColumn NVARCHAR(MAX),
 @BaseTable NVARCHAR(MAX)
AS
BEGIN
  DECLARE @Cmd NVARCHAR(MAX);
  SET @Cmd = '
     SELECT TOP(0) ''>'' AS ' + @ResultColumn + ', Expected.* INTO ' + @ResultTable + ' 
       FROM ' + @BaseTable + ' AS Expected RIGHT JOIN ' + @BaseTable + ' AS X ON 1=0; '
  EXEC(@Cmd);
  EXEC tSQLt.Private_MarktSQLtTempObject @ObjectName = @ResultTable, @ObjectType = N'TABLE';
END
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_ValidateThatAllDataTypesInTableAreSupported
 @ResultTable NVARCHAR(MAX),
 @ColumnList NVARCHAR(MAX)
AS
BEGIN
    BEGIN TRY
      EXEC('DECLARE @EatResult INT; SELECT @EatResult = COUNT(1) FROM ' + @ResultTable + ' GROUP BY ' + @ColumnList + ';');
    END TRY
    BEGIN CATCH
      RAISERROR('The table contains a datatype that is not supported for tSQLt.AssertEqualsTable. Please refer to http://tsqlt.org/user-guide/assertions/assertequalstable/ for a list of unsupported datatypes.',16,10);
    END CATCH
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_CompareTablesFailIfUnequalRowsExists
 @UnequalRowsExist INT,
 @ResultTable NVARCHAR(MAX),
 @ResultColumn NVARCHAR(MAX),
 @ColumnList NVARCHAR(MAX),
 @FailMsg NVARCHAR(MAX)
AS
BEGIN
  IF @UnequalRowsExist > 0
  BEGIN
   DECLARE @TableToTextResult NVARCHAR(MAX);
   DECLARE @OutputColumnList NVARCHAR(MAX);
   SELECT @OutputColumnList = '[_m_],' + @ColumnList;
   EXEC tSQLt.TableToText @TableName = @ResultTable, @OrderBy = @ResultColumn, @PrintOnlyColumnNameAliasList = @OutputColumnList, @txt = @TableToTextResult OUTPUT;
   
   DECLARE @Message NVARCHAR(MAX);
   SELECT @Message = @FailMsg + CHAR(13) + CHAR(10);

    EXEC tSQLt.Fail @Message, @TableToTextResult;
  END;
END
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_CompareTables
    @Expected NVARCHAR(MAX),
    @Actual NVARCHAR(MAX),
    @ResultTable NVARCHAR(MAX),
    @ColumnList NVARCHAR(MAX),
    @MatchIndicatorColumnName NVARCHAR(MAX)
AS
BEGIN
    DECLARE @cmd NVARCHAR(MAX);
    DECLARE @RestoredRowIndexCounterColName NVARCHAR(MAX);
    SET @RestoredRowIndexCounterColName = @MatchIndicatorColumnName + '_RR';
    
    SELECT @cmd = 
    '
    INSERT INTO ' + @ResultTable + ' (' + @MatchIndicatorColumnName + ', ' + @ColumnList + ') 
    SELECT 
      CASE 
        WHEN RestoredRowIndex.'+@RestoredRowIndexCounterColName+' <= CASE WHEN [_{Left}_]<[_{Right}_] THEN [_{Left}_] ELSE [_{Right}_] END
         THEN ''='' 
        WHEN RestoredRowIndex.'+@RestoredRowIndexCounterColName+' <= [_{Left}_] 
         THEN ''<'' 
        ELSE ''>'' 
      END AS ' + @MatchIndicatorColumnName + ', ' + @ColumnList + '
    FROM(
      SELECT SUM([_{Left}_]) AS [_{Left}_], 
             SUM([_{Right}_]) AS [_{Right}_], 
             ' + @ColumnList + ' 
      FROM (
        SELECT 1 AS [_{Left}_], 0[_{Right}_], ' + @ColumnList + '
          FROM ' + @Expected + '
        UNION ALL 
        SELECT 0[_{Left}_], 1 AS [_{Right}_], ' + @ColumnList + ' 
          FROM ' + @Actual + '
      ) AS X 
      GROUP BY ' + @ColumnList + ' 
    ) AS CollapsedRows
    CROSS APPLY (
       SELECT TOP(CASE WHEN [_{Left}_]>[_{Right}_] THEN [_{Left}_] 
                       ELSE [_{Right}_] END) 
              ROW_NUMBER() OVER(ORDER BY(SELECT 1)) 
         FROM (SELECT 1 
                 FROM ' + @Actual + ' UNION ALL SELECT 1 FROM ' + @Expected + ') X(X)
              ) AS RestoredRowIndex(' + @RestoredRowIndexCounterColName + ');';
    
    EXEC (@cmd); --MainGroupQuery
    
    SET @cmd = 'SET @r = 
         CASE WHEN EXISTS(
                  SELECT 1 
                    FROM ' + @ResultTable + 
                 ' WHERE ' + @MatchIndicatorColumnName + ' IN (''<'', ''>'')) 
              THEN 1 ELSE 0 
         END';
    DECLARE @UnequalRowsExist INT;
    EXEC sp_executesql @cmd, N'@r INT OUTPUT',@UnequalRowsExist OUTPUT;
    
    RETURN @UnequalRowsExist;
END;


GO

CREATE PROCEDURE tSQLt.AssertObjectExists
    @ObjectName NVARCHAR(MAX),
    @Message NVARCHAR(MAX) = ''
AS
BEGIN
    DECLARE @Msg NVARCHAR(MAX);
    IF(@ObjectName LIKE '#%')
    BEGIN
     IF OBJECT_ID('tempdb..'+@ObjectName) IS NULL
     BEGIN
         SELECT @Msg = '''' + COALESCE(@ObjectName, 'NULL') + ''' does not exist';
         EXEC tSQLt.Fail @Message, @Msg;
         RETURN 1;
     END;
    END
    ELSE
    BEGIN
     IF OBJECT_ID(@ObjectName) IS NULL
     BEGIN
         SELECT @Msg = '''' + COALESCE(@ObjectName, 'NULL') + ''' does not exist';
         EXEC tSQLt.Fail @Message, @Msg;
         RETURN 1;
     END;
    END;
    RETURN 0;
END;


GO

CREATE PROCEDURE tSQLt.AssertObjectDoesNotExist
    @ObjectName NVARCHAR(MAX),
    @Message NVARCHAR(MAX) = ''
AS
BEGIN
     DECLARE @Msg NVARCHAR(MAX);
     IF OBJECT_ID(@ObjectName) IS NOT NULL
     OR(@ObjectName LIKE '#%' AND OBJECT_ID('tempdb..'+@ObjectName) IS NOT NULL)
     BEGIN
         SELECT @Msg = '''' + @ObjectName + ''' does exist!';
         EXEC tSQLt.Fail @Message,@Msg;
     END;
END;


GO

GO
CREATE PROCEDURE tSQLt.AssertEqualsString
    @Expected NVARCHAR(MAX),
    @Actual NVARCHAR(MAX),
    @Message NVARCHAR(MAX) = ''
AS
BEGIN
    IF ((@Expected = @Actual) OR (@Actual IS NULL AND @Expected IS NULL))
      RETURN 0;

    DECLARE @Msg NVARCHAR(MAX);
    SELECT @Msg = CHAR(13)+CHAR(10)+
                  'Expected: ' + ISNULL('<'+@Expected+'>', 'NULL') +
                  CHAR(13)+CHAR(10)+
                  'but was : ' + ISNULL('<'+@Actual+'>', 'NULL');
    EXEC tSQLt.Fail @Message, @Msg;
END;
GO


GO

CREATE PROCEDURE tSQLt.AssertEqualsTable
    @Expected NVARCHAR(MAX),
    @Actual NVARCHAR(MAX),
    @Message NVARCHAR(MAX) = NULL,
    @FailMsg NVARCHAR(MAX) = 'Unexpected/missing resultset rows!'
AS
BEGIN

    EXEC tSQLt.AssertObjectExists @Expected;
    EXEC tSQLt.AssertObjectExists @Actual;

    DECLARE @ResultTable NVARCHAR(MAX);    
    DECLARE @ResultTableWithSchema NVARCHAR(MAX);    
    DECLARE @ResultColumn NVARCHAR(MAX);    
    DECLARE @ColumnList NVARCHAR(MAX);    
    DECLARE @UnequalRowsExist INT;
    DECLARE @CombinedMessage NVARCHAR(MAX);

    SELECT @ResultTable = tSQLt.Private::CreateUniqueObjectName();
    SELECT @ResultColumn = 'RC_' + @ResultTable;
    SELECT @ResultTableWithSchema = 'tSQLt.' + @ResultTable; 

    EXEC tSQLt.Private_CreateResultTableForCompareTables 
      @ResultTable = @ResultTableWithSchema,
      @ResultColumn = @ResultColumn,
      @BaseTable = @Expected;
        
    SELECT @ColumnList = tSQLt.Private_GetCommaSeparatedColumnList(@ResultTableWithSchema, @ResultColumn);

    EXEC tSQLt.Private_ValidateThatAllDataTypesInTableAreSupported @ResultTableWithSchema, @ColumnList;    
    
    EXEC @UnequalRowsExist = tSQLt.Private_CompareTables 
      @Expected = @Expected,
      @Actual = @Actual,
      @ResultTable = @ResultTableWithSchema,
      @ColumnList = @ColumnList,
      @MatchIndicatorColumnName = @ResultColumn;
        
    SET @CombinedMessage = ISNULL(@Message + CHAR(13) + CHAR(10),'') + @FailMsg;
    EXEC tSQLt.Private_CompareTablesFailIfUnequalRowsExists 
      @UnequalRowsExist = @UnequalRowsExist,
      @ResultTable = @ResultTableWithSchema,
      @ResultColumn = @ResultColumn,
      @ColumnList = @ColumnList,
      @FailMsg = @CombinedMessage;   
END;


GO

GO
CREATE PROCEDURE tSQLt.StubRecord(@SnTableName AS NVARCHAR(MAX), @BintObjId AS BIGINT)  
AS   
BEGIN  

    RAISERROR('Warning, tSQLt.StubRecord is not currently supported. Use at your own risk!', 0, 1) WITH NOWAIT;

    DECLARE @VcInsertStmt NVARCHAR(MAX),  
            @VcInsertValues NVARCHAR(MAX);  
    DECLARE @SnColumnName NVARCHAR(MAX); 
    DECLARE @SintDataType SMALLINT; 
    DECLARE @NvcFKCmd NVARCHAR(MAX);  
    DECLARE @VcFKVal NVARCHAR(MAX); 
  
    SET @VcInsertStmt = 'INSERT INTO ' + @SnTableName + ' ('  
      
    DECLARE curColumns CURSOR  
        LOCAL FAST_FORWARD  
    FOR  
    SELECT syscolumns.name,  
           syscolumns.xtype,  
           cmd.cmd  
    FROM syscolumns  
        LEFT OUTER JOIN dbo.sysconstraints ON syscolumns.id = sysconstraints.id  
                                      AND syscolumns.colid = sysconstraints.colid  
                                      AND sysconstraints.status = 1    -- Primary key constraints only  
        LEFT OUTER JOIN (select fkeyid id,fkey colid,N'select @V=cast(min('+syscolumns.name+') as NVARCHAR) from '+sysobjects.name cmd  
                        from sysforeignkeys   
                        join sysobjects on sysobjects.id=sysforeignkeys.rkeyid  
                        join syscolumns on sysobjects.id=syscolumns.id and syscolumns.colid=rkey) cmd  
            on cmd.id=syscolumns.id and cmd.colid=syscolumns.colid  
    WHERE syscolumns.id = OBJECT_ID(@SnTableName)  
      AND (syscolumns.isnullable = 0 )  
    ORDER BY ISNULL(sysconstraints.status, 9999), -- Order Primary Key constraints first  
             syscolumns.colorder  
  
    OPEN curColumns  
  
    FETCH NEXT FROM curColumns  
    INTO @SnColumnName, @SintDataType, @NvcFKCmd  
  
    -- Treat the first column retrieved differently, no commas need to be added  
    -- and it is the ObjId column  
    IF @@FETCH_STATUS = 0  
    BEGIN  
        SET @VcInsertStmt = @VcInsertStmt + @SnColumnName  
        SELECT @VcInsertValues = ')VALUES(' + ISNULL(CAST(@BintObjId AS nvarchar), 'NULL')  
  
        FETCH NEXT FROM curColumns  
        INTO @SnColumnName, @SintDataType, @NvcFKCmd  
    END  
    ELSE  
    BEGIN  
        -- No columns retrieved, we need to insert into any first column  
        SELECT @VcInsertStmt = @VcInsertStmt + syscolumns.name  
        FROM syscolumns  
        WHERE syscolumns.id = OBJECT_ID(@SnTableName)  
          AND syscolumns.colorder = 1  
  
        SELECT @VcInsertValues = ')VALUES(' + ISNULL(CAST(@BintObjId AS nvarchar), 'NULL')  
  
    END  
  
    WHILE @@FETCH_STATUS = 0  
    BEGIN  
        SET @VcInsertStmt = @VcInsertStmt + ',' + @SnColumnName  
        SET @VcFKVal=',0'  
        if @NvcFKCmd is not null  
        BEGIN  
            set @VcFKVal=null  
            exec sp_executesql @NvcFKCmd,N'@V NVARCHAR(MAX) output',@VcFKVal output  
            set @VcFKVal=isnull(','''+@VcFKVal+'''',',NULL')  
        END  
        SET @VcInsertValues = @VcInsertValues + @VcFKVal  
  
        FETCH NEXT FROM curColumns  
        INTO @SnColumnName, @SintDataType, @NvcFKCmd  
    END  
      
    CLOSE curColumns  
    DEALLOCATE curColumns  
  
    SET @VcInsertStmt = @VcInsertStmt + @VcInsertValues + ')'  
  
    IF EXISTS (SELECT 1   
               FROM syscolumns  
               WHERE status = 128   
                 AND id = OBJECT_ID(@SnTableName))  
    BEGIN  
        SET @VcInsertStmt = 'SET IDENTITY_INSERT ' + @SnTableName + ' ON ' + CHAR(10) +   
                             @VcInsertStmt + CHAR(10) +   
                             'SET IDENTITY_INSERT ' + @SnTableName + ' OFF '  
    END  
  
    EXEC (@VcInsertStmt)    -- Execute the actual INSERT statement  
  
END  

GO


GO

GO
CREATE PROCEDURE [tSQLt].[AssertLike] 
  @ExpectedPattern NVARCHAR(MAX),
  @Actual NVARCHAR(MAX),
  @Message NVARCHAR(MAX) = ''
AS
BEGIN
  IF (LEN(@ExpectedPattern) > 4000)
  BEGIN
    RAISERROR ('@ExpectedPattern may not exceed 4000 characters.', 16, 10);
  END;

  IF ((@Actual LIKE @ExpectedPattern) OR (@Actual IS NULL AND @ExpectedPattern IS NULL))
  BEGIN
    RETURN 0;
  END

  DECLARE @Msg NVARCHAR(MAX);
  SELECT @Msg = CHAR(13) + CHAR(10) + 'Expected: <' + ISNULL(@ExpectedPattern, 'NULL') + '>' +
                CHAR(13) + CHAR(10) + ' but was: <' + ISNULL(@Actual, 'NULL') + '>';
  EXEC tSQLt.Fail @Message, @Msg;
END;
GO


GO

CREATE PROCEDURE tSQLt.AssertNotEquals
    @Expected SQL_VARIANT,
    @Actual SQL_VARIANT,
    @Message NVARCHAR(MAX) = ''
AS
BEGIN
  IF (@Expected = @Actual)
  OR (@Expected IS NULL AND @Actual IS NULL)
  BEGIN
    DECLARE @Msg NVARCHAR(MAX);
    SET @Msg = 'Expected actual value to not ' + 
               COALESCE('equal <' + tSQLt.Private_SqlVariantFormatter(@Expected)+'>', 'be NULL') + 
               '.';
    EXEC tSQLt.Fail @Message,@Msg;
  END;
  RETURN 0;
END;


GO

CREATE FUNCTION tSQLt.Private_SqlVariantFormatter(@Value SQL_VARIANT)
RETURNS NVARCHAR(MAX)
AS
BEGIN
  RETURN CASE UPPER(CAST(SQL_VARIANT_PROPERTY(@Value,'BaseType')AS sysname))
           WHEN 'FLOAT' THEN CONVERT(NVARCHAR(MAX),@Value,2)
           WHEN 'REAL' THEN CONVERT(NVARCHAR(MAX),@Value,1)
           WHEN 'MONEY' THEN CONVERT(NVARCHAR(MAX),@Value,2)
           WHEN 'SMALLMONEY' THEN CONVERT(NVARCHAR(MAX),@Value,2)
           WHEN 'DATE' THEN CONVERT(NVARCHAR(MAX),@Value,126)
           WHEN 'DATETIME' THEN CONVERT(NVARCHAR(MAX),@Value,126)
           WHEN 'DATETIME2' THEN CONVERT(NVARCHAR(MAX),@Value,126)
           WHEN 'DATETIMEOFFSET' THEN CONVERT(NVARCHAR(MAX),@Value,126)
           WHEN 'SMALLDATETIME' THEN CONVERT(NVARCHAR(MAX),@Value,126)
           WHEN 'TIME' THEN CONVERT(NVARCHAR(MAX),@Value,126)
           WHEN 'BINARY' THEN CONVERT(NVARCHAR(MAX),@Value,1)
           WHEN 'VARBINARY' THEN CONVERT(NVARCHAR(MAX),@Value,1)
           ELSE CAST(@Value AS NVARCHAR(MAX))
         END;
END


GO

CREATE PROCEDURE tSQLt.AssertEmptyTable
  @TableName NVARCHAR(MAX),
  @Message NVARCHAR(MAX) = ''
AS
BEGIN
  EXEC tSQLt.AssertObjectExists @TableName;

  DECLARE @FullName NVARCHAR(MAX);
  IF(OBJECT_ID(@TableName) IS NULL AND OBJECT_ID('tempdb..'+@TableName) IS NOT NULL)
  BEGIN
    SET @FullName = CASE WHEN LEFT(@TableName,1) = '[' THEN @TableName ELSE QUOTENAME(@TableName)END;
  END;
  ELSE
  BEGIN
    SET @FullName = tSQLt.Private_GetQuotedFullName(OBJECT_ID(@TableName));
  END;

  DECLARE @cmd NVARCHAR(MAX);
  DECLARE @exists INT;
  SET @cmd = 'SELECT @exists = CASE WHEN EXISTS(SELECT 1 FROM '+@FullName+') THEN 1 ELSE 0 END;'
  EXEC sp_executesql @cmd,N'@exists INT OUTPUT', @exists OUTPUT;
  
  IF(@exists = 1)
  BEGIN
    DECLARE @TableToText NVARCHAR(MAX);
    EXEC tSQLt.TableToText @TableName = @FullName,@txt = @TableToText OUTPUT;
    DECLARE @Msg NVARCHAR(MAX);
    SET @Msg = @FullName + ' was not empty:' + CHAR(13) + CHAR(10)+ @TableToText;
    EXEC tSQLt.Fail @Message,@Msg;
  END
END


GO

CREATE PROCEDURE tSQLt.ApplyTrigger
  @TableName NVARCHAR(MAX),
  @TriggerName NVARCHAR(MAX)
AS
BEGIN
  DECLARE @OrgTableObjectId INT;
  DECLARE @NewNameOfOriginalTrigger NVARCHAR(MAX);

  SELECT @OrgTableObjectId = OrgTableObjectId FROM tSQLt.Private_GetOriginalTableInfo(OBJECT_ID(@TableName)) orgTbl
  IF(@OrgTableObjectId IS NULL)
  BEGIN
    RAISERROR('%s does not exist or was not faked by tSQLt.FakeTable.', 16, 10, @TableName);
  END;
  
  DECLARE @FullTriggerName NVARCHAR(MAX);
  DECLARE @TriggerObjectId INT;
  SELECT @FullTriggerName = QUOTENAME(SCHEMA_NAME(schema_id))+'.'+QUOTENAME(name), @TriggerObjectId = object_id
  FROM sys.objects WHERE PARSENAME(@TriggerName,1) = name AND parent_object_id = @OrgTableObjectId;
  
  DECLARE @TriggerCode NVARCHAR(MAX);
  SELECT @TriggerCode = m.definition
    FROM sys.sql_modules m
   WHERE m.object_id = @TriggerObjectId;
  
  IF (@TriggerCode IS NULL)
  BEGIN
    RAISERROR('%s is not a trigger on %s', 16, 10, @TriggerName, @TableName);
  END;
 
  EXEC tSQLt.RemoveObject @ObjectName = @FullTriggerName, @NewName = @NewNameOfOriginalTrigger OUTPUT;
  
  EXEC(@TriggerCode);

  EXEC tSQLt.Private_MarktSQLtTempObject @ObjectName = @FullTriggerName, @ObjectType = N'TRIGGER', @NewNameOfOriginalObject = @NewNameOfOriginalTrigger;
END;


GO

GO
CREATE FUNCTION tSQLt.Private_CreateFakeFunctionStatement(
  @FunctionObjectId INT,
  @ReturnValue NVARCHAR(MAX)
)
RETURNS TABLE
AS
RETURN
  SELECT 
      'CREATE FUNCTION ' + QUOTENAME(OBJECT_SCHEMA_NAME(@FunctionObjectId)) + '.' + QUOTENAME(OBJECT_NAME(@FunctionObjectId)) + 
      '(' +
      ISNULL(PAS.ParametersAndReturnScalar, '') + 
      ISNULL(') RETURNS TABLE AS RETURN ' + T.TypeOnlySelectStatement,'') + ';' CreateStatement,
      T.TypeOnlySelectStatement
    FROM
    (
      SELECT 
          (
            SELECT 
              CASE P.is_output 
              WHEN 0 THEN CASE WHEN P._RN_ = 1 THEN '' ELSE ',' END +P.name+' '+T.TypeName
              WHEN 1 THEN ') RETURNS '+T.TypeName+' AS BEGIN RETURN CAST('+ISNULL(''''+@ReturnValue+'''','NULL')+' AS '+T.TypeName+'); END'
              END
              FROM 
              (
                SELECT
                    ROW_NUMBER()OVER(ORDER BY PP.is_output ASC,PP.parameter_id ASC) _RN_,
                    PP.*
                  FROM
                  (
                    SELECT  
                        object_id,
                        name,
                        parameter_id,
                        system_type_id,
                        user_type_id,
                        max_length,
                        precision,
                        scale,
                        is_output
                      FROM sys.parameters
                  ) AS PP
                 WHERE PP.object_id = @FunctionObjectId
              )AS P
             CROSS APPLY tSQLt.Private_GetFullTypeName(P.user_type_id,P.max_length,P.precision,P.scale,NULL) AS T
             ORDER BY P._RN_
               FOR XML PATH(''),TYPE
          ).value('.','NVARCHAR(MAX)') ParametersAndReturnScalar
    )PAS
    CROSS JOIN
    (
      SELECT 
          (
            SELECT 
              CASE WHEN P.column_id = 1 
                THEN 'SELECT TOP(0) ' 
                ELSE ',' 
              END + 
              'CAST(NULL AS '+T.TypeName+') AS '+QUOTENAME(P.name)
              FROM 
              (
                SELECT
                    ROW_NUMBER()OVER(ORDER BY PP.column_id ASC) _RN_,
                    PP.*
                  FROM
                  (
                    SELECT  
                        object_id,
                        name,
                        column_id,
                        system_type_id,
                        user_type_id,
                        max_length,
                        precision,
                        scale
                      FROM sys.columns
                  ) AS PP
                 WHERE PP.object_id = @FunctionObjectId
              )AS P
             CROSS APPLY tSQLt.Private_GetFullTypeName(P.user_type_id,P.max_length,P.precision,P.scale,NULL) AS T
             ORDER BY P._RN_
               FOR XML PATH(''),TYPE
          ).value('.','NVARCHAR(MAX)') TypeOnlySelectStatement
    )T
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_ValidateObjectsCompatibleWithFakeFunction
  @FunctionName         NVARCHAR(MAX),
  @FakeFunctionName     NVARCHAR(MAX) = NULL,
  @FakeDataSource       NVARCHAR(MAX) = NULL,
  @FunctionObjectId     INT = NULL OUTPUT,
  @FakeFunctionObjectId INT = NULL OUTPUT,
  @IsScalarFunction     BIT = NULL OUTPUT
AS
BEGIN
  SET @FunctionObjectId = OBJECT_ID(@FunctionName);

  IF(@FunctionObjectId IS NULL)
  BEGIN
    RAISERROR('%s does not exist!',16,10,@FunctionName);
  END;

   IF COALESCE(@FakeFunctionName, @FakeDataSource) IS NULL
   BEGIN
      RAISERROR ('Either @FakeFunctionName or @FakeDataSource must be provided', 16, 10);
   END;

   IF (@FakeFunctionName  IS NOT NULL  AND @FakeDataSource IS NOT NULL )
   BEGIN
      RAISERROR ('Both @FakeFunctionName and @FakeDataSource are valued. Please use only one.', 16, 10);
   END;

   IF (@FakeDataSource IS NOT NULL ) 
   BEGIN
      IF NOT EXISTS (
         SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(@FunctionName) and type in ('TF', 'IF', 'FT')
      ) 
      BEGIN
         RAISERROR('You can use @FakeDataSource only with Inline, Multi-Statement or CLR Table-Valued functions.', 16, 10);
      END
    
   RETURN 0;
   END

  SET @FakeFunctionObjectId = OBJECT_ID(@FakeFunctionName);
  IF(@FakeFunctionObjectId IS NULL)
  BEGIN
    RAISERROR('%s does not exist!',16,10,@FakeFunctionName);
  END;
  
  DECLARE @FunctionType CHAR(2);
  DECLARE @FakeFunctionType CHAR(2);
  SELECT @FunctionType = type FROM sys.objects WHERE object_id = @FunctionObjectId;
  SELECT @FakeFunctionType = type FROM sys.objects WHERE object_id = @FakeFunctionObjectId;

  IF((@FunctionType IN('FN','FS') AND @FakeFunctionType NOT IN('FN','FS'))
     OR
     (@FunctionType IN('TF','IF','FT') AND @FakeFunctionType NOT IN('TF','IF','FT'))
     OR
     (@FunctionType NOT IN('FN','FS','TF','IF','FT'))
     )    
  BEGIN
    RAISERROR('Both parameters must contain the name of either scalar or table valued functions!',16,10);
  END;
  
  SET @IsScalarFunction = CASE WHEN @FunctionType IN('FN','FS') THEN 1 ELSE 0 END;
  
  IF(EXISTS(SELECT 1 
              FROM sys.parameters AS P
             WHERE P.object_id IN(@FunctionObjectId,@FakeFunctionObjectId)
             GROUP BY P.name, P.max_length, P.precision, P.scale, P.parameter_id
            HAVING COUNT(1) <> 2
           ))
  BEGIN
    RAISERROR('Parameters of both functions must match! (This includes the return type for scalar functions.)',16,10);
  END; 
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_CreateFakeFunction
  @FunctionName         NVARCHAR(MAX),
  @FakeFunctionName     NVARCHAR(MAX) = NULL,
  @FunctionObjectId     INT = NULL,
  @FakeFunctionObjectId INT = NULL,
  @IsScalarFunction     BIT = NULL,
  @FakeDataSource       NVARCHAR(MAX) = NULL 
AS
BEGIN
  DECLARE @ReturnType NVARCHAR(MAX);
  SELECT @ReturnType = T.TypeName
    FROM sys.parameters AS P
   CROSS APPLY tSQLt.Private_GetFullTypeName(P.user_type_id,P.max_length,P.precision,P.scale,NULL) AS T
   WHERE P.object_id = @FunctionObjectId
     AND P.parameter_id = 0;
     
  DECLARE @ParameterList NVARCHAR(MAX);
  SELECT @ParameterList = COALESCE(
     STUFF((SELECT ','+P.name+' '+T.TypeName+CASE WHEN T.IsTableType = 1 THEN ' READONLY' ELSE '' END
              FROM sys.parameters AS P
             CROSS APPLY tSQLt.Private_GetFullTypeName(P.user_type_id,P.max_length,P.precision,P.scale,NULL) AS T
             WHERE P.object_id = @FunctionObjectId
               AND P.parameter_id > 0
             ORDER BY P.parameter_id
               FOR XML PATH(''),TYPE
           ).value('.','NVARCHAR(MAX)'),1,1,''),'');
           
  DECLARE @ParameterCallList NVARCHAR(MAX);
  SELECT @ParameterCallList = COALESCE(
     STUFF((SELECT ','+P.name
              FROM sys.parameters AS P
             CROSS APPLY tSQLt.Private_GetFullTypeName(P.user_type_id,P.max_length,P.precision,P.scale,NULL) AS T
             WHERE P.object_id = @FunctionObjectId
               AND P.parameter_id > 0
             ORDER BY P.parameter_id
               FOR XML PATH(''),TYPE
           ).value('.','NVARCHAR(MAX)'),1,1,''),'');


  IF(@IsScalarFunction = 1)
  BEGIN
    EXEC('CREATE FUNCTION '+@FunctionName+'('+@ParameterList+') RETURNS '+@ReturnType+' AS BEGIN RETURN '+@FakeFunctionName+'('+@ParameterCallList+');END;'); 
  END
  ELSE 
  BEGIN
    DECLARE @cmd NVARCHAR(MAX);
    IF (@FakeDataSource IS NOT NULL)
    BEGIN
       SET @cmd = 
        CASE 
          WHEN OBJECT_ID(@FakeDataSource) IS NOT NULL THEN 'SELECT * FROM '+@FakeDataSource
          WHEN @FakeDataSource LIKE '(%)%(%)' THEN 'SELECT * FROM '+@FakeDataSource
          ELSE @FakeDataSource
        END;
    END
    ELSE
    BEGIN
      SET @cmd = 'SELECT * FROM '+@FakeFunctionName+'('+@ParameterCallList+')'; 
    END;
    SET @cmd = 'CREATE FUNCTION '+@FunctionName+'('+@ParameterList+') RETURNS TABLE AS RETURN '+@cmd+';'
    EXEC(@cmd);
  END;
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.FakeFunction
  @FunctionName     NVARCHAR(MAX),
  @FakeFunctionName NVARCHAR(MAX) = NULL,
  @FakeDataSource   NVARCHAR(MAX) = NULL

AS
BEGIN
  DECLARE @FunctionObjectId INT;
  DECLARE @FakeFunctionObjectId INT;
  DECLARE @IsScalarFunction BIT;
  DECLARE @NewNameOfOriginalFunction NVARCHAR(MAX);

  EXEC tSQLt.Private_ValidateObjectsCompatibleWithFakeFunction 
               @FunctionName = @FunctionName,
               @FakeFunctionName = @FakeFunctionName,
               @FakeDataSource   = @FakeDataSource,
               @FunctionObjectId = @FunctionObjectId OUT,
               @FakeFunctionObjectId = @FakeFunctionObjectId OUT,
               @IsScalarFunction = @IsScalarFunction OUT;

  EXEC tSQLt.RemoveObject
               @ObjectName = @FunctionName,
               @NewName = @NewNameOfOriginalFunction OUTPUT;

  EXEC tSQLt.Private_CreateFakeFunction 
               @FunctionName = @FunctionName,
               @FakeFunctionName = @FakeFunctionName,
               @FakeDataSource   = @FakeDataSource,
               @FunctionObjectId = @FunctionObjectId,
               @FakeFunctionObjectId = @FakeFunctionObjectId,
               @IsScalarFunction = @IsScalarFunction;

  EXEC tSQLt.Private_MarktSQLtTempObject
               @ObjectName = @FunctionName,
               @ObjectType = N'FUNCTION',
               @NewNameOfOriginalObject = @NewNameOfOriginalFunction;

END;
GO


GO

CREATE PROCEDURE tSQLt.RenameClass
   @SchemaName NVARCHAR(MAX),
   @NewSchemaName NVARCHAR(MAX)
AS
BEGIN
  DECLARE @MigrateObjectsCommand NVARCHAR(MAX);

  SELECT @NewSchemaName = PARSENAME(@NewSchemaName, 1),
         @SchemaName = PARSENAME(@SchemaName, 1);

  EXEC tSQLt.NewTestClass @NewSchemaName;

  SELECT @MigrateObjectsCommand = (
    SELECT Cmd AS [text()] FROM (
    SELECT 'ALTER SCHEMA ' + QUOTENAME(@NewSchemaName) + ' TRANSFER ' + QUOTENAME(@SchemaName) + '.' + QUOTENAME(name) + ';' AS Cmd
      FROM sys.objects
     WHERE schema_id = SCHEMA_ID(@SchemaName)
       AND type NOT IN ('PK', 'F')
    UNION ALL 
    SELECT 'ALTER SCHEMA ' + QUOTENAME(@NewSchemaName) + ' TRANSFER XML SCHEMA COLLECTION::' + QUOTENAME(@SchemaName) + '.' + QUOTENAME(name) + ';' AS Cmd
      FROM sys.xml_schema_collections
     WHERE schema_id = SCHEMA_ID(@SchemaName)
    UNION ALL 
    SELECT 'ALTER SCHEMA ' + QUOTENAME(@NewSchemaName) + ' TRANSFER TYPE::' + QUOTENAME(@SchemaName) + '.' + QUOTENAME(name) + ';' AS Cmd
      FROM sys.types
     WHERE schema_id = SCHEMA_ID(@SchemaName)
    ) AS Cmds
       FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)');

  EXEC (@MigrateObjectsCommand);

  EXEC tSQLt.DropClass @SchemaName;
END;


GO

GO
CREATE PROCEDURE tSQLt.AssertEqualsTableSchema
    @Expected NVARCHAR(MAX),
    @Actual NVARCHAR(MAX),
    @Message NVARCHAR(MAX) = NULL
AS
BEGIN
  SELECT 
      RANK()OVER(ORDER BY C.column_id) [RANK(column_id)],
      C.name,
      CAST(C.system_type_id AS NVARCHAR(MAX))+QUOTENAME(TS.name) system_type_id,
      CAST(C.user_type_id AS NVARCHAR(MAX))+CASE WHEN TU.system_type_id<> TU.user_type_id THEN QUOTENAME(SCHEMA_NAME(TU.schema_id))+'.' ELSE '' END + QUOTENAME(TU.name) user_type_id,
      C.max_length,
      C.precision,
      C.scale,
      C.collation_name,
      C.is_nullable
    INTO #Expected
    FROM sys.columns AS C
    JOIN sys.types AS TS
      ON C.system_type_id = TS.user_type_id
    JOIN sys.types AS TU
      ON C.user_type_id = TU.user_type_id
   WHERE C.object_id = OBJECT_ID(@Expected);
  SELECT 
      RANK()OVER(ORDER BY C.column_id) [RANK(column_id)],
      C.name,
      CAST(C.system_type_id AS NVARCHAR(MAX))+QUOTENAME(TS.name) system_type_id,
      CAST(C.user_type_id AS NVARCHAR(MAX))+CASE WHEN TU.system_type_id<> TU.user_type_id THEN QUOTENAME(SCHEMA_NAME(TU.schema_id))+'.' ELSE '' END + QUOTENAME(TU.name) user_type_id,
      C.max_length,
      C.precision,
      C.scale,
      C.collation_name,
      C.is_nullable
    INTO #Actual
    FROM sys.columns AS C
    JOIN sys.types AS TS
      ON C.system_type_id = TS.user_type_id
    JOIN sys.types AS TU
      ON C.user_type_id = TU.user_type_id
   WHERE C.object_id = OBJECT_ID(@Actual);
  
  EXEC tSQLt.AssertEqualsTable '#Expected','#Actual',@Message=@Message,@FailMsg='Unexpected/missing column(s)';  
END;
GO


GO

GO
IF NOT(CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(MAX)) LIKE '9.%')
BEGIN
  EXEC('CREATE TYPE tSQLt.AssertStringTable AS TABLE(value NVARCHAR(MAX));');
END;
GO


GO

GO
IF NOT(CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(MAX)) LIKE '9.%')
BEGIN
EXEC('
CREATE PROCEDURE tSQLt.AssertStringIn
  @Expected tSQLt.AssertStringTable READONLY,
  @Actual NVARCHAR(MAX),
  @Message NVARCHAR(MAX) = ''''
AS
BEGIN
  IF(NOT EXISTS(SELECT 1 FROM @Expected WHERE value = @Actual))
  BEGIN
    DECLARE @ExpectedMessage NVARCHAR(MAX);
    SELECT value INTO #ExpectedSet FROM @Expected;
    EXEC tSQLt.TableToText @TableName = ''#ExpectedSet'', @OrderBy = ''value'',@txt = @ExpectedMessage OUTPUT;
    SET @ExpectedMessage = ISNULL(''<''+@Actual+''>'',''NULL'')+CHAR(13)+CHAR(10)+''is not in''+CHAR(13)+CHAR(10)+@ExpectedMessage;
    EXEC tSQLt.Fail @Message, @ExpectedMessage;
  END;
END;
');
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.SetSummaryError
  @SummaryError INT
AS
BEGIN
  IF(@SummaryError NOT IN (0,1))
  BEGIN
    RAISERROR('@SummaryError has to be 0 or 1, but it was: %i',16,10,@SummaryError);
  END;
  EXEC tSQLt.Private_SetConfiguration @Name = 'SummaryError', @Value = @SummaryError;
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.Reset
AS
BEGIN
  EXEC tSQLt.Private_ResetNewTestClassList;
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_SkipTestAnnotationHelper
  @SkipReason NVARCHAR(MAX)
AS
BEGIN
  INSERT INTO #SkipTest VALUES(@SkipReason);
END;
GO


GO

GO
CREATE FUNCTION tSQLt.[@tSQLt:SkipTest](@SkipReason NVARCHAR(MAX))
RETURNS TABLE
AS
RETURN
  SELECT 'EXEC tSQLt.Private_SkipTestAnnotationHelper @SkipReason = '''+
         ISNULL(NULLIF(REPLACE(@SkipReason,'''',''''''),''),'<no reason provided>')+
         ''';' AS AnnotationCmd;
GO


GO

GO
CREATE FUNCTION tSQLt.[@tSQLt:MinSqlMajorVersion](@MinVersion INT)
RETURNS TABLE
AS
RETURN
  SELECT AF.*
    FROM
    (
      SELECT PSSV.Major
        FROM tSQLt.Private_SqlVersion() AS PSV
       CROSS APPLY tSQLt.Private_SplitSqlVersion(PSV.ProductVersion) AS PSSV
    ) AV
   CROSS APPLY tSQLt.[@tSQLt:SkipTest]('Minimum required version is '+
                                       CAST(@MinVersion AS NVARCHAR(MAX))+
                                       ', but current version is '+
                                       CAST(AV.Major AS NVARCHAR(MAX))+'.'
                                      ) AS AF
   WHERE @MinVersion > AV.Major
GO


GO

GO
CREATE FUNCTION tSQLt.[@tSQLt:MaxSqlMajorVersion](@MaxVersion INT)
RETURNS TABLE
AS
RETURN
  SELECT AF.*
    FROM (SELECT PSSV.Major FROM tSQLt.Private_SqlVersion() AS PSV CROSS APPLY tSQLt.Private_SplitSqlVersion(PSV.ProductVersion) AS PSSV) AV
   CROSS APPLY tSQLt.[@tSQLt:SkipTest]('Maximum allowed version is '+
                                       CAST(@MaxVersion AS NVARCHAR(MAX))+
                                       ', but current version is '+
                                       CAST(AV.Major AS NVARCHAR(MAX))+'.'
                                      ) AS AF
   WHERE @MaxVersion < AV.Major
GO


GO

GO
CREATE FUNCTION tSQLt.[@tSQLt:RunOnlyOnHostPlatform](@HostPlatform NVARCHAR(MAX))
RETURNS TABLE
AS
RETURN
  SELECT SkipTestFunction.*
    FROM (SELECT I.HostPlatform FROM tSQLt.Info() AS I WHERE I.HostPlatform <> @HostPlatform) AV
   CROSS APPLY tSQLt.[@tSQLt:SkipTest]('HostPlatform is required to be '''+
                                       @HostPlatform +
                                       ''', but is '''+
                                       AV.HostPlatform +
                                       '''.'
                                      ) AS SkipTestFunction;
GO


GO

GO
CREATE FUNCTION tSQLt.[@tSQLt:NoTransaction](@CleanUpProcedureName NVARCHAR(MAX) = NULL)
RETURNS TABLE
AS
RETURN
  SELECT
    CASE 
      WHEN (X.QuotedName IS NULL) 
        THEN 'INSERT INTO #NoTransaction VALUES(NULL);'
      ELSE 'IF(NOT EXISTS (SELECT 1 FROM sys.procedures WHERE object_id = OBJECT_ID('+X.QuotedName+'))) BEGIN RAISERROR(''Test CleanUp Procedure %s does not exist or is not a procedure.'',16,10,'+X.QuotedName+'); END;INSERT INTO #NoTransaction VALUES('+X.QuotedName+');'
    END AS AnnotationCmd
    FROM (VALUES(''''+REPLACE(@CleanUpProcedureName,'''','''''')+''''))X(QuotedName);
GO


GO

GO
CREATE PROCEDURE tSQLt.RemoveExternalAccessKey
AS
BEGIN
  EXEC tSQLt.Private_Print @Message='tSQLt.RemoveExternalAccessKey is deprecated. Please use tSQLt.RemoveAssemblyKey instead.';
  EXEC tSQLt.RemoveAssemblyKey;
RETURN;
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.InstallExternalAccessKey
AS
BEGIN
  EXEC tSQLt.Private_Print @Message='tSQLt.InstallExternalAccessKey is deprecated. Please use tSQLt.InstallAssemblyKey instead.';
  EXEC tSQLt.InstallAssemblyKey;
END;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_CreateInstallationInfo 
-- Created as a stored procedure to make it testable.
AS
BEGIN
  DECLARE @cmd NVARCHAR(MAX);
  SELECT 
      @cmd = 'ALTER FUNCTION tSQLt.Private_InstallationInfo() RETURNS TABLE AS RETURN SELECT CAST('+
             CAST(I.SqlVersion AS NVARCHAR(MAX))+
             ' AS NUMERIC(10,2)) AS SqlVersion;'
    FROM tSQLt.Info() AS I;

  EXEC(@cmd);
END;
GO
EXEC tSQLt.Private_CreateInstallationInfo;
GO


GO

GO
CREATE PROCEDURE tSQLt.Private_UndoSingleTestDouble
    @SchemaName NVARCHAR(MAX),
    @ObjectName NVARCHAR(MAX),
    @OriginalName NVARCHAR(MAX)
AS
BEGIN
   

   EXEC tSQLt.Private_RenameObject @SchemaName = @SchemaName,
                                   @ObjectName = @ObjectName,
                                   @NewName = @OriginalName;

END;
GO


GO

GO
CREATE PROCEDURE tSQLt.UndoTestDoubles
  @Force BIT = 0
AS
BEGIN
  DECLARE @cmd NVARCHAR(MAX);
  DECLARE @ErrorMessageTableList NVARCHAR(MAX);
  DECLARE @ErrorMessage NVARCHAR(MAX) = '';


  /*-- Two non-temp objects, the first of which should be renamed to the second --*/
  SELECT @ErrorMessage = @ErrorMessage + ISNULL(REPLACE('Attempting to remove object(s) that is/are not marked as temporary. Use @Force = 1 to override. (%s)','%s',Collisions.List),'')
    FROM
    (
      SELECT
        STUFF (
        (
          SELECT
              ', ' + QUOTENAME(OBJECT_SCHEMA_NAME(TestDouble.object_id))+'.'+QUOTENAME(TestDouble.name)
            FROM tSQLt.Private_RenamedObjectLog AS ROL
            JOIN sys.objects AS TestDouble
              ON TestDouble.object_id = OBJECT_ID(QUOTENAME(OBJECT_SCHEMA_NAME(ROL.ObjectId))+'.'+QUOTENAME(PARSENAME(ROL.OriginalName,1)))
            LEFT JOIN sys.extended_properties AS EP
              ON EP.class_desc = 'OBJECT_OR_COLUMN'
             AND EP.major_id = TestDouble.object_id
             AND EP.name = 'tSQLt.IsTempObject'
             AND EP.value = 1
           WHERE EP.value IS NULL
           ORDER BY 1
             FOR XML PATH (''), TYPE
         ).value('.','NVARCHAR(MAX)'),
         1,2,'')
    ) Collisions(List)

  /*-- Attempting to rename two or more non-temp objects to the same name --*/

  IF(EXISTS(
    SELECT O.schema_id, ROL.OriginalName, COUNT(1) cnt 
      FROM tSQLt.Private_RenamedObjectLog ROL
      JOIN sys.objects O
        ON ROL.ObjectId = O.object_id
      LEFT JOIN sys.extended_properties AS EP
        ON EP.class_desc = 'OBJECT_OR_COLUMN'
       AND EP.major_id = O.object_id
       AND EP.name = 'tSQLt.IsTempObject'
       AND EP.value = 1
     WHERE EP.value IS NULL
     GROUP BY O.schema_id, ROL.OriginalName
    HAVING COUNT(1)>1
  ))
  BEGIN
    WITH S AS(
      SELECT 
          C.Id,
          C.OriginalName,
          C.CurrentName,
          C.SchemaName
        FROM(
          SELECT ROL.OriginalName, ROL.Id, O.name CurrentName, SCHEMA_NAME(O.schema_id) SchemaName, COUNT(1)OVER(PARTITION BY O.schema_id, ROL.OriginalName) Cnt
            FROM tSQLt.Private_RenamedObjectLog ROL
            JOIN sys.objects O
              ON ROL.ObjectId = O.object_id
            LEFT JOIN sys.extended_properties AS EP
              ON EP.class_desc = 'OBJECT_OR_COLUMN'
             AND EP.major_id = O.object_id
             AND EP.name = 'tSQLt.IsTempObject'
             AND EP.value = 1
           WHERE EP.value IS NULL
        )C
       WHERE C.Cnt>1
    ),
    ErrorTableLists AS(
      SELECT 
          '{'+C.CList+'}-->' + QUOTENAME(SO.SchemaName)+'.'+QUOTENAME(PARSENAME(SO.OriginalName,1)) ErrorTableList,
          QUOTENAME(SO.SchemaName)+'.'+QUOTENAME(PARSENAME(SO.OriginalName,1)) FullOriginalName
        FROM (SELECT DISTINCT SchemaName, OriginalName FROM S) SO
       CROSS APPLY (
         SELECT (
           STUFF(
             (
               SELECT ', '+QUOTENAME(SC.CurrentName)
                 FROM S AS SC
                WHERE SC.OriginalName = SO.OriginalName
                  AND SC.SchemaName = SO.SchemaName
                ORDER BY SC.Id
                  FOR XML PATH(''),TYPE
             ).value('.','NVARCHAR(MAX)'),
             1,2,'')
         ) CList
       )C
    )
    SELECT @ErrorMessageTableList = (
      STUFF(
        (
          SELECT '; '+ETL.ErrorTableList
            FROM ErrorTableLists ETL
           ORDER BY ETL.FullOriginalName
             FOR XML PATH(''),TYPE
        ).value('.','NVARCHAR(MAX)'),
        1,2,''
      )
    );
    SELECT @ErrorMessage = @ErrorMessage + REPLACE('Attempting to rename two or more objects to the same name. Use @Force = 1 to override, only first object of each rename survives. (%s)','%s',@ErrorMessageTableList);
  END;
  IF(@ErrorMessage <> '')
  BEGIN
    IF (@Force = 1) 
    BEGIN
      SET @ErrorMessage = 'WARNING: @Force has been set to 1. Overriding the following error(s):'+@ErrorMessage;
      EXEC tSQLt.Private_Print @Message = @ErrorMessage;
    END;
    ELSE
    BEGIN
      RAISERROR(@ErrorMessage,16,10);
    END;
  END;




  SELECT TOP(0)A.* INTO #RenamedObjects FROM tSQLt.Private_RenamedObjectLog A RIGHT JOIN tSQLt.Private_RenamedObjectLog X ON 1=0;





  BEGIN TRAN;
  DELETE FROM tSQLt.Private_RenamedObjectLog OUTPUT Deleted.* INTO #RenamedObjects;

  WITH MarkedTestDoubles AS
  (
    SELECT 
        TempO.Name,
        SCHEMA_NAME(TempO.schema_id) SchemaName,
        TempO.type ObjectType
      FROM sys.objects TempO
      JOIN sys.extended_properties AS EP
        ON EP.class_desc = 'OBJECT_OR_COLUMN'
       AND EP.major_id = TempO.object_id
       AND EP.name = 'tSQLt.IsTempObject'
       AND EP.value = 1
  )
  SELECT @cmd = 
  (
    SELECT 
        DC.cmd+';'  
      FROM MarkedTestDoubles MTD
     CROSS APPLY tSQLt.Private_GetDropItemCmd(QUOTENAME(MTD.SchemaName)+'.'+QUOTENAME(MTD.Name),MTD.ObjectType) DC
       FOR XML PATH(''),TYPE
  ).value('.','NVARCHAR(MAX)');
  EXEC(@cmd);

  SELECT @cmd = 
  (
    SELECT
        DC.cmd+';'
      FROM(
        SELECT
            *
          FROM(
            SELECT
                ROL.OriginalName,
                O.object_id,
                O.type ObjectType,
                SCHEMA_NAME(O.schema_id) SchemaName, 
                O.name CurrentName,
                ROW_NUMBER()OVER(PARTITION BY O.schema_id, ROL.OriginalName ORDER BY ROL.Id) RN
              FROM #RenamedObjects AS ROL
              JOIN sys.objects O
                ON O.object_id = ROL.ObjectId
          )ROLI
         WHERE ROLI.RN>1
      )Deletables
     CROSS APPLY tSQLt.Private_GetDropItemCmd(QUOTENAME(Deletables.SchemaName)+'.'+QUOTENAME(Deletables.CurrentName),Deletables.ObjectType) DC
       FOR XML PATH(''),TYPE
  ).value('.','NVARCHAR(MAX)');
  EXEC(@cmd);


  WITH LL AS
  (
    SELECT 
        ROL.Id,
        ParentROL.Id ParentId,
        ISNULL(ParentROL.Id,ROL.Id) SortId,
        ROL.ObjectId,
        OBJECT_SCHEMA_NAME(ROL.ObjectId) SchemaName,
        OBJECT_NAME(ROL.ObjectId) CurrentName,
        PARSENAME(ROL.OriginalName,1) OriginalName
      FROM #RenamedObjects ROL
      JOIN sys.objects O
        ON ROL.ObjectId = O.object_id
      LEFT JOIN #RenamedObjects ParentROL
        ON O.parent_object_id = ParentROL.ObjectId
  ),
  L AS
  (
    SELECT 
        LL.Id,
        LL.ParentId,
        LL.SortId,
        LL.ObjectId,
        LL.SchemaName,
        LL.CurrentName,
        LL.OriginalName,
        FakeO.type ObjectType,
        CASE WHEN EP.value IS NOT NULL THEN 1 ELSE 0 END IsTempObject
      FROM LL
      LEFT JOIN sys.objects FakeO
        ON FakeO.object_id = OBJECT_ID(QUOTENAME(LL.SchemaName)+'.'+QUOTENAME(LL.OriginalName))
      LEFT JOIN sys.extended_properties AS EP
        ON EP.class_desc = 'OBJECT_OR_COLUMN'
       AND EP.major_id = FakeO.object_id
       AND EP.name = 'tSQLt.IsTempObject'
       AND EP.value = 1
  )
  SELECT @cmd = 
  (
    SELECT 
        ISNULL(CASE 
                 WHEN L.ParentId IS NULL THEN DC.cmd+';'  
                 ELSE NULL
               END,'')+
        'EXEC tSQLt.Private_RenameObject '''+L.SchemaName+''','''+L.CurrentName+''','''+L.OriginalName+''';'
      FROM L
     CROSS APPLY tSQLt.Private_GetDropItemCmd(QUOTENAME(L.SchemaName)+'.'+QUOTENAME(L.OriginalName),L.ObjectType) DC
     ORDER BY L.SortId DESC, L.Id ASC
       FOR XML PATH(''),TYPE
  ).value('.','NVARCHAR(MAX)');
  EXEC(@cmd);


  COMMIT;
END;
GO



GO

GO
SET NOCOUNT ON;
DECLARE @ver NVARCHAR(MAX); 
DECLARE @match INT; 
SELECT @ver = '| tSQLt Version: ' + I.Version,
       @match = CASE WHEN I.Version = I.ClrVersion THEN 1 ELSE 0 END
  FROM tSQLt.Info() AS I;
SET @ver = @ver+SPACE(42-LEN(@ver))+'|';
 
RAISERROR('',0,1)WITH NOWAIT;
RAISERROR('+-----------------------------------------+',0,1)WITH NOWAIT;
RAISERROR('|                                         |',0,1)WITH NOWAIT;
RAISERROR('| Thank you for using tSQLt.              |',0,1)WITH NOWAIT;
RAISERROR('|                                         |',0,1)WITH NOWAIT;
RAISERROR(@ver,0,1)WITH NOWAIT;
IF(@match = 0)
BEGIN
  RAISERROR('|                                         |',0,1)WITH NOWAIT;
  RAISERROR('| ERROR: mismatching CLR Version.         |',0,1)WITH NOWAIT;
  RAISERROR('| Please download a new version of tSQLt. |',0,1)WITH NOWAIT;
END
RAISERROR('|                                         |',0,1)WITH NOWAIT;
RAISERROR('+-----------------------------------------+',0,1)WITH NOWAIT;


GO

