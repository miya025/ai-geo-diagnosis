-- =====================================================
-- AI GEO Diagnosis - Supabase Database Schema
-- =====================================================
-- Supabase SQL Editor で実行してください

-- =====================================================
-- 1. profiles テーブル（ユーザー管理）
-- =====================================================
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  is_premium boolean default false,
  free_credits int default 3,
  credits_reset_at timestamp with time zone default now(),
  language text default 'ja',
  created_at timestamp with time zone default now()
);

-- RLS (Row Level Security) を有効化
alter table profiles enable row level security;

-- ユーザーは自分のプロフィールのみ閲覧可能
create policy "Users can view own profile" on profiles
  for select using (auth.uid() = id);

-- ユーザーは自分のプロフィールのみ更新可能
create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id);


-- =====================================================
-- 2. Trigger: ユーザー登録時に profiles 自動作成
-- 30日ローリング制限: credits_reset_atを登録日に設定し、
-- アプリ側で30日経過チェック→リセットを行う
-- =====================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, free_credits, is_premium, language, credits_reset_at)
  values (new.id, 3, false, 'ja', now());
  return new;
end;
$$ language plpgsql security definer;

-- 既存のトリガーがあれば削除
drop trigger if exists on_auth_user_created on auth.users;

-- トリガー作成
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- =====================================================
-- 3. analysis_results テーブル（キャッシュ）
-- =====================================================
create table if not exists analysis_results (
  id uuid default gen_random_uuid() primary key,
  url_hash text not null,
  content_hash text not null,
  language text default 'ja',  -- 言語（ja/en）
  overall_score int,
  detail_scores jsonb,
  advice_data jsonb,
  created_at timestamp with time zone default now()
);

-- インデックス（高速検索用）
create index if not exists idx_analysis_url_hash on analysis_results(url_hash);
create index if not exists idx_analysis_content_hash on analysis_results(content_hash);

-- RLS（誰でも読み取り可、挿入は認証済みユーザーのみ）
alter table analysis_results enable row level security;

create policy "Anyone can read analysis results" on analysis_results
  for select using (true);

create policy "Authenticated users can insert" on analysis_results
  for insert with check (auth.uid() is not null);


-- =====================================================
-- 4. マイグレーション用SQL（既存DBへの追加）
-- =====================================================
-- 既存のanalysis_resultsテーブルにlanguage列を追加する場合:
-- alter table analysis_results add column if not exists language text default 'ja';
