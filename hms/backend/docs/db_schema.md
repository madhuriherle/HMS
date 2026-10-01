# HMS MMA — Database Schema Reference

Generated from the SQLAlchemy models (`python scripts/dump_db_schema.py`).
Re-run after any migration to refresh.

Every table also carries the audit columns: created_at, created_by, deleted_at, deleted_by, is_deleted, updated_at, updated_by.

## `affiliation_contacts`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `affiliation_id` | BIGINT | FK->affiliations.id NOT NULL |
| `name` | VARCHAR(150) | NOT NULL |
| `mobile` | VARCHAR(20) | - |
| `email` | VARCHAR(191) | - |
| `designation` | VARCHAR(100) | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `affiliation_magazine_settings`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `affiliation_id` | BIGINT | FK->affiliations.id NOT NULL |
| `enabled` | BOOLEAN | NOT NULL |
| `address_override` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `affiliations`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `group_name` | VARCHAR(255) | NOT NULL |
| `contact_person` | VARCHAR(150) | - |
| `contact_number` | VARCHAR(20) | - |
| `address` | TEXT | - |
| `magazine_enabled` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `app_notification_reads`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `notification_id` | BIGINT | FK->app_notifications.id NOT NULL |
| `user_id` | BIGINT | FK->users.id NOT NULL |
| `read_at` | DATETIME | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |
| | | UNIQUE INDEX `UNIQUE uq_app_notification_reads_active` (notification_id,user_id) |

## `app_notifications`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `user_id` | BIGINT | FK->users.id |
| `member_id` | BIGINT | FK->members.id |
| `title` | VARCHAR(200) | NOT NULL |
| `body` | TEXT | NOT NULL |
| `source` | VARCHAR(50) | NOT NULL |
| `data` | JSON | - |
| `sent_at` | DATETIME | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `approval_actions`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `entity_type` | VARCHAR(50) | NOT NULL |
| `entity_id` | BIGINT | NOT NULL |
| `action` | VARCHAR(50) | NOT NULL |
| `notes` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `approval_requests`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `module` | VARCHAR(80) | NOT NULL |
| `action` | VARCHAR(20) | NOT NULL |
| `entity_type` | VARCHAR(100) | NOT NULL |
| `entity_id` | BIGINT | - |
| `permission_code` | VARCHAR(120) | NOT NULL |
| `payload` | JSON | - |
| `requested_by` | BIGINT | FK->users.id NOT NULL |
| `status` | VARCHAR(20) | NOT NULL |
| `reviewed_by` | BIGINT | FK->users.id |
| `reviewed_at` | DATETIME | - |
| `review_note` | TEXT | - |
| `executed_at` | DATETIME | - |
| `error` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `approval_workflows`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `workflow_name` | VARCHAR(100) | NOT NULL |
| `steps_config` | JSON | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `associate_magazine_settings`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `associate_id` | BIGINT | FK->associates.id NOT NULL |
| `enabled` | BOOLEAN | NOT NULL |
| `address_override` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `associates`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `name` | VARCHAR(150) | NOT NULL |
| `organization` | VARCHAR(255) | - |
| `mobile` | VARCHAR(20) | - |
| `email` | VARCHAR(191) | - |
| `address` | TEXT | - |
| `magazine_enabled` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `committee_categories`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `name_en` | VARCHAR(150) | NOT NULL |
| `name_kn` | VARCHAR(200) | - |
| `display_on_website` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `committee_member_links`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `committee_member_id` | BIGINT | FK->committee_members.id NOT NULL |
| `hms_member_id` | BIGINT | FK->members.id NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `committee_members`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `category_id` | BIGINT | FK->committee_categories.id NOT NULL |
| `subcategory_id` | BIGINT | FK->committee_subcategories.id |
| `term_id` | BIGINT | FK->committee_terms.id |
| `member_name` | VARCHAR(150) | NOT NULL |
| `designation` | VARCHAR(100) | - |
| `display_on_website` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `committee_subcategories`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `category_id` | BIGINT | FK->committee_categories.id NOT NULL |
| `name_en` | VARCHAR(150) | NOT NULL |
| `name_kn` | VARCHAR(200) | - |
| `display_on_website` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `committee_terms`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `term_name` | VARCHAR(100) | NOT NULL |
| `start_date` | VARCHAR(20) | - |
| `end_date` | VARCHAR(20) | - |
| `is_current` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `deletion_reasons`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `name_en` | VARCHAR(150) | NOT NULL |
| `name_kn` | VARCHAR(200) | - |
| `applies_to` | VARCHAR(10) | - |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `districts`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `state_id` | BIGINT | FK->states.id NOT NULL |
| `name_en` | VARCHAR(100) | NOT NULL |
| `name_kn` | VARCHAR(150) | - |
| `code` | VARCHAR(20) | - |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `document_types`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `code` | VARCHAR(50) | NOT NULL UNIQUE |
| `name_en` | VARCHAR(100) | NOT NULL |
| `name_kn` | VARCHAR(150) | - |
| `is_required` | BOOLEAN | NOT NULL |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `event_attachments`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `event_id` | BIGINT | FK->events.id NOT NULL |
| `file_path` | TEXT | NOT NULL |
| `original_filename` | VARCHAR(255) | NOT NULL |
| `mime_type` | VARCHAR(100) | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `event_member_links`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `event_id` | BIGINT | FK->events.id NOT NULL |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `role` | VARCHAR(100) | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `event_participants`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `event_id` | BIGINT | FK->events.id NOT NULL |
| `participant_name` | VARCHAR(150) | NOT NULL |
| `participant_role` | VARCHAR(100) | - |
| `participant_type` | VARCHAR(20) | NOT NULL |
| `member_id` | BIGINT | FK->members.id |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `events`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `title` | VARCHAR(255) | NOT NULL |
| `description` | TEXT | - |
| `event_date` | DATE | NOT NULL |
| `location` | VARCHAR(255) | - |
| `invitation_file_path` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `file_attachments`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `entity_type` | VARCHAR(50) | NOT NULL |
| `entity_id` | BIGINT | NOT NULL |
| `file_path` | TEXT | NOT NULL |
| `original_filename` | VARCHAR(255) | NOT NULL |
| `mime_type` | VARCHAR(100) | - |
| `uploaded_at` | DATETIME | NOT NULL |
| `uploaded_by` | BIGINT | FK->users.id |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `hms_settings`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `setting_key` | VARCHAR(150) | NOT NULL UNIQUE |
| `setting_value` | JSON | NOT NULL |
| `data_type` | VARCHAR(30) | NOT NULL |
| `description` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `magazine_delivery_batches`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `batch_name` | VARCHAR(100) | NOT NULL |
| `issue_month_year` | VARCHAR(20) | NOT NULL |
| `dispatch_date` | DATE | - |
| `status` | VARCHAR(30) | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `magazine_delivery_pauses`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `subscription_id` | BIGINT | FK->magazine_subscriptions.id NOT NULL |
| `pause_start_date` | DATE | NOT NULL |
| `pause_end_date` | DATE | - |
| `reason` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `magazine_label_batch_items`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `label_batch_id` | BIGINT | FK->magazine_label_batches.id NOT NULL |
| `recipient_type` | VARCHAR(30) | NOT NULL |
| `recipient_id` | BIGINT | NOT NULL |
| `label_address` | TEXT | - |
| `is_return` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `magazine_label_batches`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `batch_name` | VARCHAR(100) | NOT NULL |
| `generation_date` | DATE | NOT NULL |
| `issue_month_year` | VARCHAR(20) | NOT NULL |
| `total_labels` | BIGINT | NOT NULL |
| `filters_applied` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `magazine_returns`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `subscription_id` | BIGINT | FK->magazine_subscriptions.id NOT NULL |
| `issue_month_year` | VARCHAR(20) | NOT NULL |
| `return_date` | DATE | NOT NULL |
| `return_reason` | TEXT | - |
| `follow_up_status` | VARCHAR(30) | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `magazine_subscriptions`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `delivery_status` | VARCHAR(20) | NOT NULL |
| `address_override` | TEXT | - |
| `notes` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `member_activity_logs`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `action` | VARCHAR(50) | NOT NULL |
| `details` | JSON | - |
| `user_id` | BIGINT | FK->users.id |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `member_approval_history`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `action` | VARCHAR(30) | NOT NULL |
| `old_status` | VARCHAR(30) | - |
| `new_status` | VARCHAR(30) | NOT NULL |
| `reason` | TEXT | - |
| `acted_by` | BIGINT | FK->users.id |
| `acted_at` | DATETIME | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `member_deletion_requests`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `requested_by` | BIGINT | FK->users.id NOT NULL |
| `reason` | TEXT | NOT NULL |
| `reason_id` | BIGINT | FK->deletion_reasons.id |
| `deletion_type` | VARCHAR(20) | NOT NULL |
| `status` | VARCHAR(20) | NOT NULL |
| `reviewed_by` | BIGINT | FK->users.id |
| `reviewed_at` | DATETIME | - |
| `review_note` | TEXT | - |
| `executed_at` | DATETIME | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `member_documents`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `document_type_id` | BIGINT | FK->document_types.id NOT NULL |
| `file_path` | TEXT | NOT NULL |
| `original_filename` | VARCHAR(255) | NOT NULL |
| `mime_type` | VARCHAR(100) | - |
| `file_size` | BIGINT | - |
| `verification_status` | VARCHAR(20) | NOT NULL |
| `verified_by` | BIGINT | FK->users.id |
| `verified_at` | DATETIME | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `member_kyc_requests`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `token_hash` | VARCHAR(255) | NOT NULL UNIQUE |
| `sent_to` | VARCHAR(255) | NOT NULL |
| `sent_at` | DATETIME | NOT NULL |
| `expires_at` | DATETIME | NOT NULL |
| `submitted_at` | DATETIME | - |
| `status` | VARCHAR(20) | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `member_memberships`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `membership_type_id` | BIGINT | FK->membership_types.id NOT NULL |
| `price_id` | BIGINT | FK->membership_type_prices.id |
| `membership_number` | VARCHAR(30) | UNIQUE |
| `family_membership_number` | VARCHAR(30) | - |
| `applied_at` | DATETIME | NOT NULL |
| `activated_at` | DATETIME | - |
| `expires_at` | DATETIME | - |
| `status` | VARCHAR(20) | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `member_profile_change_requests`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `requested_by` | BIGINT | FK->users.id |
| `source` | VARCHAR(20) | - |
| `old_values` | JSON | - |
| `new_values` | JSON | NOT NULL |
| `status` | VARCHAR(20) | NOT NULL |
| `reviewed_by` | BIGINT | FK->users.id |
| `reviewed_at` | DATETIME | - |
| `review_note` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `member_profile_history`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `field_name` | VARCHAR(100) | NOT NULL |
| `old_value` | TEXT | - |
| `new_value` | TEXT | - |
| `change_request_id` | BIGINT | FK->member_profile_change_requests.id |
| `changed_by` | BIGINT | FK->users.id |
| `changed_at` | DATETIME | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `member_service_optins`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `service_type_id` | BIGINT | FK->service_types.id NOT NULL |
| `status` | VARCHAR(20) | NOT NULL |
| `opted_at` | DATETIME | NOT NULL |
| `opted_via` | VARCHAR(20) | NOT NULL |
| `linked_type` | VARCHAR(30) | - |
| `linked_id` | BIGINT | - |
| `notes` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |
| | | UNIQUE INDEX `UNIQUE uq_member_service_optin_active` (member_id,service_type_id) |

## `members`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_code` | VARCHAR(30) | UNIQUE |
| `first_name_en` | VARCHAR(100) | NOT NULL |
| `middle_name_en` | VARCHAR(100) | - |
| `last_name_en` | VARCHAR(100) | - |
| `full_name_kn` | VARCHAR(250) | - |
| `gender` | VARCHAR(20) | - |
| `date_of_birth` | DATE | - |
| `father_husband_name` | VARCHAR(150) | - |
| `blood_group` | VARCHAR(10) | - |
| `native_place_id` | BIGINT | - |
| `native_place_text` | VARCHAR(150) | - |
| `qualification_id` | BIGINT | - |
| `qualification_text` | VARCHAR(150) | - |
| `occupation` | VARCHAR(150) | - |
| `aadhaar_number` | VARCHAR(20) | - |
| `whatsapp_number` | VARCHAR(20) | - |
| `login_count` | BIGINT | NOT NULL |
| `mobile` | VARCHAR(20) | - |
| `mobile_country_code` | VARCHAR(5) | NOT NULL |
| `alternate_mobile` | VARCHAR(20) | - |
| `email` | VARCHAR(191) | - |
| `address_line1` | VARCHAR(255) | - |
| `address_line2` | VARCHAR(255) | - |
| `locality` | VARCHAR(150) | - |
| `address_line1_kn` | VARCHAR(255) | - |
| `address_line2_kn` | VARCHAR(255) | - |
| `locality_kn` | VARCHAR(150) | - |
| `pincode_id` | BIGINT | - |
| `state_id` | BIGINT | - |
| `district_id` | BIGINT | - |
| `taluk_id` | BIGINT | - |
| `photo_path` | TEXT | - |
| `referred_by_member_id` | BIGINT | FK->members.id |
| `registration_source` | VARCHAR(20) | NOT NULL |
| `registration_status` | VARCHAR(20) | NOT NULL |
| `approval_status` | VARCHAR(20) | NOT NULL |
| `member_status` | VARCHAR(20) | NOT NULL |
| `approved_by` | BIGINT | FK->users.id |
| `approved_at` | DATETIME | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |
| | | UNIQUE INDEX `UNIQUE uq_members_mobile_active` (mobile) |

## `membership_type_change_requests`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `current_membership_id` | BIGINT | FK->member_memberships.id NOT NULL |
| `requested_type_id` | BIGINT | FK->membership_types.id NOT NULL |
| `requested_price_id` | BIGINT | FK->membership_type_prices.id |
| `reason` | TEXT | - |
| `status` | VARCHAR(20) | NOT NULL |
| `reviewed_by` | BIGINT | FK->users.id |
| `reviewed_at` | DATETIME | - |
| `review_note` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `membership_type_history`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `member_id` | BIGINT | FK->members.id NOT NULL |
| `membership_id` | BIGINT | FK->member_memberships.id NOT NULL |
| `old_type_id` | BIGINT | FK->membership_types.id |
| `new_type_id` | BIGINT | FK->membership_types.id NOT NULL |
| `old_price` | NUMERIC(12, 2) | - |
| `new_price` | NUMERIC(12, 2) | NOT NULL |
| `receipt_id` | BIGINT | FK->receipts.id |
| `changed_by` | BIGINT | FK->users.id |
| `changed_at` | DATETIME | NOT NULL |
| `reason` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `membership_type_prices`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `membership_type_id` | BIGINT | FK->membership_types.id NOT NULL |
| `amount` | NUMERIC(12, 2) | NOT NULL |
| `currency` | CHAR(3) | NOT NULL |
| `effective_from` | DATE | NOT NULL |
| `effective_to` | DATE | - |
| `change_reason` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `membership_types`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `code` | VARCHAR(30) | NOT NULL UNIQUE |
| `name_en` | VARCHAR(100) | NOT NULL |
| `name_kn` | VARCHAR(150) | - |
| `description` | TEXT | - |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `modules`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `code` | VARCHAR(80) | NOT NULL UNIQUE |
| `name_en` | VARCHAR(100) | NOT NULL |
| `name_kn` | VARCHAR(150) | - |
| `description` | TEXT | - |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `native_places`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `name_en` | VARCHAR(100) | NOT NULL |
| `name_kn` | VARCHAR(150) | - |
| `district_id` | BIGINT | FK->districts.id |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `notification_campaigns`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `campaign_name` | VARCHAR(150) | NOT NULL |
| `template_id` | BIGINT | FK->notification_templates.id NOT NULL |
| `target_audience` | VARCHAR(50) | - |
| `scheduled_at` | DATETIME | - |
| `status` | VARCHAR(20) | NOT NULL |
| `source` | VARCHAR(20) | NOT NULL |
| `member_filters` | JSON | - |
| `total_recipients` | BIGINT | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `notification_delivery_logs`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `message_id` | BIGINT | FK->notification_messages.id NOT NULL |
| `status_update` | VARCHAR(50) | NOT NULL |
| `updated_at_provider` | DATETIME | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `notification_import_batches`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `campaign_id` | BIGINT | FK->notification_campaigns.id NOT NULL |
| `file_path` | TEXT | NOT NULL |
| `status` | VARCHAR(50) | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `notification_messages`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `campaign_id` | BIGINT | FK->notification_campaigns.id |
| `member_id` | BIGINT | FK->members.id |
| `recipient_number` | VARCHAR(20) | NOT NULL |
| `message_content` | TEXT | NOT NULL |
| `delivery_status` | VARCHAR(20) | NOT NULL |
| `provider_response` | JSON | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `notification_recipients`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `campaign_id` | BIGINT | FK->notification_campaigns.id NOT NULL |
| `member_id` | BIGINT | FK->members.id |
| `mobile` | VARCHAR(20) | NOT NULL |
| `status` | VARCHAR(20) | NOT NULL |
| `variables` | JSON | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `notification_templates`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `template_name` | VARCHAR(100) | NOT NULL UNIQUE |
| `provider_template_id` | VARCHAR(100) | - |
| `language` | VARCHAR(10) | NOT NULL |
| `content` | TEXT | NOT NULL |
| `purpose` | VARCHAR(50) | NOT NULL |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `number_sequences`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `sequence_type` | VARCHAR(50) | NOT NULL UNIQUE |
| `prefix` | VARCHAR(20) | - |
| `current_value` | BIGINT | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `password_reset_tokens`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `user_id` | BIGINT | FK->users.id NOT NULL |
| `token` | VARCHAR(255) | NOT NULL UNIQUE |
| `expires_at` | DATETIME | NOT NULL |
| `used` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `payment_transactions`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `receipt_id` | BIGINT | FK->receipts.id NOT NULL |
| `gateway_reference` | VARCHAR(255) | - |
| `status` | VARCHAR(50) | NOT NULL |
| `amount` | NUMERIC(12, 2) | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `permissions`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `module` | VARCHAR(80) | NOT NULL |
| `module_id` | BIGINT | FK->modules.id |
| `name` | VARCHAR(100) | NOT NULL |
| `code` | VARCHAR(120) | NOT NULL UNIQUE |
| `description` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `postal_codes`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `pincode` | CHAR(6) | NOT NULL |
| `post_office_name` | VARCHAR(150) | - |
| `state_id` | BIGINT | FK->states.id NOT NULL |
| `district_id` | BIGINT | FK->districts.id NOT NULL |
| `taluk_id` | BIGINT | FK->taluks.id |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `press_media`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `organization_name` | VARCHAR(255) | NOT NULL |
| `reporter_name` | VARCHAR(150) | - |
| `mobile` | VARCHAR(20) | - |
| `email` | VARCHAR(191) | - |
| `address` | TEXT | - |
| `magazine_enabled` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `press_media_magazine_settings`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `press_media_id` | BIGINT | FK->press_media.id NOT NULL |
| `enabled` | BOOLEAN | NOT NULL |
| `address_override` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `qualifications`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `name_en` | VARCHAR(100) | NOT NULL |
| `name_kn` | VARCHAR(150) | - |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `receipt_allocations`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `receipt_id` | BIGINT | FK->receipts.id NOT NULL |
| `member_id` | BIGINT | FK->members.id |
| `associate_id` | BIGINT | FK->associates.id |
| `membership_id` | BIGINT | FK->member_memberships.id |
| `allocated_amount` | NUMERIC(12, 2) | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `receipt_cancellations`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `receipt_id` | BIGINT | FK->receipts.id NOT NULL |
| `cancelled_by` | BIGINT | FK->users.id NOT NULL |
| `reason` | TEXT | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `receipt_items`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `receipt_id` | BIGINT | FK->receipts.id NOT NULL |
| `item_type` | VARCHAR(50) | NOT NULL |
| `description` | TEXT | - |
| `amount` | NUMERIC(12, 2) | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `receipts`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `receipt_number` | VARCHAR(50) | NOT NULL UNIQUE |
| `receipt_date` | DATE | NOT NULL |
| `receipt_type` | VARCHAR(30) | NOT NULL |
| `payer_name` | VARCHAR(200) | - |
| `payment_mode` | VARCHAR(30) | NOT NULL |
| `transaction_reference` | VARCHAR(150) | - |
| `gross_amount` | NUMERIC(12, 2) | NOT NULL |
| `discount_amount` | NUMERIC(12, 2) | NOT NULL |
| `net_amount` | NUMERIC(12, 2) | NOT NULL |
| `payment_status` | VARCHAR(20) | NOT NULL |
| `source` | VARCHAR(20) | NOT NULL |
| `is_renewal` | BOOLEAN | NOT NULL |
| `cheque_number` | VARCHAR(50) | - |
| `cheque_date` | DATE | - |
| `notes` | TEXT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `refresh_tokens`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `user_id` | BIGINT | FK->users.id NOT NULL |
| `token` | VARCHAR(255) | NOT NULL UNIQUE |
| `expires_at` | DATETIME | NOT NULL |
| `device_info` | TEXT | - |
| `ip_address` | VARCHAR(45) | - |
| `revoked` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `refund_transactions`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `receipt_id` | BIGINT | FK->receipts.id NOT NULL |
| `amount` | NUMERIC(12, 2) | NOT NULL |
| `status` | VARCHAR(50) | NOT NULL |
| `refund_reference` | VARCHAR(255) | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `role_permissions`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `role_id` | BIGINT | FK->roles.id NOT NULL |
| `permission_id` | BIGINT | FK->permissions.id NOT NULL |
| `requires_approval` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |
| | | UNIQUE INDEX `UNIQUE uq_role_permissions_active` (role_id,permission_id) |

## `roles`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `name` | VARCHAR(100) | NOT NULL |
| `code` | VARCHAR(50) | NOT NULL UNIQUE |
| `description` | TEXT | - |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `service_types`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `code` | VARCHAR(50) | NOT NULL UNIQUE |
| `name_en` | VARCHAR(100) | NOT NULL |
| `name_kn` | VARCHAR(150) | - |
| `description` | TEXT | - |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `states`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `name_en` | VARCHAR(100) | NOT NULL |
| `name_kn` | VARCHAR(150) | - |
| `code` | VARCHAR(20) | - |
| `country_code` | CHAR(3) | NOT NULL |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `system_error_logs`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `error_message` | TEXT | NOT NULL |
| `stack_trace` | TEXT | - |
| `endpoint` | VARCHAR(255) | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `taluks`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `district_id` | BIGINT | FK->districts.id NOT NULL |
| `name_en` | VARCHAR(100) | NOT NULL |
| `name_kn` | VARCHAR(150) | - |
| `code` | VARCHAR(20) | - |
| `status` | BOOLEAN | NOT NULL |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `user_activity_logs`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `user_id` | BIGINT | FK->users.id |
| `action` | VARCHAR(50) | NOT NULL |
| `entity_type` | VARCHAR(50) | - |
| `entity_id` | BIGINT | - |
| `details` | JSON | - |
| `ip_address` | VARCHAR(45) | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |

## `user_device_tokens`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `user_id` | BIGINT | FK->users.id NOT NULL |
| `device_token` | TEXT | NOT NULL |
| `platform` | VARCHAR(10) | NOT NULL |
| `device_name` | VARCHAR(150) | - |
| `last_used_at` | DATETIME | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |
| | | UNIQUE INDEX `UNIQUE uq_user_device_tokens_active` (user_id,device_token) |

## `user_roles`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `user_id` | BIGINT | FK->users.id NOT NULL |
| `role_id` | BIGINT | FK->roles.id NOT NULL |
| `assigned_by` | BIGINT | FK->users.id |
| `assigned_at` | DATETIME | - |
| `scope_type` | VARCHAR(8) | NOT NULL |
| `scope_id` | BIGINT | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |
| | | UNIQUE INDEX `UNIQUE uq_user_roles_active` (user_id,role_id) |

## `users`

| Column | Type | Flags |
|---|---|---|
| `id` | BIGINT | PK |
| `name` | VARCHAR(150) | NOT NULL |
| `username` | VARCHAR(100) | NOT NULL UNIQUE |
| `email` | VARCHAR(191) | - |
| `mobile` | VARCHAR(20) | - |
| `mobile_country_code` | VARCHAR(5) | NOT NULL |
| `password_hash` | VARCHAR(255) | NOT NULL |
| `user_type` | VARCHAR(30) | NOT NULL |
| `member_id` | BIGINT | - |
| `status` | BOOLEAN | NOT NULL |
| `last_login_at` | DATETIME | - |
| `login_count` | INTEGER | NOT NULL |
| `last_login_method` | VARCHAR(20) | - |
| `created_at` | DATETIME | NOT NULL audit |
| `created_by` | BIGINT | audit |
| `updated_at` | DATETIME | audit |
| `updated_by` | BIGINT | audit |
| `deleted_at` | DATETIME | audit |
| `deleted_by` | BIGINT | audit |
| `is_deleted` | BOOLEAN | NOT NULL audit |
| | | UNIQUE INDEX `UNIQUE ix_users_username` (username) |
