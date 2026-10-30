# Knowledge base

Milestone 18 provides an internal, store- and role-scoped knowledge base.

## Content model

- `knowledge_categories` stores administrator-managed categories and optional parent categories.
- `knowledge_articles` stores the lifecycle (`draft`, `published`, `archived`), category, visibility targets, and acknowledgement policy.
- `knowledge_article_revisions` stores the editable draft and immutable published revisions. Publishing archives the prior published revision and promotes the draft; editing after publication creates a new draft revision.
- `knowledge_visibility_targets` supports global staff visibility, selected stores, and staff/manager role targets. Managers may only target staff in their own active stores; only administrators may target globally.
- `knowledge_attachments` stores private PDF/JPEG/PNG/WebP metadata linked to a revision. Object keys never leave the API.
- `knowledge_article_quiz_links` is one-directional and can reference only published, authorized quizzes.
- `knowledge_acknowledgments` records employee acknowledgement against a specific published revision and is idempotent.

Content is Markdown only. HTML, scripts, event handlers, unsafe URL schemes, and non-HTTPS Markdown links are rejected. The Admin preview and Mobile renderer implement only the safe subset (headings, lists, emphasis, and HTTPS links); raw HTML is never rendered.

## API boundaries

Management routes are explicit under `/api/v1/management/knowledge`. Staff routes are explicit under `/api/v1/me/knowledge`. The Admin BFF allowlists only the management knowledge prefix and forwards only the existing browser session and CSRF token. Binary attachment responses are private, non-cacheable, and use `nosniff`.

Staff listing, article detail, acknowledgement, and attachment access all enforce the authenticated principal's active role and store scope in the API. Drafts and archived articles are never returned to staff.

## Search and notifications

Published revision title, summary, and body have a PostgreSQL `simple` full-text GIN index. Search combines `plainto_tsquery` with bounded case-insensitive fallback matching for short or mixed-language terms.

Publishing writes a transactional `knowledge.published` domain event. The existing notification router resolves eligible active staff recipients and creates the normal in-app/push notification with a safe `knowledge` deep-link target. Push preference handling continues to use the existing notification preference boundary.

## Verification limits

The automated suite verifies scope, draft exclusion, immutable revision progression, acknowledgement idempotency, HTTP routes, and shared contracts. Physical-device rendering, OS document viewers, and production object storage remain environment-specific checks; no deployment is part of Milestone 18.
