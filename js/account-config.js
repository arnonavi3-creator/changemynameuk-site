/* Supabase project for customer accounts (London region).
   Both values are public by design: the key is the "publishable" (or "anon")
   key, and row level security in supabase/schema.sql decides what each person
   can see. Never put the secret / service_role key here.
   Leave url empty to switch accounts off: the site then works exactly as
   before, saving only in the visitor's browser. */
window.CMN_SUPABASE = {
  url: 'https://tgsoricyjpvtaqgewfip.supabase.co',
  key: 'sb_publishable_v4jfXPCJhIcs4sCGroF2hg_s_kzZ9AK',
  /* false = the "Save your checklist" box only shows on deploy previews and
     localhost, not on the live site. Set to true once sign-in emails go
     through our own sender (Resend) and the ICO registration is done.
     The admin page works either way. */
  publicSignIn: false
};
