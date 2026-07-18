import sqlite3
import os
import json
import uuid
import shutil
import socket
from datetime import date

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# En Railway se define APP_DATA_DIR=/data, que corresponde al volumen
# persistente. En el computador local se conserva la carpeta data actual.
DATA_DIR = os.environ.get("APP_DATA_DIR") or os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "inventario.db")
SCHEMA_PATH = os.path.join(BASE_DIR, "schema.sql")
BACKUPS_DIR = os.path.join(DATA_DIR, "backups")
MAX_AUTO_BACKUPS = 14


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def new_id():
    return uuid.uuid4().hex[:16]


# Catálogo de fragancias de referencia (mismas ~100 inspiraciones del catálogo original).
# Se usa SOLO para poblar la base de datos la primera vez que se crea (si ya existe, no se toca).
DEFAULT_FRAGANCIAS = [
    {"nombre": "CLOUD ARIANA GRANDE", "codigo": "954", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "LIGHT BLUE DOLCE & GABBANA", "codigo": "757", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "GOOD GIRL CAROLINA HERRERA", "codigo": "355", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "212 VIP ROSE CAROLINA HERRERA", "codigo": "3603", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "PARIS HILTON", "codigo": "1615", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "THANK U NEXT ARIANA GRANDE", "codigo": "1094", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "YARA CANDY LATTAFA", "codigo": "3322", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "YARA LATTAFA PERFUMES", "codigo": "2794", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "COCO MADEMOISELLE CHANEL", "codigo": "1396", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "LIBRE YVES SAINT LAURENT", "codigo": "3119", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "BURBERRY BURBERRY", "codigo": "2503", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Femenino"},
    {"nombre": "212 VIP BLACK CAROLINA HERRERA", "codigo": "613", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Masculino"},
    {"nombre": "EROS VERSACE", "codigo": "3503", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Masculino"},
    {"nombre": "ACQUA DE GIO GIORGIO ARMANI", "codigo": "724", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Masculino"},
    {"nombre": "CLUB DE NUIT INTENSE MAN ARMAF", "codigo": "2706", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Masculino"},
    {"nombre": "INVICTUS PACO RABANNE", "codigo": "3467", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Masculino"},
    {"nombre": "AVENTUS CREED", "codigo": "440", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Masculino"},
    {"nombre": "SAUVAGE CHRISTIAN DIOR", "codigo": "3859", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Masculino"},
    {"nombre": "BLEU DE CHANEL", "codigo": "2838", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Masculino"},
    {"nombre": "KHAMRAH LATTAFA PERFUMES", "codigo": "2729", "p10": 7000, "p30": 20000, "p50": 32000, "genero": "Unisex"},
]


def _migrate_schema(conn):
    """Adds columns introduced after the original schema to databases that
    already existed before this update, without touching any existing data.
    Safe to run every time the program starts."""
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(ventas)")}
    if "precio_original" not in cols:
        conn.execute("ALTER TABLE ventas ADD COLUMN precio_original REAL NOT NULL DEFAULT 0")
    if "descuento_pct" not in cols:
        conn.execute("ALTER TABLE ventas ADD COLUMN descuento_pct REAL NOT NULL DEFAULT 0")
    conn.commit()


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    is_new = not os.path.exists(DB_PATH)
    conn = get_conn()
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.commit()
    _migrate_schema(conn)

    # Seed default config row if missing
    row = conn.execute("SELECT id FROM config WHERE id = 1").fetchone()
    if not row:
        conn.execute("INSERT INTO config (id) VALUES (1)")
        conn.commit()

    # Seed a starter set of fragancias only if the table is completely empty
    # (so this never overwrites real data on subsequent launches)
    count = conn.execute("SELECT COUNT(*) AS c FROM fragancias").fetchone()["c"]
    if count == 0:
        for f in DEFAULT_FRAGANCIAS:
            conn.execute(
                "INSERT INTO fragancias (codigo, nombre, genero, p10, p30, p50, stock_gr, cost_per_gr, ubicacion) "
                "VALUES (?, ?, ?, ?, ?, ?, 0, 0, '')",
                (f["codigo"], f["nombre"], f["genero"], f["p10"], f["p30"], f["p50"]),
            )
        conn.commit()

    conn.close()
    return is_new


def auto_backup():
    """Makes one automatic backup copy per day (only if today's backup doesn't
    already exist), and keeps only the most recent MAX_AUTO_BACKUPS copies so
    the backups folder never grows without limit. Never touches the real
    database file — only reads and copies it."""
    if not os.path.exists(DB_PATH):
        return
    os.makedirs(BACKUPS_DIR, exist_ok=True)
    today = date.today().isoformat()
    dest = os.path.join(BACKUPS_DIR, f"inventario_{today}.db")
    if not os.path.exists(dest):
        try:
            shutil.copyfile(DB_PATH, dest)
        except Exception:
            return
    # prune old backups beyond the limit
    backups = sorted(
        [f for f in os.listdir(BACKUPS_DIR) if f.startswith("inventario_") and f.endswith(".db")]
    )
    if len(backups) > MAX_AUTO_BACKUPS:
        for old in backups[: len(backups) - MAX_AUTO_BACKUPS]:
            try:
                os.remove(os.path.join(BACKUPS_DIR, old))
            except Exception:
                pass


def get_lan_ip():
    """Best-effort detection of this computer's IP address on the local
    network, so it can be shown to the person as 'open this from your phone
    at http://<ip>:5000'. Falls back to 127.0.0.1 if it can't be determined."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
        finally:
            s.close()
        return ip
    except Exception:
        return "127.0.0.1"
