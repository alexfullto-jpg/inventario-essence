-- Essence Collection - esquema de base de datos local (SQLite)

CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    business_name TEXT NOT NULL DEFAULT 'Essence Collection',
    business_whatsapp TEXT NOT NULL DEFAULT '',
    frag_percent REAL NOT NULL DEFAULT 50,
    next_folio INTEGER NOT NULL DEFAULT 1,
    recharge_p10 REAL NOT NULL DEFAULT 5000,
    recharge_p30 REAL NOT NULL DEFAULT 15000,
    recharge_p50 REAL NOT NULL DEFAULT 27000,
    alcohol_stock_gr REAL NOT NULL DEFAULT 0,
    alcohol_cost_per_gr REAL NOT NULL DEFAULT 0,
    frasco_f10_stock INTEGER NOT NULL DEFAULT 0,
    frasco_f30_stock INTEGER NOT NULL DEFAULT 0,
    frasco_f50_stock INTEGER NOT NULL DEFAULT 0,
    frasco_f10_cost REAL NOT NULL DEFAULT 0,
    frasco_f30_cost REAL NOT NULL DEFAULT 0,
    frasco_f50_cost REAL NOT NULL DEFAULT 0,
    cuentas_json TEXT NOT NULL DEFAULT '["Efectivo","Nequi","Bancolombia","Nu Bank"]'
);

CREATE TABLE IF NOT EXISTS fragancias (
    codigo TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    genero TEXT NOT NULL DEFAULT 'Unisex',
    p10 REAL NOT NULL DEFAULT 0,
    p30 REAL NOT NULL DEFAULT 0,
    p50 REAL NOT NULL DEFAULT 0,
    stock_gr REAL NOT NULL DEFAULT 0,
    cost_per_gr REAL NOT NULL DEFAULT 0,
    ubicacion TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS otros_productos (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    unidad TEXT NOT NULL DEFAULT 'unidad',
    stock REAL NOT NULL DEFAULT 0,
    costo_unit REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clientes (
    nombre TEXT PRIMARY KEY,
    telefono TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ventas (
    id TEXT PRIMARY KEY,
    folio INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    codigo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    tamano INTEGER NOT NULL,
    cantidad INTEGER NOT NULL,
    precio_unit REAL NOT NULL,
    total REAL NOT NULL,
    frag_used_gr REAL NOT NULL,
    alcohol_used_gr REAL NOT NULL,
    cliente TEXT NOT NULL DEFAULT '',
    cliente_tel TEXT NOT NULL DEFAULT '',
    es_recarga INTEGER NOT NULL DEFAULT 0,
    frag_cost_per_gr REAL NOT NULL DEFAULT 0,
    alcohol_cost_per_gr REAL NOT NULL DEFAULT 0,
    frasco_cost REAL NOT NULL DEFAULT 0,
    precio_original REAL NOT NULL DEFAULT 0,
    descuento_pct REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS compras (
    id TEXT PRIMARY KEY,
    fecha TEXT NOT NULL,
    tipo TEXT NOT NULL,
    codigo TEXT NOT NULL DEFAULT '',
    nombre TEXT NOT NULL,
    cantidad REAL NOT NULL,
    costo_total REAL NOT NULL DEFAULT 0,
    nota TEXT NOT NULL DEFAULT '',
    detalle TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS facturas (
    id TEXT PRIMARY KEY,
    folio INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    cliente TEXT NOT NULL DEFAULT '',
    cliente_tel TEXT NOT NULL DEFAULT '',
    total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS abonos (
    id TEXT PRIMARY KEY,
    factura_id TEXT NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    fecha TEXT NOT NULL,
    monto REAL NOT NULL,
    cuenta TEXT NOT NULL,
    nota TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS gastos (
    id TEXT PRIMARY KEY,
    fecha TEXT NOT NULL,
    categoria TEXT NOT NULL DEFAULT 'Otro',
    descripcion TEXT NOT NULL DEFAULT '',
    monto REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha);

CREATE INDEX IF NOT EXISTS idx_ventas_folio ON ventas(folio);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha);
CREATE INDEX IF NOT EXISTS idx_compras_fecha ON compras(fecha);
CREATE INDEX IF NOT EXISTS idx_abonos_factura ON abonos(factura_id);
CREATE INDEX IF NOT EXISTS idx_facturas_folio ON facturas(folio);
