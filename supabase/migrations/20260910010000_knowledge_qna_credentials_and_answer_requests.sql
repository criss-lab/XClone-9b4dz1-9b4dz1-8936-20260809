create table if not exists public.knowledge_questions (
  id uuid primary key default gen_random_uuid(), author_id uuid not null references auth.users(id) on delete cascade,
  community_id uuid references public.communities(id) on delete set null, title text not null check (char_length(trim(title)) between 8 and 500), details text, topic text,
  status text not null default 'published' check (status in ('published','draft','closed','moderation')), accepted_answer_id uuid, view_count bigint not null default 0, answer_count bigint not null default 0,
  follower_count bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.knowledge_answers (
  id uuid primary key default gen_random_uuid(), question_id uuid not null references public.knowledge_questions(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade, body text not null check (char_length(trim(body)) between 1 and 30000), source_links jsonb not null default '[]'::jsonb,
  upvote_count bigint not null default 0, downvote_count bigint not null default 0, is_accepted boolean not null default false,
  status text not null default 'published' check (status in ('published','draft','moderation','collapsed')), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace
    where c.conname='knowledge_questions_accepted_answer_fk' and n.nspname='public' and r.relname='knowledge_questions'
  ) then
    alter table public.knowledge_questions add constraint knowledge_questions_accepted_answer_fk foreign key (accepted_answer_id) references public.knowledge_answers(id) on delete set null;
  end if;
end $$;

create table if not exists public.knowledge_answer_votes (answer_id uuid not null references public.knowledge_answers(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, value smallint not null check (value in (-1,1)), created_at timestamptz not null default now(), primary key(answer_id,user_id));
create table if not exists public.knowledge_question_follows (question_id uuid not null references public.knowledge_questions(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(), primary key(question_id,user_id));
create table if not exists public.knowledge_answer_requests (
 id uuid primary key default gen_random_uuid(), question_id uuid not null references public.knowledge_questions(id) on delete cascade,
 requester_id uuid not null references auth.users(id) on delete cascade, target_user_id uuid not null references auth.users(id) on delete cascade,
 message text, status text not null default 'pending' check(status in('pending','accepted','declined','answered','cancelled')),
 created_at timestamptz not null default now(), responded_at timestamptz, unique(question_id,target_user_id,requester_id)
);
create table if not exists public.knowledge_credentials (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 topic text not null check(char_length(trim(topic)) between 2 and 120), claim text not null check(char_length(trim(claim)) between 2 and 500), evidence_url text,
 verification_status text not null default 'self_declared' check(verification_status in('self_declared','pending','verified','rejected')),
 verified_by uuid references auth.users(id) on delete set null, verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.knowledge_question_submissions (
 id uuid primary key default gen_random_uuid(), question_id uuid not null references public.knowledge_questions(id) on delete cascade,
 community_id uuid not null references public.communities(id) on delete cascade, submitted_by uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in('pending','approved','rejected')), feedback text, reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists knowledge_questions_feed_idx on public.knowledge_questions(status,created_at desc);
create index if not exists knowledge_questions_topic_idx on public.knowledge_questions(topic,created_at desc);
create index if not exists knowledge_questions_community_idx on public.knowledge_questions(community_id,created_at desc);
create index if not exists knowledge_answers_question_idx on public.knowledge_answers(question_id,upvote_count desc,created_at asc);
create index if not exists knowledge_requests_target_idx on public.knowledge_answer_requests(target_user_id,status,created_at desc);
create index if not exists knowledge_credentials_user_topic_idx on public.knowledge_credentials(user_id,topic);
create index if not exists knowledge_submissions_queue_idx on public.knowledge_question_submissions(community_id,status,created_at);
alter table public.knowledge_questions enable row level security;
alter table public.knowledge_answers enable row level security;
alter table public.knowledge_answer_votes enable row level security;
alter table public.knowledge_question_follows enable row level security;
alter table public.knowledge_answer_requests enable row level security;
alter table public.knowledge_credentials enable row level security;
alter table public.knowledge_question_submissions enable row level security;

drop policy if exists "published questions are public" on public.knowledge_questions;
create policy "published questions are public" on public.knowledge_questions for select using(status='published' or author_id=auth.uid());
drop policy if exists "users create questions" on public.knowledge_questions;
create policy "users create questions" on public.knowledge_questions for insert with check(auth.uid()=author_id);
drop policy if exists "authors update questions" on public.knowledge_questions;
create policy "authors update questions" on public.knowledge_questions for update using(auth.uid()=author_id) with check(auth.uid()=author_id);
drop policy if exists "published answers are public" on public.knowledge_answers;
create policy "published answers are public" on public.knowledge_answers for select using(status='published' or author_id=auth.uid());
drop policy if exists "users create answers" on public.knowledge_answers;
create policy "users create answers" on public.knowledge_answers for insert with check(auth.uid()=author_id);
drop policy if exists "authors update answers" on public.knowledge_answers;
create policy "authors update answers" on public.knowledge_answers for update using(auth.uid()=author_id) with check(auth.uid()=author_id);
drop policy if exists "users manage answer votes" on public.knowledge_answer_votes;
create policy "users manage answer votes" on public.knowledge_answer_votes for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "users manage question follows" on public.knowledge_question_follows;
create policy "users manage question follows" on public.knowledge_question_follows for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "request participants read requests" on public.knowledge_answer_requests;
create policy "request participants read requests" on public.knowledge_answer_requests for select using(auth.uid()=requester_id or auth.uid()=target_user_id);
drop policy if exists "users send requests" on public.knowledge_answer_requests;
create policy "users send requests" on public.knowledge_answer_requests for insert with check(auth.uid()=requester_id);
drop policy if exists "request participants update" on public.knowledge_answer_requests;
create policy "request participants update" on public.knowledge_answer_requests for update using(auth.uid()=requester_id or auth.uid()=target_user_id) with check(auth.uid()=requester_id or auth.uid()=target_user_id);
drop policy if exists "credentials are public" on public.knowledge_credentials;
create policy "credentials are public" on public.knowledge_credentials for select using(true);
drop policy if exists "users manage credentials" on public.knowledge_credentials;
create policy "users manage credentials" on public.knowledge_credentials for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "submitters and reviewers read submissions" on public.knowledge_question_submissions;
create policy "submitters and reviewers read submissions" on public.knowledge_question_submissions for select using(auth.uid()=submitted_by or exists(select 1 from public.community_members cm where cm.community_id=knowledge_question_submissions.community_id and cm.user_id=auth.uid() and cm.role in('owner','admin','moderator')));
drop policy if exists "members submit questions" on public.knowledge_question_submissions;
create policy "members submit questions" on public.knowledge_question_submissions for insert with check(auth.uid()=submitted_by and exists(select 1 from public.community_members cm where cm.community_id=knowledge_question_submissions.community_id and cm.user_id=auth.uid() and cm.status='active'));
drop policy if exists "reviewers update submissions" on public.knowledge_question_submissions;
create policy "reviewers update submissions" on public.knowledge_question_submissions for update using(exists(select 1 from public.community_members cm where cm.community_id=knowledge_question_submissions.community_id and cm.user_id=auth.uid() and cm.role in('owner','admin','moderator'))) with check(exists(select 1 from public.community_members cm where cm.community_id=knowledge_question_submissions.community_id and cm.user_id=auth.uid() and cm.role in('owner','admin','moderator')));

create or replace function public.knowledge_recount_answer_stats() returns trigger language plpgsql security definer set search_path=public as $$ declare qid uuid; begin qid:=coalesce(new.question_id,old.question_id); update public.knowledge_questions set answer_count=(select count(*) from public.knowledge_answers where question_id=qid and status='published'),updated_at=now() where id=qid; return coalesce(new,old); end; $$;
drop trigger if exists trg_knowledge_answer_stats on public.knowledge_answers;
create trigger trg_knowledge_answer_stats after insert or update or delete on public.knowledge_answers for each row execute function public.knowledge_recount_answer_stats();
create or replace function public.knowledge_set_accepted_answer(p_question_id uuid,p_answer_id uuid) returns void language plpgsql security invoker as $$ begin
  if not exists(select 1 from public.knowledge_questions where id=p_question_id and author_id=auth.uid()) then raise exception 'Only the question author can accept an answer'; end if;
  if not exists(select 1 from public.knowledge_answers where id=p_answer_id and question_id=p_question_id and status='published') then raise exception 'Answer does not belong to this question'; end if;
  update public.knowledge_answers set is_accepted=false where question_id=p_question_id;
  update public.knowledge_answers set is_accepted=true where id=p_answer_id;
  update public.knowledge_questions set accepted_answer_id=p_answer_id,status='closed',updated_at=now() where id=p_question_id;
end; $$;
grant execute on function public.knowledge_set_accepted_answer(uuid,uuid) to authenticated;
