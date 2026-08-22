-- Add demographic fields to clinician_profiles
ALTER TABLE clinician_profiles
  ADD COLUMN IF NOT EXISTS age INTEGER,
  ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
  ADD COLUMN IF NOT EXISTS region VARCHAR(100);
