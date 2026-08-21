CREATE TABLE table1 (
    ID BIGINT IDENTITY
);


GO
CREATE TABLE Employees (
    EmployeeID BIGINT        IDENTITY,
    FirstName  NVARCHAR (50),
    LastName   NVARCHAR (50)
);


GO
CREATE TABLE Orders (
    OrderID      INT             IDENTITY,
    CustomerName VARCHAR (100)  ,
    OrderDate    DATETIME       ,
    TotalAmount  DECIMAL (10, 2)
);


GO
CREATE TABLE Products (
    ProductID   BIGINT         IDENTITY,
    ProductName NVARCHAR (100)
);