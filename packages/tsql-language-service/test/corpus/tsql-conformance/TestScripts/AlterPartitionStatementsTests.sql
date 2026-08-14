-- alter partition function
alter partition function f1() split 
alter partition function f1() merge
alter partition function f1() split range (10)
alter partition function f1() merge range (10)

-- alter partition scheme
alter partition scheme s1 next used
alter partition scheme s1 next used fg1
alter partition scheme s1 next used 'zzz'