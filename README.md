# Supabase Database & Storage Setup Guide

Follow these quick steps to connect your Supabase database and storage bucket to the Warehouse ERP:

## 1. Create or Open Your Supabase Project
1. Log in to [Supabase](https://supabase.com).
2. Create a new project (or use your existing project).

## 2. Execute SQL Schema
1. In your Supabase project dashboard, navigate to the **SQL Editor** tab (icon on the left sidebar).
2. Click **New query**.
3. Copy and paste the entire contents of [`schema.sql`](schema.sql).
4. Click **Run** (green button).
5. All three tables (`sales_team`, `warehouse_dispatches`, `warehouse_cartons`) and the `warehouse-photos` storage bucket with public access policies will be created immediately.

## 3. Retrieve Project URL & Anon Key
1. In your Supabase dashboard, go to **Project Settings** (gear icon) -> **API**.
2. Copy the **Project URL** (e.g. `https://xyzcompany.supabase.co`).
3. Copy the **anon public API Key** (e.g. `eyJhbGciOi...`).

## 4. Connect in Warehouse ERP
1. Open the Warehouse ERP in your browser.
2. Click the **Settings** tab.
3. Paste the **Supabase URL** and **Anon Key**, then click **Save & Test Connection**.
4. The status pill will immediately switch from `Demo Mode` to `Connected (Live Supabase)`.
