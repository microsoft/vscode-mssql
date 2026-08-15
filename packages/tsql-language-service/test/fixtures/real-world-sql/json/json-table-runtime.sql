-- Purpose: Creates a runtime temp table with JSON data and queries parsed JSON fields.
-- Tags: sqlserver, json, temp-table, release-validation

-- Create a temp table with JSON column
CREATE TABLE #ProductsWithJson (
    ProductId INT,
    ProductName NVARCHAR(100),
    JsonData NVARCHAR(MAX)
);

-- Insert sample data with JSON
INSERT INTO #ProductsWithJson (ProductId, ProductName, JsonData)
VALUES
    (1, 'Laptop', '{"brand": "Dell", "specs": {"ram": "16GB", "storage": "512GB SSD", "processor": "Intel i7"}, "price": 1299.99, "inStock": true}'),
    (2, 'Mouse', '{"brand": "Logitech", "specs": {"type": "wireless", "buttons": 5, "dpi": 1600}, "price": 49.99, "inStock": true}'),
    (3, 'Monitor', '{"brand": "Samsung", "specs": {"size": "27 inch", "resolution": "2560x1440", "refreshRate": "144Hz"}, "price": 399.99, "inStock": false}'),
    (4, 'Keyboard', '{"brand": "Corsair", "specs": {"type": "mechanical", "switches": "Cherry MX Red", "backlight": "RGB"}, "price": 129.99, "inStock": true}');

-- Select all data with parsed JSON fields
SELECT
    ProductId,
    ProductName,
    JSON_VALUE(JsonData, '$.brand') AS Brand,
    JSON_VALUE(JsonData, '$.price') AS Price,
    JSON_VALUE(JsonData, '$.inStock') AS InStock,
    JSON_QUERY(JsonData, '$.specs') AS Specifications,
    JsonData AS RawJson
FROM #ProductsWithJson;

-- Query specific JSON properties
SELECT
    ProductId,
    ProductName,
    JSON_VALUE(JsonData, '$.brand') AS Brand,
    JSON_VALUE(JsonData, '$.specs.ram') AS RAM,
    JSON_VALUE(JsonData, '$.specs.storage') AS Storage,
    JSON_VALUE(JsonData, '$.specs.processor') AS Processor
FROM #ProductsWithJson
WHERE JSON_VALUE(JsonData, '$.specs.ram') IS NOT NULL;

-- Cleanup
DROP TABLE #ProductsWithJson;
