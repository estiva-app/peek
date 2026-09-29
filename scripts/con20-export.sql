-- CON-20: the input to scripts/con20-kind9-to-1111.ts, one signed event per line.
--
--   scripts/con20-export.sh > ~/con20-scratch/export.jsonl
--
-- Read from the database rather than the relay because the agent reads 68 of
-- production's Folders and a comment can be in any of them. Every live
-- kind:9 in a channel, every live kind:1111, and every live event of any kind
-- that names one of them by `e` or `q`. The script recomputes each id from
-- these fields, so a row that does not round-trip is refused, not migrated.
\t on
\a
\pset footer off
create temp table conv as
  select id from events where deleted_at is null and ((kind = 9 and channel_id is not null) or kind = 1111);
create temp table conv_hex as select encode(id, 'hex') id from conv;
create index on conv_hex (id);
select json_build_object(
  'id', encode(e.id, 'hex'), 'pubkey', encode(e.pubkey, 'hex'),
  'created_at', extract(epoch from e.created_at)::bigint, 'kind', e.kind,
  'tags', e.tags, 'content', e.content, 'sig', encode(e.sig, 'hex'))
from events e
where e.deleted_at is null
  and (e.id in (select id from conv)
       or (e.kind <> 5 and exists (select 1 from jsonb_array_elements(e.tags) t
                                   where t->>0 in ('e', 'q') and t->>1 in (select id from conv_hex))));
