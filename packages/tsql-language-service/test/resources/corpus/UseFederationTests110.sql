use federation root with reset
go

use federation f1 (d1 = 20) with filtering=on, reset
go

use federation f1 (d1 = 40) with filtering=off, reset
go

-- Should be a regular use statement, not a federation statement
use federation
go