-- Create notifications table for doctor notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  -- Option B: doctor_id is the auth.users.id of the doctor (nullable to allow soft creation)
  doctor_id UUID NULL,
  patient_id UUID NULL,
  diagnosis_id UUID NULL,
  report_id UUID NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'report_shared'::text,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

-- Make the table RLS-enabled
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Idempotent policy management
DROP POLICY IF EXISTS "Doctors can view their notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Doctors can update their notifications" ON public.notifications;

-- Doctors can view notifications that are addressed to their auth user id
CREATE POLICY "Doctors can view their notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = doctor_id);

-- Allow authenticated users (patients) to create notifications
CREATE POLICY "Authenticated users can create notifications" ON public.notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Allow doctors to update their notifications (e.g., mark as read)
CREATE POLICY "Doctors can update their notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = doctor_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_doctor_id ON public.notifications(doctor_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_patient_id ON public.notifications(patient_id);

-- Try to safely backfill existing data where possible:
-- 1) If a `doctor_user_id` column exists (from a previous migration), copy it into `doctor_id` and drop it.
-- 2) If `doctor_id` currently holds `doctors.id` values, and a `doctors` table exists, map those to `doctors.user_id`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    -- If old column doctor_user_id exists, move values into doctor_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'doctor_user_id') THEN
      BEGIN
        UPDATE public.notifications SET doctor_id = doctor_user_id WHERE doctor_id IS NULL AND doctor_user_id IS NOT NULL;
        ALTER TABLE public.notifications DROP COLUMN IF EXISTS doctor_user_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Skipping doctor_user_id backfill: %', SQLERRM;
      END;
    END IF;

    -- If a `doctors` table exists and notifications.doctor_id currently refer to doctors.id, replace with doctors.user_id
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'doctors') THEN
      BEGIN
        UPDATE public.notifications n
        SET doctor_id = d.user_id
        FROM public.doctors d
        WHERE n.doctor_id = d.id AND d.user_id IS NOT NULL;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Skipping doctors->auth backfill: %', SQLERRM;
      END;
    END IF;
  END IF;
END$$;