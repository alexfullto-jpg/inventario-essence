# Publicar Inventario Essence en Railway

Esta carpeta contiene una copia preparada para Railway. No contiene el
inventario real, el cual se migra usando el archivo JSON exportado desde la
aplicación local.

## Seguridad

En Railway configure estas variables antes de abrir la URL pública:

- `APP_DATA_DIR=/data`
- `APP_USERNAME=admin` (o el nombre que prefiera)
- `APP_PASSWORD=` una contraseña larga y única

La aplicación usa autenticación del navegador. En el teléfono y el
computador pedirá esas credenciales una vez.

## Datos persistentes

Adjunte un Volume de Railway en `/data`. Allí se guardan la base de datos y
las copias automáticas. No se sube ningún archivo de `data/` a GitHub.
