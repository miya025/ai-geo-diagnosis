-- profilesテーブルにstripe_customer_idカラムを追加
alter table profiles add column if not exists stripe_customer_id text;

-- インデックス作成（検索高速化のため）
create index if not exists idx_profiles_stripe_customer_id on profiles(stripe_customer_id);
