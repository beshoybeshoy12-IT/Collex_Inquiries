-- "Override case status": move a case to any status with a written reason.
-- Granted to the roles that may already delete cases — the closest existing
-- measure of "trusted with the whole case" — so no role name appears here.
INSERT INTO "permissions" ("code", "category", "labelAr", "labelEn", "sortOrder")
VALUES ('investigations.override_status', 'investigations', 'نقل استثنائي لحالة التحقيق', 'Override case status', 902)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "roleId", 'investigations.override_status' FROM "role_permissions"
WHERE "permissionCode" = 'investigations.delete'
ON CONFLICT DO NOTHING;
