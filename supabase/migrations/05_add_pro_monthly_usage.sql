-- Migration: Add Pro monthly usage tracking columns
-- Purpose: Limit Pro users to 100 diagnoses per month to prevent API abuse

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS pro_monthly_usage integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS pro_usage_reset_at timestamp with time zone;

-- Add comment for documentation
COMMENT ON COLUMN profiles.pro_monthly_usage IS 'Monthly diagnosis count for Pro users (reset every 30 days)';
COMMENT ON COLUMN profiles.pro_usage_reset_at IS 'Timestamp when pro_monthly_usage was last reset';
