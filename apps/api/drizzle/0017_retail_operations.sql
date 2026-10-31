ALTER TYPE notification_target_kind ADD VALUE 'operation';
ALTER TABLE notification_preferences ADD COLUMN operations_notifications boolean NOT NULL DEFAULT true;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK (category IN ('task','quiz','schedule','photo','announcement','knowledge','operations'));

CREATE TYPE retail_campaign_status AS ENUM ('draft','scheduled','active','completed','archived','cancelled');
CREATE TYPE retail_execution_status AS ENUM ('not_started','in_progress','submitted','checked','rejected');
CREATE TYPE merchandising_status AS ENUM ('draft','submitted','checked','rejected');
CREATE TYPE store_issue_status AS ENUM ('open','in_progress','resolved','closed');
CREATE TYPE operational_request_status AS ENUM ('submitted','approved','rejected','in_progress','completed');

CREATE TABLE retail_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text NOT NULL DEFAULT '',
  status retail_campaign_status NOT NULL DEFAULT 'draft', starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  timezone text NOT NULL, required_actions jsonb NOT NULL DEFAULT '[]', requires_photo boolean NOT NULL DEFAULT false,
  reference_photo_ids uuid[] NOT NULL DEFAULT '{}', created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at), CHECK (jsonb_typeof(required_actions) = 'array')
);
CREATE INDEX retail_campaigns_status_dates_idx ON retail_campaigns(status, starts_at, ends_at);
CREATE TABLE retail_campaign_stores (
  campaign_id uuid NOT NULL REFERENCES retail_campaigns(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  PRIMARY KEY (campaign_id, store_id)
);
CREATE TABLE retail_campaign_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES retail_campaigns(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT, status retail_execution_status NOT NULL DEFAULT 'not_started',
  action_results jsonb NOT NULL DEFAULT '[]', evidence_photo_ids uuid[] NOT NULL DEFAULT '{}', submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz, reviewer_id uuid REFERENCES users(id) ON DELETE RESTRICT, review_comment text,
  version integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, store_id), CHECK(version >= 0), CHECK(jsonb_typeof(action_results) = 'array')
);
CREATE INDEX retail_campaign_executions_store_status_idx ON retail_campaign_executions(store_id,status,updated_at);
CREATE TABLE retail_campaign_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL REFERENCES retail_campaign_executions(id) ON DELETE RESTRICT,
  version integer NOT NULL, submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action_results jsonb NOT NULL, evidence_photo_ids uuid[] NOT NULL DEFAULT '{}', idempotency_key text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(), UNIQUE(execution_id,version), UNIQUE(execution_id,idempotency_key),
  CHECK(version > 0), CHECK(jsonb_typeof(action_results)='array')
);
CREATE INDEX retail_campaign_submissions_actor_idx ON retail_campaign_submissions(submitted_by,submitted_at);
CREATE TABLE retail_campaign_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL REFERENCES retail_campaign_executions(id) ON DELETE RESTRICT,
  submission_id uuid REFERENCES retail_campaign_submissions(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, from_status retail_execution_status NOT NULL,
  to_status retail_execution_status NOT NULL, comment text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retail_campaign_reviews_execution_idx ON retail_campaign_reviews(execution_id,created_at);

CREATE TABLE merchandising_displays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  name text NOT NULL, brand text NOT NULL DEFAULT '', reference_photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  checklist jsonb NOT NULL DEFAULT '[]', campaign_id uuid REFERENCES retail_campaigns(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true, created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(jsonb_typeof(checklist)='array')
);
CREATE INDEX merchandising_displays_store_active_idx ON merchandising_displays(store_id,active);
CREATE TABLE merchandising_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_id uuid NOT NULL REFERENCES merchandising_displays(id) ON DELETE RESTRICT,
  display_name_snapshot text NOT NULL, brand_snapshot text NOT NULL, checklist_snapshot jsonb NOT NULL,
  reference_photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  actual_photo_id uuid REFERENCES photos(id) ON DELETE RESTRICT, checklist_results jsonb NOT NULL DEFAULT '[]',
  status merchandising_status NOT NULL DEFAULT 'draft', submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_id uuid REFERENCES users(id) ON DELETE RESTRICT, comment text, version integer NOT NULL DEFAULT 1,
  idempotency_key text, submitted_at timestamptz, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(version > 0), CHECK(jsonb_typeof(checklist_results)='array'), UNIQUE(submitted_by,idempotency_key), UNIQUE(display_id,version)
);
CREATE INDEX merchandising_inspections_status_idx ON merchandising_inspections(status,submitted_at);
CREATE TABLE merchandising_review_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid NOT NULL REFERENCES merchandising_inspections(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, from_status merchandising_status NOT NULL,
  to_status merchandising_status NOT NULL, comment text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE store_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  category text NOT NULL, title text NOT NULL, description text NOT NULL, priority text NOT NULL DEFAULT 'normal',
  photo_ids uuid[] NOT NULL DEFAULT '{}', reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL, status store_issue_status NOT NULL DEFAULT 'open',
  resolution_notes text, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(priority IN ('low','normal','high','urgent'))
);
CREATE INDEX store_issues_store_status_idx ON store_issues(store_id,status,priority,created_at);
CREATE TABLE store_issue_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issue_id uuid NOT NULL REFERENCES store_issues(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, action text NOT NULL, from_status store_issue_status,
  to_status store_issue_status, reason text, previous_priority text, new_priority text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_issue_history_issue_idx ON store_issue_history(issue_id,created_at);

CREATE TABLE operational_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  category text NOT NULL, description text NOT NULL, quantity text, attachment_photo_ids uuid[] NOT NULL DEFAULT '{}',
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  status operational_request_status NOT NULL DEFAULT 'submitted', decision_comment text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_requests_store_status_idx ON operational_requests(store_id,status,created_at);
CREATE TABLE operational_request_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES operational_requests(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, from_status operational_request_status,
  to_status operational_request_status NOT NULL, comment text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_request_history_request_idx ON operational_request_history(request_id,created_at);

-- Relational evidence links provide real media FKs while retaining legacy arrays.
CREATE TABLE retail_campaign_reference_photos (
  campaign_id uuid NOT NULL REFERENCES retail_campaigns(id) ON DELETE RESTRICT,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  PRIMARY KEY(campaign_id,photo_id)
);
INSERT INTO retail_campaign_reference_photos(campaign_id,photo_id)
SELECT c.id, p.id FROM retail_campaigns c CROSS JOIN LATERAL unnest(c.reference_photo_ids) ref(photo_id)
JOIN photos p ON p.id=ref.photo_id
WHERE EXISTS (SELECT 1 FROM retail_campaign_stores cs WHERE cs.campaign_id=c.id AND cs.store_id=p.store_id)
ON CONFLICT DO NOTHING;
UPDATE retail_campaigns c SET reference_photo_ids=COALESCE((SELECT array_agg(link.photo_id ORDER BY link.photo_id) FROM retail_campaign_reference_photos link WHERE link.campaign_id=c.id),'{}'::uuid[]);
CREATE TABLE retail_campaign_submission_photos (
  submission_id uuid NOT NULL REFERENCES retail_campaign_submissions(id) ON DELETE RESTRICT,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  PRIMARY KEY(submission_id,photo_id)
);
INSERT INTO retail_campaign_submission_photos(submission_id,photo_id)
SELECT s.id, p.id FROM retail_campaign_submissions s
JOIN retail_campaign_executions e ON e.id=s.execution_id
CROSS JOIN LATERAL unnest(s.evidence_photo_ids) evidence(photo_id)
JOIN photos p ON p.id=evidence.photo_id AND p.store_id=e.store_id
ON CONFLICT DO NOTHING;
UPDATE retail_campaign_submissions s SET evidence_photo_ids=COALESCE((SELECT array_agg(link.photo_id ORDER BY link.photo_id) FROM retail_campaign_submission_photos link WHERE link.submission_id=s.id),'{}'::uuid[]);
UPDATE retail_campaign_executions e SET evidence_photo_ids=COALESCE((SELECT s.evidence_photo_ids FROM retail_campaign_submissions s WHERE s.execution_id=e.id ORDER BY s.version DESC LIMIT 1),'{}'::uuid[]);
CREATE TABLE store_issue_photos (
  issue_id uuid NOT NULL REFERENCES store_issues(id) ON DELETE RESTRICT,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  PRIMARY KEY(issue_id,photo_id)
);
INSERT INTO store_issue_photos(issue_id,photo_id)
SELECT i.id, p.id FROM store_issues i CROSS JOIN LATERAL unnest(i.photo_ids) evidence(photo_id)
JOIN photos p ON p.id=evidence.photo_id AND p.store_id=i.store_id
ON CONFLICT DO NOTHING;
UPDATE store_issues i SET photo_ids=COALESCE((SELECT array_agg(link.photo_id ORDER BY link.photo_id) FROM store_issue_photos link WHERE link.issue_id=i.id),'{}'::uuid[]);
CREATE TABLE operational_request_photos (
  request_id uuid NOT NULL REFERENCES operational_requests(id) ON DELETE RESTRICT,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  PRIMARY KEY(request_id,photo_id)
);
INSERT INTO operational_request_photos(request_id,photo_id)
SELECT r.id, p.id FROM operational_requests r CROSS JOIN LATERAL unnest(r.attachment_photo_ids) evidence(photo_id)
JOIN photos p ON p.id=evidence.photo_id AND p.store_id=r.store_id
ON CONFLICT DO NOTHING;
UPDATE operational_requests r SET attachment_photo_ids=COALESCE((SELECT array_agg(link.photo_id ORDER BY link.photo_id) FROM operational_request_photos link WHERE link.request_id=r.id),'{}'::uuid[]);
