# Essence Collection — Inventario y Ventas (programa local)

Tu programa de inventario y ventas, corriendo en tu propio computador con una
base de datos real (no en el navegador). Tu información vive en un archivo
estable dentro de la carpeta `data/`.

## Primera vez: instalar Python (una sola vez)

### Windows
1. Ve a **https://www.python.org/downloads/** y descarga Python.
2. Ábrelo. En la primera pantalla, marca la casilla **"Add python.exe to PATH"** ✅ antes de darle a "Install Now".

### Mac
1. Ve a **https://www.python.org/downloads/** y descarga la versión para macOS.
2. Instálalo con el instalador normal (siguiente, siguiente, instalar).

## Cómo abrir el programa (día a día)

### Windows
Haz doble clic en **`Iniciar Essence Collection.vbs`**.
- No aparece ninguna ventana negra.
- Se abre directo una ventana con el programa, como cualquier otro programa de tu computador.
- La primera vez tardará uno o dos minutos preparando todo (te avisa antes con un mensaje).

Para cerrarlo: simplemente cierra esa ventana. Si quieres apagar el programa
por completo (para que no quede corriendo de fondo), haz doble clic en
**`Detener Essence Collection.vbs`**.

### Mac
Haz doble clic en **`Iniciar Essence Collection.command`**.
- Si Mac muestra un aviso de seguridad la primera vez: clic derecho sobre el archivo → "Abrir" → confirmar "Abrir".
- Se abre una ventana de Terminal muy brevemente y luego se cierra sola; el programa se abre en su propia ventana.

Para apagarlo por completo: doble clic en **`Detener Essence Collection.command`**.

## Si algo no abre o falla — modo de diagnóstico

Si el doble clic normal no muestra nada o algo no funciona, usa el archivo de
respaldo que sí muestra los mensajes técnicos, para poder copiarlos y
mandármelos:
- Windows: **`Solucion de problemas (Windows).bat`**
- Mac: **`Solucion de problemas (Mac).command`**

Estos abren la ventana de siempre (con texto) en vez de esconderla, así se ve
cualquier error que esté pasando.

## Dónde vive tu información
```
data/inventario.db
```
Este archivo no se borra al cerrar el programa. Aun así:
- Exporta un respaldo (JSON) de vez en cuando desde "Historial" → "Exportar respaldo".
- Copia la carpeta completa a un USB o Google Drive cada cierto tiempo por seguridad.

## Si más adelante quieres un instalador "de verdad" (.exe firmado)
Lo que tienes ahora se comporta igual que un programa instalado (un ícono,
doble clic, se abre solo, sin ventanas técnicas) pero por dentro sigue siendo
Python + un navegador. Si en el futuro quieres un instalador tradicional que
además no dependa de tener Python instalado, eso se construye directamente
desde una computadora con Windows o Mac con herramientas de empaquetado — es
un paso aparte que se puede hacer más adelante si lo necesitas.

## Qué incluye
- Panel general (ventas del mes, utilidad neta, margen, gráficas, alertas de stock, proyección de ganancias)
- Inventario de fragancias (stock, costo por gramo, ubicación física, localizador rápido)
- **Descuento especial por producto** al registrar una venta (para ese cliente/pedido puntual, sin tocar los precios generales)
- **Importar gramos, costo por gramo y ubicación desde un Excel o CSV propio** (se identifica cada fragancia por su Código; las celdas vacías no borran datos existentes)
- Otros productos de inventario (bolsas, etiquetas, empaques, etc.)
- Registrar venta con carrito de varios productos, recargas, fiado y cuenta de pago
- Registrar compra (fragancia, alcohol, frascos, otros productos)
- **Gastos generales del negocio** (arriendo, transporte, publicidad, etc.) descontados en la utilidad neta
- **Clientes**: historial de compras, total gastado, saldo pendiente y fragancia favorita por cliente
- Cuentas por cobrar con abonos parciales, control de cuenta (Efectivo, Nequi, Bancolombia, Nu Bank) y aviso de **fiados atrasados (+15 días)**
- Historial de movimientos con opción de eliminar (revirtiendo el inventario automáticamente)
- Exportar a Excel y exportar/importar respaldo en JSON
- **Respaldo automático diario** (guarda una copia en `data/backups/` cada día que abras el programa, conservando los últimos 14 días)
- **Acceso desde tu celular** en la misma red WiFi (ver abajo)
- Importar/actualizar fragancias desde un catálogo JSON

## Acceder desde tu celular (misma WiFi)
Cuando abres el programa, en la parte de arriba de la pantalla vas a ver una
dirección como `http://192.168.x.x:5000`. Escribe esa misma dirección en el
navegador de tu celular (conectado al mismo WiFi de tu casa/local) y vas a
ver el mismo programa ahí, en tiempo real.

⚠️ **Importante**: esto lo pueden ver todos los dispositivos conectados a esa
misma red WiFi, sin pedir contraseña. Está bien para el WiFi de tu casa o tu
local, pero **no actives esto en WiFi públicas** (un café, un centro comercial, etc.).

## Si algo no funciona
Copia el mensaje de error exacto (de la pantalla o del modo de diagnóstico) y compártelo tal cual — con eso puedo identificar la causa mucho más rápido.
