/*
  # Add Fund Position Detail and Hold Tables

  1. New Tables
    - `fund_position_detail`: Stores detailed bank information for each fund position
      - `id` (uuid, primary key)
      - `fund_position_id` (uuid, foreign key to fund_position)
      - `bank_name` (text)
      - `balance` (bigint)
      - `fund_applied` (bigint)
      - `net_balance` (bigint)
      - `non_validated_deposit` (bigint)
      - `grand_balance` (bigint)
      - `created_at` (timestamptz)
    
    - `fund_position_hold`: Stores collections on hold for each fund position
      - `id` (uuid, primary key)
      - `fund_position_id` (uuid, foreign key to fund_position)
      - `hold_date` (date)
      - `cheque_number` (text)
      - `client_bank` (text)
      - `client_name` (text)
      - `facture_reference` (text)
      - `amount` (bigint)
      - `deposit_date` (date)
      - `days_remaining` (integer)
      - `created_at` (timestamptz)
  
  2. Modifications
    - Add `deposit_for_day` and `payment_for_day` columns to `fund_position` table
  
  3. Security
    - Enable RLS on new tables
    - Add policies for authenticated users
*/

-- Enhance the fund_position table with additional fields
ALTER TABLE fund_position 
ADD COLUMN IF NOT EXISTS deposit_for_day BIGINT,
ADD COLUMN IF NOT EXISTS payment_for_day BIGINT;

-- Create detailed fund position by bank table
CREATE TABLE IF NOT EXISTS fund_position_detail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_position_id UUID REFERENCES fund_position(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  balance BIGINT NOT NULL,
  fund_applied BIGINT,
  net_balance BIGINT NOT NULL,
  non_validated_deposit BIGINT,
  grand_balance BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create table for collections on hold
CREATE TABLE IF NOT EXISTS fund_position_hold (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_position_id UUID REFERENCES fund_position(id) ON DELETE CASCADE,
  hold_date DATE NOT NULL,
  cheque_number TEXT,
  client_bank TEXT,
  client_name TEXT NOT NULL,
  facture_reference TEXT,
  amount BIGINT NOT NULL,
  deposit_date DATE,
  days_remaining INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_fund_position_detail_fund_id ON fund_position_detail(fund_position_id);
CREATE INDEX IF NOT EXISTS idx_fund_position_hold_fund_id ON fund_position_hold(fund_position_id);
CREATE INDEX IF NOT EXISTS idx_fund_position_detail_bank ON fund_position_detail(bank_name);
CREATE INDEX IF NOT EXISTS idx_fund_position_hold_client ON fund_position_hold(client_name);

-- Enable Row Level Security
ALTER TABLE fund_position_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_position_hold ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Allow authenticated users to view fund_position_detail" 
  ON fund_position_detail FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert fund_position_detail" 
  ON fund_position_detail FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to view fund_position_hold" 
  ON fund_position_hold FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert fund_position_hold" 
  ON fund_position_hold FOR INSERT TO authenticated WITH CHECK (true);