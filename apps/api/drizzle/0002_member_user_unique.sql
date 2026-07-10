-- Custom SQL migration file, put your code below! --
CREATE UNIQUE INDEX IF NOT EXISTS member_user_uidx ON member(user_id);