ADD SIGNATURE TO HumanResources.uspUpdateEmployeeLogin BY CERTIFICATE HumanResourcesDP
DROP SIGNATURE FROM HumanResources.uspUpdateEmployeeLogin BY CERTIFICATE HumanResourcesDP

add counter signature to assembly::a1 by asymmetric key ask1 with password = 'PLACEHOLDER1'
drop counter signature from object::dbo.o1 by asymmetric key ask2 with signature = 0x10

add signature to database::db1 by password = 'PLACEHOLDER2', certificate cert1 with signature = 0x20, asymmetric key ask3