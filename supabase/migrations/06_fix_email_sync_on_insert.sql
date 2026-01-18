-- =====================================================
-- profilesのemail同期を新規ユーザー作成時(INSERT)にも対応させる
-- =====================================================

-- 方法1: handle_new_user関数を上書き（emailも含めてINSERTするように修正）
-- 既存のhandle_new_user関数を修正して、profiles作成時にemailも挿入する
create or replace function public.handle_new_user()
returns trigger as $$
declare
  user_email text;
begin
  -- emailを取得（通常のemailフィールド、なければraw_user_meta_dataから）
  user_email := coalesce(
    new.email,
    new.raw_user_meta_data->>'email'
  );
  
  insert into public.profiles (id, email, is_premium, free_credits, created_at)
  values (
    new.id,
    user_email,
    false,
    3,
    now()
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, public.profiles.email);
  return new;
end;
$$ language plpgsql security definer;

-- トリガーを再作成（既存のものがあれば上書き）
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 方法2: INSERT時にもemail同期するトリガーを追加（別アプローチとしてのバックアップ）
-- auth.usersにINSERT後、profilesに対応レコードがあればemailを更新
create or replace function public.sync_user_email_on_insert()
returns trigger as $$
declare
  user_email text;
begin
  -- emailを取得（通常のemailフィールド、なければraw_user_meta_dataから）
  user_email := coalesce(
    new.email,
    new.raw_user_meta_data->>'email'
  );
  
  -- profilesが既に存在する場合（別トリガーで作成済み）emailを同期
  update public.profiles
  set email = user_email
  where id = new.id and email is null;
  return new;
end;
$$ language plpgsql security definer;

-- INSERTトリガー（handle_new_userの後に実行）
drop trigger if exists on_auth_user_created_sync_email on auth.users;
create trigger on_auth_user_created_sync_email
  after insert on auth.users
  for each row execute function public.sync_user_email_on_insert();

-- =====================================================
-- 既存ユーザーのemailを一括更新（過去にNULLのまま登録されたユーザー用）
-- raw_user_meta_dataからも取得を試みる
-- =====================================================
update profiles p
set email = coalesce(u.email, u.raw_user_meta_data->>'email')
from auth.users u
where p.id = u.id and p.email is null;

-- 確認用：emailがNULLのprofilesが残っていないかチェック
-- select count(*) from profiles where email is null;
