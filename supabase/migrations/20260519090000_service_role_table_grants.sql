-- Allow the server-side Supabase service client to access application tables.
-- RLS remains enforced for browser clients; service_role is only stored in
-- server-side Vercel environment variables.
grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;
