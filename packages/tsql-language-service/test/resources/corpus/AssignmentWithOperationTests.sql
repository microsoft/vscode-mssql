-- Update statement - a statement per assignment operator, for error tests
UPDATE t1 set @a += null
GO
UPDATE t1 set @a -= 1
GO
UPDATE t1 set @a *= 1 + 1
GO
UPDATE t1 set @a /= 1
GO
UPDATE t1 set @a %= 1
GO
UPDATE t1 set @a &= 1
GO
UPDATE t1 set @a |= 1
GO
UPDATE t1 set @a ^= 1
GO

UPDATE t1 set @a = c1 += null, @a = c1 -= default, @a = c1 *= 1 + 1, @a = c1 /= 1, @a = c1 %= 1, @a = c1 &= 1, @a = c1 |= 1, @a = c1 ^= 1
UPDATE t1 set c1 += null, c1 -= default, c1 *= 1 + 1, c1 /= 1, c1 %= 1, c1 &= 1, c1 |= 1, c1 ^= 1
GO
-- SET statement - one test per assignment operator
SET @a += 1+1
GO
SET @a -= 1
GO
SET @a *= 1
GO
SET @a /= 1
GO
SET @a %= 1
GO
SET @a &= 1
GO
SET @a |= 1
GO
SET @a ^= 1
GO
-- SELECT statement - one test per assignment operator
SELECT @a += 1
GO
SELECT @a -= 1
GO
SELECT @a *= 1
GO
SELECT @a /= 1
GO
SELECT @a %= 1
GO
SELECT @a &= 1
GO
SELECT @a |= 1
GO
SELECT @a ^= 1
