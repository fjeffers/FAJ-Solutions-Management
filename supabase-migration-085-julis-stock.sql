-- Migration 085: stock levels for Juli's Studios
--
-- Juli's shop (julisstudio.com, same database) sold from a product list that
-- had no stock figure at all: nothing stopped two people buying the last
-- scrunchie, and nothing told Juli she was running out until an order came in
-- she could not fill.
--
--   stock_quantity      how many are on the shelf right now
--   low_stock_threshold when to warn her ("only 2 left" on the card too)
--   track_stock         off for made-to-order items that never run out
--
-- Existing products are seeded at 10 rather than 0 on purpose: they were live
-- and effectively unlimited, and a default of 0 would have marked the entire
-- shop sold out the moment this shipped.

ALTER TABLE julis_products
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE julis_products SET stock_quantity = 10 WHERE stock_quantity = 0;
