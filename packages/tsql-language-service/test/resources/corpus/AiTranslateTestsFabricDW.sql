SELECT AI_TRANSLATE (t.text_col, 'es')
FROM dbo.Texts AS t;

SELECT AI_TRANSLATE ('text', 'es');
SELECT AI_TRANSLATE ('text' + 'text', 'e' + 's');

DECLARE @s AS NVARCHAR (MAX) = N'Hello world';
DECLARE @lang AS NVARCHAR (5) = N'en';
SELECT AI_TRANSLATE (@s, @lang);
SELECT AI_TRANSLATE (@s + 'a', @lang + 'a');
SELECT * FROM AI_TRANSLATE((SELECT t.text_col
                            FROM dbo.Texts AS t), 'e' + 's');
GO

CREATE OR ALTER FUNCTION dbo.fx
(@s NVARCHAR (MAX))
RETURNS NVARCHAR (MAX)
AS
BEGIN
    RETURN (AI_TRANSLATE (@s, 'fr'));
END

GO

SELECT AI_TRANSLATE (@s, t.lang)
FROM dbo.Texts AS t;
