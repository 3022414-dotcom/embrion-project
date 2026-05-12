-- Migration 005: Add opened_at to patient_selections (F-04)
ALTER TABLE patient_selections
  ADD COLUMN opened_at TIMESTAMPTZ;

COMMENT ON COLUMN patient_selections.opened_at
  IS 'Timestamp of first patient access. NULL until patient opens selection.';
