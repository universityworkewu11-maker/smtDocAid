-- Create notifications table for doctor notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  doctor_user_id UUID NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  diagnosis_id UUID REFERENCES diagnoses(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'report_shared',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Policies
-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Doctors can view their notifications" ON notifications;
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON notifications;
DROP POLICY IF EXISTS "Doctors can update their notifications" ON notifications;

-- Doctors can read their own notifications (match by doctor_user_id)
CREATE POLICY "Doctors can view their notifications" ON notifications
  FOR SELECT USING (auth.uid() = doctor_user_id);

-- Allow inserts for authenticated users (patients sharing reports)
CREATE POLICY "Authenticated users can create notifications" ON notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Allow updates for doctors to mark as read (match by doctor_user_id)
CREATE POLICY "Doctors can update their notifications" ON notifications
  FOR UPDATE USING (auth.uid() = doctor_user_id);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_notifications_doctor_id ON notifications(doctor_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

-- Backfill `doctor_user_id` for existing rows where possible
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'notifications') THEN
    BEGIN
      -- Add doctor_user_id column if it doesn't exist
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS doctor_user_id UUID;
    EXCEPTION WHEN duplicate_column THEN
      -- ignore
    END;

    -- Backfill from doctors table where doctor_id references doctors.id
    UPDATE notifications n
    SET doctor_user_id = d.user_id
    FROM doctors d
    WHERE n.doctor_user_id IS NULL AND n.doctor_id = d.id;
  END IF;
END$$;