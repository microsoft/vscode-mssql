-- Seeds one object of each type searched by Global Database Search, all in the dbo schema:
-- a table, a view, a stored procedure and a scalar function.

CREATE TABLE dbo.EventTickets
(
    TicketId INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
    EventName NVARCHAR(100) NOT NULL,
    EventDate DATE NOT NULL,
    Price DECIMAL(10, 2) NOT NULL,
    Quantity INT NOT NULL
);
GO

INSERT INTO dbo.EventTickets (EventName, EventDate, Price, Quantity)
VALUES
    (N'Spring Concert', '2026-04-18', 45.00, 120),
    (N'Summer Festival', '2026-07-04', 80.00, 300),
    (N'Autumn Play', '2026-10-10', 30.00, 75),
    (N'Winter Gala', '2026-12-12', 150.00, 40);
GO

CREATE VIEW dbo.vw_EventTickets
AS
SELECT TicketId, EventName, EventDate, Price, Quantity, Price * Quantity AS Revenue
FROM dbo.EventTickets;
GO

CREATE PROCEDURE dbo.ProcessTicketSale
    @TicketId INT,
    @QuantitySold INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.EventTickets
    SET Quantity = Quantity - @QuantitySold
    WHERE TicketId = @TicketId AND Quantity >= @QuantitySold;
END;
GO

CREATE FUNCTION dbo.GetTicketRevenue (@TicketId INT)
RETURNS DECIMAL(18, 2)
AS
BEGIN
    DECLARE @Revenue DECIMAL(18, 2);
    SELECT @Revenue = Price * Quantity FROM dbo.EventTickets WHERE TicketId = @TicketId;
    RETURN ISNULL(@Revenue, 0);
END;
GO
