-- CON-20: every live event a Ship or Peek conversation read could ask for, one per line —
-- the data `con20-fake-relay.ts` serves to both apps' own readers, before and after the run.
--
--   scripts/con20-export.sh scripts/con20-snapshot.sql > ~/con20-scratch/before.jsonl
--
-- Left out: DM channels (neither reader asks, and they are private) and kind:30078
-- (app-private storage, read state among it).
\t on
\a
\pset footer off
select json_build_object(
  'id', encode(e.id, 'hex'), 'pubkey', encode(e.pubkey, 'hex'),
  'created_at', extract(epoch from e.created_at)::bigint, 'kind', e.kind,
  'tags', e.tags, 'content', e.content, 'sig', encode(e.sig, 'hex'))
from events e
left join channels c on c.id = e.channel_id
where e.deleted_at is null
  and e.kind <> 30078
  and (c.channel_type is null or c.channel_type <> 'dm');
