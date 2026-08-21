create spatial index spatial_index on t(shape) USING GEOGRAPHY_AUTO_GRID

create spatial index spatial_index on t(shape) USING GEOMETRY_AUTO_GRID

create spatial index spatial_index on t(shape) USING GEOGRAPHY_AUTO_GRID
WITH (DATA_COMPRESSION=PAGE)

