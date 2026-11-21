/* Supabase project for customer accounts (London region).
   Both values are public by design: the key is the "publishable" (or "anon")
   key, and row level security in supabase/schema.sql decides what each person
   can see. Never put the secret / service_role key here.
   Leave url empty to switch accounts off: the site then works exactly as
   before, saving only in the visitor's browser. */
window.CMN_SUPABASE = {
  url: '',
  key: ''
};
