-- get_patient_profile_for_current_user.sql
--
-- Security-definer helper so authenticated clients can retrieve
-- their public.patients row even when the user_id column has not
-- been populated yet. The function first tries user_id, then
-- falls back to matching on the email embedded inside the JWT.

CREATE OR REPLACE FUNCTION public.get_patient_profile_for_current_user()
RETURNS SETOF public.patients
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claims AS (
    SELECT auth.uid() AS uid, auth.jwt() ->> 'email' AS email
  )
  SELECT p.*
  FROM public.patients p
  CROSS JOIN claims c
  WHERE (
    p.user_id IS NOT DISTINCT FROM c.uid
  ) OR (
    c.email IS NOT NULL AND p.email IS NOT NULL AND (
      (pg_typeof(p.email) = 'text'::regtype AND p.email = c.email) OR
      (pg_typeof(p.email) = 'text[]'::regtype AND c.email = ANY(p.email))
    )
  )
  ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_patient_profile_for_current_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_patient_profile_for_current_user() TO authenticated;
