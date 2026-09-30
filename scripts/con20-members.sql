-- CON-20: every live channel membership, one per line — `apply` adds an author to a Folder
-- they never joined before writing their copies there (buzz refuses `not a channel member`).
--
--   scripts/con20-export.sh scripts/con20-members.sql > ~/con20-scratch/members.jsonl
\t on
\a
\pset footer off
select json_build_object('h', m.channel_id, 'pubkey', encode(m.pubkey, 'hex'), 'role', m.role)
from channel_members m join channels c on c.id = m.channel_id
where m.removed_at is null and c.deleted_at is null;
