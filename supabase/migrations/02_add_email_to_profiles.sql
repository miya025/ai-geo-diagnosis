-- profilesテーブルにemailカラムを追加
alter table profiles add column if not exists email text;

-- 既存のデータを更新するための関数を作成（権限があれば実行される）
-- 注意: auth.usersからデータを取得するには権限が必要な場合がありますが、
-- Supabaseのデフォルト設定ではpostgresロールなどで実行すれば可能です。
-- ここでは、今後作成されるユーザーのためにTriggerを作成します。

-- Email同期用の関数
create or replace function public.handle_new_user_email()
returns trigger as $$
begin
  update public.profiles
  set email = new.email
  where id = new.id;
  return new;
end;
$$ language plpgsql security definer;

-- Triggerを作成（auth.usersの変更を検知）
-- 注意: handle_new_userは通常insert時に走るが、emailの変更updateにも対応させるなら以下
-- しかし、今回はシンプルにprofiles作成時やemail変更時を考慮。
-- 既存のhandle_new_userトリガー（もしあれば）とは別に、
-- profilesテーブルへの挿入/更新時にemailを同期するのではなく、
-- auth.users側の変更をprofilesに反映させるのが正しい方向。

-- 1. 新規ユーザー作成時に public.handle_new_user() が走って profiles が作られると仮定。
--    その `handle_new_user` 関数（既存のもの）を修正して email も insert するのがベストだが、
--    既存の関数が見えないため、ここでは「auth.users が更新されたら profiles の email も更新する」トリガーを追加検討。
--    ただし、SupabaseのDashboard等で作った既存トリガーと競合しないよう注意。

-- 最も安全な策:
-- profilesテーブルにemailカラムを追加し、
-- アプリケーション側から都度保存するか、もしくは以下のようなトリガーを追加。

-- auth.users の insert/update 時に profiles.email を更新するトリガー
drop trigger if exists on_auth_user_created_or_updated_email on auth.users;

create or replace function public.sync_user_email()
returns trigger as $$
begin
  -- プロフィールが存在すれば更新、なければ何もしない（プロファイル作成トリガーに任せる）
  update public.profiles
  set email = new.email
  where id = new.id;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_updated_email
  after update on auth.users
  for each row execute procedure public.sync_user_email();

-- 新規作成時（既存のhandle_new_userトリガーでemailが入らない場合用）にも更新をかけたいが、
-- 既存トリガーとの順序が不明なため、今回は update のみに絞るか、
-- あるいはアプリケーション側（API）で補完するアプローチも併用する。
-- 今回の要件「手動プラン変更のため」には、DBにあればベストだが、Stripeに渡るのが最優先。
-- DB同期は「できれば」レベルで安全策をとる。

-- 補足: 既存データへのバックフィル（ワンショット実行）
-- do $$
-- begin
--   update public.profiles p
--   set email = u.email
--   from auth.users u
--   where p.id = u.id and p.email is null;
-- end $$;
