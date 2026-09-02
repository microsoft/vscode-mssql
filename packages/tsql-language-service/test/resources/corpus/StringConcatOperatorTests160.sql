UPDATE t1 set @a ||= 1
GO
UPDATE t1 set @a ||= null
GO
UPDATE t1 set @a = c1 ||= 1, @a = c1 ||= null
UPDATE t1 set c1 ||= 1, c1 ||= null
GO
SET @a ||= 1
GO
SELECT @a ||= 1
GO
SET @a ||= 'foo' || 'bar'
GO
SELECT @a ||= 'foo' || 'bar'
GO
SELECT 'ab' || N'ab' || 1
GO
SELECT c1 || c1 FROM t1
GO
SELECT 1 || c1 FROM t1
GO
SELECT 0x12 || 0xab
GO