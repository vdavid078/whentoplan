-- Run this in your Supabase SQL editor

create table if not exists week_comments (
  id uuid default gen_random_uuid() primary key,
  user_name text not null,
  week_start text not null,  -- format: "YYYY-MM-DD" (Monday of that week)
  comment text not null,
  created_at timestamptz default now()
);

create unique index if not exists week_comments_user_week_unique
  on week_comments(user_name, week_start);

alter table week_comments enable row level security;

create policy "Anyone can read comments"
  on week_comments for select using (true);

create policy "Anyone can insert comments"
  on week_comments for insert with check (true);

create policy "Anyone can update comments"
  on week_comments for update using (true);

create policy "Anyone can delete comments"
  on week_comments for delete using (true);

alter publication supabase_realtime add table week_comments;
