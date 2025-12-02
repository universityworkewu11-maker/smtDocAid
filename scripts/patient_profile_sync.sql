-- patient_profile_sync.sql
--
-- Ensures the legacy public.patient_profiles table stays aligned with
-- the canonical public.patients table that now powers the UI.
--
-- Usage:
--   1. Run this script once in Supabase SQL editor to backfill and
--      install the trigger.
--   2. (Optional) Schedule the refresh function as a Supabase cron job
--      if you also import patients via CSV or external ETL jobs.

-- 1) Backfill any missing patient_profiles rows from public.patients
INSERT INTO public.patient_profiles (
    user_id,
    patient_id,
    first_name,
    last_name,
    full_name,
    phone,
    address,
    date_of_birth,
    gender,
    updated_at
)
SELECT
    p.user_id,
    COALESCE(pp.patient_id, CONCAT('PID-', p.id)),
    SPLIT_PART(p.full_name, ' ', 1) AS first_name,
    NULLIF(SUBSTRING(p.full_name FROM POSITION(' ' IN p.full_name)), '') AS last_name,
    p.full_name,
    p.phone,
    p.address,
    p.date_of_birth,
    p.gender,
    NOW()
FROM public.patients p
LEFT JOIN public.patient_profiles pp ON pp.user_id = p.user_id
ON CONFLICT (user_id) DO UPDATE
SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    address = EXCLUDED.address,
    date_of_birth = EXCLUDED.date_of_birth,
    gender = EXCLUDED.gender,
    updated_at = NOW();

-- 2) Trigger to keep patient_profiles synchronized after each change
CREATE OR REPLACE FUNCTION public.sync_patient_profiles_from_patients()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    derived_first text;
    derived_last text;
BEGIN
    derived_first := COALESCE(SPLIT_PART(NEW.full_name, ' ', 1), NEW.full_name);
    derived_last := NULLIF(REGEXP_REPLACE(NEW.full_name, '^\S+\s*', ''), '');

    INSERT INTO public.patient_profiles (
        user_id,
        patient_id,
        first_name,
        last_name,
        full_name,
        phone,
        address,
        date_of_birth,
        gender,
        updated_at
    )
    VALUES (
        NEW.user_id,
        COALESCE((SELECT patient_id FROM public.patient_profiles WHERE user_id = NEW.user_id LIMIT 1), CONCAT('PID-', NEW.id)),
        derived_first,
        derived_last,
        NEW.full_name,
        NEW.phone,
        NEW.address,
        NEW.date_of_birth,
        NEW.gender,
        NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        date_of_birth = EXCLUDED.date_of_birth,
        gender = EXCLUDED.gender,
        updated_at = NOW();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patient_profiles_from_patients ON public.patients;

CREATE TRIGGER patient_profiles_from_patients
AFTER INSERT OR UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.sync_patient_profiles_from_patients();

-- 3) Helper function for ad-hoc refresh jobs / cron invocations
CREATE OR REPLACE FUNCTION public.refresh_patient_profiles()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.patient_profiles AS pp (
        user_id,
        patient_id,
        first_name,
        last_name,
        full_name,
        phone,
        address,
        date_of_birth,
        gender,
        updated_at
    )
    SELECT
        p.user_id,
        COALESCE(pp.patient_id, CONCAT('PID-', p.id)),
        SPLIT_PART(p.full_name, ' ', 1),
        NULLIF(REGEXP_REPLACE(p.full_name, '^\S+\s*', ''), ''),
        p.full_name,
        p.phone,
        p.address,
        p.date_of_birth,
        p.gender,
        NOW()
    FROM public.patients p
    LEFT JOIN public.patient_profiles pp ON pp.user_id = p.user_id
    ON CONFLICT (user_id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        date_of_birth = EXCLUDED.date_of_birth,
        gender = EXCLUDED.gender,
        updated_at = NOW();
END;
$$;

-- Call once (or via cron) to run the refresh logic immediately
-- SELECT public.refresh_patient_profiles();
