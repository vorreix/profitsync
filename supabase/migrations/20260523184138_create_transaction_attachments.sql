/*
  # Create Transaction Attachments Table

  1. New Tables
    - `transaction_attachments`
      - `id` (uuid, primary key)
      - `transaction_id` (uuid, foreign key to transactions)
      - `file_name` (text)
      - `file_url` (text)
      - `file_size` (integer, in bytes)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on `transaction_attachments` table
    - Add policy for all authenticated users (simplified for demo)
*/

CREATE TABLE IF NOT EXISTS transaction_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE transaction_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage attachments"
  ON transaction_attachments
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);