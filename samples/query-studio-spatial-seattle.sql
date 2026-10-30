-- Query Studio spatial gallery: Seattle landmarks, routes, and park areas.
-- Read-only: uses table variables and does not create database objects.
-- Coordinates are approximate. Lines and 250 m circles are illustrative,
-- not surveyed park boundaries, navigation routes, or service areas.
-- Enable the spatial preview, execute, and choose Spatial in the results pane.
-- Label = Place; Color by = Category; use Layers to compare basemaps.

DECLARE @landmarks TABLE (
    Place nvarchar(80), Category nvarchar(30), Latitude float, Longitude float
);

INSERT INTO @landmarks VALUES
    (N'Space Needle',         N'Landmark', 47.6205, -122.3493),
    (N'Pike Place Market',    N'Landmark', 47.6097, -122.3425),
    (N'Seattle Aquarium',     N'Waterfront', 47.6073, -122.3426),
    (N'Olympic Sculpture Park', N'Park',   47.6166, -122.3553),
    (N'Lake Union Park',      N'Park',     47.6269, -122.3371),
    (N'Gas Works Park',       N'Park',     47.6456, -122.3344),
    (N'Fremont Troll',        N'Landmark', 47.6511, -122.3475),
    (N'Kerry Park',           N'Viewpoint',47.6295, -122.3599),
    (N'Smith Tower',          N'Landmark', 47.6019, -122.3317),
    (N'T-Mobile Park',        N'Stadium',  47.5914, -122.3325),
    (N'Lumen Field',          N'Stadium',  47.5952, -122.3316),
    (N'Capitol Hill Station', N'Transit',  47.6190, -122.3206);

SELECT Place, Category,
       CAST(geography::Point(Latitude, Longitude, 4326).STDistance(
           geography::Point(47.6097, -122.3425, 4326)) / 1000.0 AS decimal(5,2))
           AS KmFromPikePlace,
       geography::Point(Latitude, Longitude, 4326) AS Location
FROM @landmarks
ORDER BY Category, Place;

-- A second result set mixes points, lines, and polygons around Lake Union.
-- Choose Result 2 in the Spatial column selector to inspect it.
DECLARE @lake TABLE (Place nvarchar(80), Category nvarchar(30), Location geography);

INSERT INTO @lake
SELECT Place, N'Park area (illustrative)',
       geography::Point(Latitude, Longitude, 4326).STBuffer(250)
FROM @landmarks
WHERE Place IN (N'Lake Union Park', N'Gas Works Park');

INSERT INTO @lake VALUES
    (N'Lake Union loop', N'Route (illustrative)', geography::STGeomFromText(
        'LINESTRING(-122.3371 47.6288, -122.3388 47.6342, -122.3390 47.6414, -122.3344 47.6443, -122.3275 47.6415, -122.3255 47.6352, -122.3304 47.6303, -122.3371 47.6288)', 4326)),
    (N'North-south crossing', N'Route (illustrative)', geography::STGeomFromText(
        'LINESTRING(-122.3344 47.6443, -122.3337 47.6374, -122.3371 47.6288)', 4326)),
    (N'Gas Works Park', N'Landmark', geography::Point(47.6456, -122.3344, 4326)),
    (N'Lake Union Park', N'Landmark', geography::Point(47.6269, -122.3371, 4326)),
    (N'Museum of History & Industry', N'Museum', geography::Point(47.6276, -122.3366, 4326)),
    (N'Center for Wooden Boats', N'Museum', geography::Point(47.6265, -122.3375, 4326)),
    (N'Seaplane terminal', N'Transit', geography::Point(47.6296, -122.3394, 4326)),
    (N'Eastlake waterfront', N'Waterfront', geography::Point(47.6392, -122.3265, 4326));

SELECT Place, Category, Location FROM @lake ORDER BY Category, Place;
