-- Purpose: Creates a runtime temp table with XML data and queries parsed XML fields.
-- Tags: sqlserver, xml, temp-table, release-validation

-- Create a temp table with XML column
CREATE TABLE #ProductsWithXml (
    ProductId INT,
    ProductName NVARCHAR(100),
    XmlData XML
);

-- Insert sample data with XML
INSERT INTO #ProductsWithXml (ProductId, ProductName, XmlData)
VALUES
    (1, 'Laptop', '<product><brand>Dell</brand><specs><ram>16GB</ram><storage>512GB SSD</storage><processor>Intel i7</processor></specs><price>1299.99</price><inStock>true</inStock></product>'),
    (2, 'Mouse', '<product><brand>Logitech</brand><specs><type>wireless</type><buttons>5</buttons><dpi>1600</dpi></specs><price>49.99</price><inStock>true</inStock></product>'),
    (3, 'Monitor', '<product><brand>Samsung</brand><specs><size>27 inch</size><resolution>2560x1440</resolution><refreshRate>144Hz</refreshRate></specs><price>399.99</price><inStock>false</inStock></product>'),
    (4, 'Keyboard', '<product><brand>Corsair</brand><specs><type>mechanical</type><switches>Cherry MX Red</switches><backlight>RGB</backlight></specs><price>129.99</price><inStock>true</inStock></product>');

-- Select all data with parsed XML fields
SELECT
    ProductId,
    ProductName,
    XmlData.value('(/product/brand)[1]', 'NVARCHAR(100)') AS Brand,
    XmlData.value('(/product/price)[1]', 'DECIMAL(10,2)') AS Price,
    XmlData.value('(/product/inStock)[1]', 'NVARCHAR(10)') AS InStock,
    XmlData AS RawXml
FROM #ProductsWithXml;

-- Query specific XML properties
SELECT
    ProductId,
    ProductName,
    XmlData.value('(/product/brand)[1]', 'NVARCHAR(100)') AS Brand,
    XmlData.value('(/product/specs/ram)[1]', 'NVARCHAR(50)') AS RAM,
    XmlData.value('(/product/specs/storage)[1]', 'NVARCHAR(50)') AS Storage,
    XmlData.value('(/product/specs/processor)[1]', 'NVARCHAR(50)') AS Processor
FROM #ProductsWithXml
WHERE XmlData.exist('(/product/specs/ram)[1]') = 1;

-- Query all specs using CROSS APPLY
SELECT
    ProductId,
    ProductName,
    XmlData.value('(/product/brand)[1]', 'NVARCHAR(100)') AS Brand,
    Spec.value('local-name(.)', 'NVARCHAR(50)') AS SpecName,
    Spec.value('.', 'NVARCHAR(100)') AS SpecValue
FROM #ProductsWithXml
CROSS APPLY XmlData.nodes('/product/specs/*') AS T(Spec);

-- Cleanup
DROP TABLE #ProductsWithXml;
