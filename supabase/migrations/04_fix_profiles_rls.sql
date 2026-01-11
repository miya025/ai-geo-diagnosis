-- =====================================================
-- 4. Fix RLS on profiles (Security Fix)
-- =====================================================

-- 以前のポリシー "Users can update own profile" は、
-- is_premium や free_credits も含めて更新可能だったため削除する
drop policy if exists "Users can update own profile" on profiles;

-- 今後は、重要な更新（クレジット消費、プラン変更）は
-- すべてサーバーサイド（Service Role）のAPI経由で行う。

-- もし将来的にフロントエンドから安全なカラム（language等）のみ更新させたい場合は、
-- 別途トリガーを用いたカラム制限や、SECURITY DEFINER関数を用意する。
