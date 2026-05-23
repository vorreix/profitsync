/*
  # ProfitSync Core Tables

  1. New Tables
    - `clients`
      - `id` (uuid, primary key)
      - `name` (text, required)
      - `company` (text, optional)
      - `email` (text, optional)
      - `phone` (text, optional)
      - `status` (text, active/inactive/archived)
      - `notes` (text, optional)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    - `transactions`
      - `id` (uuid, primary key)
      - `client_id` (uuid, foreign key → clients)
      - `type` (text: 'incoming' or 'outgoing')
      - `amount` (numeric, required)
      - `description` (text, optional)
      - `category` (text, optional)
      - `date` (date, required)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Allow all authenticated users full access (single-user app for now)
    - Anon users get read+write access for demo purposes
*/

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company text DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  status text DEFAULT 'active',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('incoming', 'outgoing')),
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  description text DEFAULT '',
  category text DEFAULT '',
  date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read clients"
  ON clients FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anon insert clients"
  ON clients FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anon update clients"
  ON clients FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon delete clients"
  ON clients FOR DELETE
  TO anon
  USING (true);

CREATE POLICY "Allow anon read transactions"
  ON transactions FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anon insert transactions"
  ON transactions FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anon update transactions"
  ON transactions FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon delete transactions"
  ON transactions FOR DELETE
  TO anon
  USING (true);
