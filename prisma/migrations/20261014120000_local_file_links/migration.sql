-- Stored file links move from pre-signed Alibaba OSS URLs to permanent TMS links.
--
--   https://<bucket>.<region>.aliyuncs.com/<key>?OSSAccessKeyId=...&Expires=...&Signature=...
--     becomes
--   /api/files/<key>
--
-- The key is kept exactly, so the same file is found on local disk or in the bucket.
-- The old links were signed for one year from upload and never renewed: the first
-- would have stopped working on 12 Feb 2027, and all of them the moment the OSS key
-- changed. The new route (src/app/api/files) checks the session and task access,
-- then serves the file from disk, or hands out a fresh signed bucket link for a file
-- not copied yet.
--
-- Data only - no schema change. Rows already in the new form, and links to anything
-- other than an aliyuncs.com host, are left untouched. The pre-deploy database dump
-- that update.sh takes holds the old values if they are ever needed.

UPDATE "task_attachments"
   SET "fileUrl" = '/api/files/' || substring("fileUrl" from '^https://[^/]+\.aliyuncs\.com/([^?#]+)')
 WHERE "fileUrl" ~ '^https://[^/]+\.aliyuncs\.com/[^?#]+';

UPDATE "comments"
   SET "fileUrl" = '/api/files/' || substring("fileUrl" from '^https://[^/]+\.aliyuncs\.com/([^?#]+)')
 WHERE "fileUrl" ~ '^https://[^/]+\.aliyuncs\.com/[^?#]+';

UPDATE "comments"
   SET "imageUrl" = '/api/files/' || substring("imageUrl" from '^https://[^/]+\.aliyuncs\.com/([^?#]+)')
 WHERE "imageUrl" ~ '^https://[^/]+\.aliyuncs\.com/[^?#]+';

UPDATE "users"
   SET "image" = '/api/files/' || substring("image" from '^https://[^/]+\.aliyuncs\.com/([^?#]+)')
 WHERE "image" ~ '^https://[^/]+\.aliyuncs\.com/[^?#]+';

UPDATE "task_procurements"
   SET "fileUrl" = '/api/files/' || substring("fileUrl" from '^https://[^/]+\.aliyuncs\.com/([^?#]+)')
 WHERE "fileUrl" ~ '^https://[^/]+\.aliyuncs\.com/[^?#]+';

-- Activity history keeps the link of a changed profile photo inside its JSON.
UPDATE "activities"
   SET "metadata" = regexp_replace("metadata"::text,
         'https://[^/"]+\.aliyuncs\.com/([^?"#]+)(\?[^"]*)?', '/api/files/\1', 'g')::jsonb
 WHERE "metadata"::text ~ 'https://[^/"]+\.aliyuncs\.com/';
