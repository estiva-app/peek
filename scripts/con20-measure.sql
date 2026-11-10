-- CON-5 step 1: the scope of migrating comment-shaped kind:9 to kind:1111.
-- A comment-shaped kind:9 is (a) a legacy comment root: no `e`, an `a` its body does not name
-- (SPEC §6.4 table row 4), or (b) a kind:9 reply whose thread root is (a) or a kind:1111.
-- Chat (a kind:9 with no such anchor) is out of scope: SPEC §6.7 keeps chat as kind:9.
\pset footer off
create temp table k9 as
  select encode(id,'hex') id, encode(pubkey,'hex') pk, created_at, tags, content, channel_id
  from events where kind = 9 and deleted_at is null;
create temp table k1111 as
  select encode(id,'hex') id from events where kind = 1111 and deleted_at is null;
create temp table roots9 as
  select k.* from k9 k
  where not exists (select 1 from jsonb_array_elements(k.tags) t where t->>0 = 'e')
    and exists (select 1 from jsonb_array_elements(k.tags) t
                where t->>0 = 'a' and position(t->>1 in k.content) = 0);
-- position() on the raw address is a proxy for "the body names it": a body names an
-- address by naddr, never raw, so this over-counts roots. Refined below by the naddr test.
create temp table replies9 as
  select distinct k.*, coalesce((select t->>1 from jsonb_array_elements(k.tags) t where t->>0='e' and t->>3='root' limit 1),
                                (select t->>1 from jsonb_array_elements(k.tags) t where t->>0='e' limit 1)) thread
  from k9 k where exists (select 1 from jsonb_array_elements(k.tags) t where t->>0 = 'e');

\echo '== comment-shaped kind:9 roots (a not named raw in body), and how many bodies hold any naddr'
select count(*) roots, count(*) filter (where content like '%nostr:naddr%') with_naddr_in_body from roots9;
\echo '== by root a kind'
select split_part((select t->>1 from jsonb_array_elements(tags) t where t->>0='a' limit 1), ':', 1) a_kind, count(*) from roots9 group by 1;
\echo '== kind:9 replies, by what their thread root is'
select case when r.thread in (select id from roots9) then 'legacy 9 comment root'
            when r.thread in (select id from k1111) then '1111 comment root'
            when r.thread in (select id from k9) then 'chat 9 root'
            else 'root not on relay (deleted/absent)' end root_is, count(*)
from replies9 r group by 1 order by 2 desc;
\echo '== authors of the comment-shaped set (roots + replies to 9-comment/1111 roots)'
select left(pk, 8) author, count(*) from (
  select pk from roots9
  union all select pk from replies9 where thread in (select id from roots9) or thread in (select id from k1111)) x
group by 1 order by 2 desc;
\echo '== what points at the comment-shaped set: reactions, edits, resolutions, 1111 replies (by e)'
with ids as (select id from roots9 union select id from replies9 where thread in (select id from roots9) or thread in (select id from k1111))
select e.kind, count(distinct e.id) from events e, jsonb_array_elements(e.tags) t
where e.deleted_at is null and t->>0 = 'e' and t->>1 in (select id from ids) and e.kind in (7, 40003, 9101, 1111, 9)
group by 1 order by 1;
\echo '== bodies anywhere that quote an event by nevent/note (links that would break on a new id)'
select count(*) from events where deleted_at is null and kind in (9, 1111, 30850, 30851, 30840) and (content like '%nostr:nevent%' or content like '%nostr:note1%');
\echo '== oldest / newest legacy root'
select min(created_at), max(created_at) from roots9;
\echo '== chat kind:9 that stays (no e, no unnamed a) and chat replies'
select count(*) from k9 where id not in (select id from roots9) and not exists (select 1 from jsonb_array_elements(tags) t where t->>0='e');
