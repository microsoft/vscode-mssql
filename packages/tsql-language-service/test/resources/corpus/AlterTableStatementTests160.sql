-- Alter table add a Json column
--
ALTER TABLE T ADD jsonCol JSON;

-- Alter table change column data type to Json
--
ALTER TABLE T ALTER COLUMN col JSON;
GO