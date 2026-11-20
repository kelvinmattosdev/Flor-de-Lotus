export const schemaV1 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('CUSTOMER','OPERATOR')),
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE customers (
  seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL UNIQUE REFERENCES users(id)
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), origin TEXT NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_expires ON sessions(expires_at);
CREATE TABLE categories (
  seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, parent_id TEXT REFERENCES categories(id) CHECK(parent_id IS NULL OR parent_id <> id),
  slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
) STRICT;
CREATE INDEX categories_parent ON categories(parent_id);
CREATE TABLE listings (
  seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL, detail TEXT NOT NULL, description TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('ready','custom')), price INTEGER, compare_at INTEGER,
  variants TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(variants)), reviews TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reviews)),
  state TEXT NOT NULL CHECK(state IN ('DRAFT','PUBLISHED','INACTIVE')), version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  CHECK((mode='custom' AND price IS NULL AND compare_at IS NULL) OR
        (mode='ready' AND price IS NOT NULL AND price BETWEEN 1 AND 10000000 AND
          (compare_at IS NULL OR compare_at BETWEEN price+1 AND 10000000)))
) STRICT;
CREATE INDEX listings_category ON listings(category_id,state);
CREATE TABLE listing_images (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id), position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4),
  width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0), alt TEXT NOT NULL, label TEXT NOT NULL,
  static_src TEXT, static_thumb TEXT, static_srcset TEXT, mime TEXT, bytes BLOB,
  CHECK((bytes IS NOT NULL AND mime IS NOT NULL AND mime IN ('image/png','image/jpeg') AND
    length(bytes) BETWEEN 1 AND 3145728 AND width*height<=4000000 AND
    static_src IS NULL AND static_thumb IS NULL AND static_srcset IS NULL) OR
    (bytes IS NULL AND mime IS NULL AND static_src IS NOT NULL AND static_thumb IS NOT NULL AND static_srcset IS NOT NULL))
) STRICT;
CREATE INDEX listing_images_listing ON listing_images(listing_id,position);
CREATE TABLE coupons (
  seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK(scope IN ('GLOBAL','CATEGORY','PRODUCT')),
  category_id TEXT REFERENCES categories(id), listing_id TEXT REFERENCES listings(id),
  descendants INTEGER NOT NULL CHECK(descendants IN (0,1)),
  minimum INTEGER NOT NULL CHECK(minimum>=0), ceiling INTEGER CHECK(ceiling IS NULL OR (ceiling>0 AND percent>0)),
  percent INTEGER NOT NULL CHECK(percent BETWEEN 0 AND 10000),
  free_shipping INTEGER NOT NULL CHECK(free_shipping IN (0,1)),
  stackable INTEGER NOT NULL CHECK(stackable IN (0,1)), active INTEGER NOT NULL CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  CHECK((scope='GLOBAL' AND category_id IS NULL AND listing_id IS NULL AND descendants=0) OR
    (scope='CATEGORY' AND category_id IS NOT NULL AND listing_id IS NULL) OR
    (scope='PRODUCT' AND listing_id IS NOT NULL AND category_id IS NULL AND descendants=0)),
  CHECK(percent>0 OR free_shipping=1)
) STRICT;
CREATE TABLE coupon_pairs (
  seq INTEGER PRIMARY KEY, first TEXT NOT NULL REFERENCES coupons(id), second TEXT NOT NULL REFERENCES coupons(id),
  rule TEXT NOT NULL CHECK(rule IN ('ALLOW','DENY')), CHECK(first<second), UNIQUE(first,second)
) STRICT;
CREATE INDEX coupon_pairs_second ON coupon_pairs(second);
CREATE TABLE quotes (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), input TEXT NOT NULL CHECK(json_valid(input)),
  fingerprint TEXT NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX quotes_expires ON quotes(expires_at);
CREATE INDEX quotes_customer ON quotes(customer_id);
CREATE TABLE orders (
  seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL REFERENCES customers(id),
  quote_id TEXT NOT NULL UNIQUE, idem_key TEXT NOT NULL, created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDENTE','PROCESSANDO','ENVIADO','ENTREGUE')),
  subtotal INTEGER NOT NULL CHECK(subtotal>0), discount INTEGER NOT NULL CHECK(discount BETWEEN 0 AND subtotal),
  shipping_id TEXT NOT NULL, shipping_name TEXT NOT NULL, shipping INTEGER NOT NULL CHECK(shipping>=0),
  shipping_discount INTEGER NOT NULL CHECK(shipping_discount BETWEEN 0 AND shipping),
  total INTEGER NOT NULL CHECK(total=subtotal-discount+shipping-shipping_discount),
  UNIQUE(customer_id, idem_key)
) STRICT;
CREATE INDEX orders_customer ON orders(customer_id,seq);
CREATE INDEX orders_status ON orders(status,seq);
CREATE TABLE order_items (
  order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL REFERENCES listings(id), variant TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9), name TEXT NOT NULL, unit_price INTEGER NOT NULL CHECK(unit_price>0),
  discount INTEGER NOT NULL CHECK(discount BETWEEN 0 AND quantity*unit_price),
  PRIMARY KEY(order_id,product_id,variant)
) STRICT;
CREATE TABLE order_coupon_snapshots (
  order_id TEXT NOT NULL REFERENCES orders(id), position INTEGER NOT NULL, code TEXT NOT NULL,
  merch_discount INTEGER NOT NULL CHECK(merch_discount>=0), shipping_discount INTEGER NOT NULL CHECK(shipping_discount>=0),
  PRIMARY KEY(order_id,position), UNIQUE(order_id,code)
) STRICT;
CREATE TABLE order_status_events (
  order_id TEXT NOT NULL REFERENCES orders(id), status TEXT NOT NULL CHECK(status IN ('PENDENTE','PROCESSANDO','ENVIADO','ENTREGUE')),
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 3), created_at TEXT NOT NULL,
  PRIMARY KEY(order_id,ordinal), UNIQUE(order_id,status)
) STRICT;
CREATE TABLE purchases (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), created_at TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('PIX_SIMULADO','CARTAO_SIMULADO'))
) STRICT;
`;

export const migrateV1ToV2 = `
ALTER TABLE customers ADD COLUMN nickname TEXT;
ALTER TABLE orders ADD COLUMN recipient_full_name TEXT;
ALTER TABLE quotes ADD COLUMN recipient_binding TEXT;
`;
