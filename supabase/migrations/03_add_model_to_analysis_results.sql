-- analysis_resultsテーブルにmodelカラムを追加
alter table analysis_results add column if not exists model text;

-- 既存のデータはすべて 'claude-haiku-4-5-20251001' (Free model) とみなす（またはNULLのまま）
-- ここでは明確にするため update しておく
update analysis_results set model = 'claude-haiku-4-5-20251001' where model is null;
