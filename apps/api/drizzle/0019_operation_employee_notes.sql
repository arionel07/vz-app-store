ALTER TABLE retail_campaign_submissions
  ADD COLUMN employee_note text NOT NULL DEFAULT '';

ALTER TABLE merchandising_inspections
  ADD COLUMN employee_note text NOT NULL DEFAULT '';
