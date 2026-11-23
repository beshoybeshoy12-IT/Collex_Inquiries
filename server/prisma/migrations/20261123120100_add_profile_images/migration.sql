-- The signed-in user's own profile photo and cover image, as storage keys.
ALTER TABLE "users" ADD COLUMN     "avatarKey" TEXT,
ADD COLUMN     "coverKey" TEXT;
