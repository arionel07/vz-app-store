ALTER TABLE store_issues
  ADD COLUMN create_idempotency_key text,
  ADD COLUMN create_request_hash text;
CREATE UNIQUE INDEX store_issues_reporter_idempotency_unique
  ON store_issues (reporter_id, create_idempotency_key);

ALTER TABLE operational_requests
  ADD COLUMN create_idempotency_key text,
  ADD COLUMN create_request_hash text;
CREATE UNIQUE INDEX operational_requests_requester_idempotency_unique
  ON operational_requests (requester_id, create_idempotency_key);
