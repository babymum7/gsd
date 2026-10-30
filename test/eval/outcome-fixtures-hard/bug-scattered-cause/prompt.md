People who sign up with a capitalised email address cannot log in with it. The simplest case I can reproduce: `signUp("Ana@Example.com", "pw")` followed by `logIn("Ana@Example.com", "pw")` throws `no such user`. Support says other account features have also misbehaved for addresses typed in mixed case.

Please find out what is going wrong and fix it.
