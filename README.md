# Inversiones

Panel web para seguir posiciones de inversión a partir de una hoja de Google Sheets. Consolida compras repetidas del mismo activo, calcula costo promedio ponderado por cantidad, ganancia y rendimiento, y muestra distribución, comparación de valores y ranking.

## Conexión segura con el archivo de Drive

La aplicación lee directamente el archivo actual de Drive: descarga el XLSX, o exporta temporalmente una hoja nativa de Google a XLSX, y procesa la pestaña indicada. No hace falta convertir el archivo ni hacerlo público. Las credenciales solo se usan en el servidor y tienen acceso de solo lectura.

1. En [Google Cloud Console](https://console.cloud.google.com/), seleccioná el proyecto de la cuenta de servicio y habilitá **Google Drive API** en **APIs y servicios → Biblioteca**. La aplicación usa Drive API, no necesita Google Sheets API.
2. La cuenta de servicio debe tener una clave JSON válida. Conservá el archivo de clave en privado y no lo subas a GitHub.
3. Compartí el archivo actual de Drive con el valor `client_email` del JSON, con permiso de **Lector**. El archivo no necesita ser público.
4. En Railway, configurá `GOOGLE_SERVICE_ACCOUNT_JSON` con el JSON completo de la clave.
5. El ID del archivo y el nombre de pestaña `Cartera dols` son valores predeterminados. Si necesitás cambiarlos, usá `GOOGLE_DRIVE_FILE_ID` y `GOOGLE_SHEETS_NAME`. Por compatibilidad, `GOOGLE_SHEETS_ID` también se acepta como ID del archivo.
6. En local, configurá esas variables en `.env`; luego iniciá o reiniciá el servidor. En Railway, guardá las variables y redeplegá.

### Probar localmente

Requiere Node.js 18 o superior. Copiá `.env.example` como `.env`, reemplazá `GOOGLE_SERVICE_ACCOUNT_JSON` por el contenido real del JSON descargado y confirmá que la cuenta de servicio tenga acceso de lector al archivo de Drive. `.env` está excluido de Git; no compartas ni subas ese archivo.

Luego ejecutá `npm start` y abrí `http://localhost:3000`. La ruta `/health` sirve para comprobar que el servidor está activo.

## Cómo interpreta los datos

- Lee exclusivamente la pestaña `Cartera dols` del archivo de Drive y busca la tablita por su encabezado `Activo`. Usa `Activo`, `Cantidad`, `Precio Compra`, `Invertido`, `Valor Actual` y `Precio Actual`; ignora el resto de la hoja.
- La tabla termina en la primera fila donde `Precio Compra` está vacío. De esa manera, los bloques adicionales que se agreguen a la pestaña más adelante no entran en el dashboard.
- Las filas sin nombre de activo se asignan a la última posición nombrada, para consolidar las compras adicionales que dejás con la columna A vacía.
- El costo promedio de compra se pondera por cantidad. La ganancia se calcula como `Valor Actual - Invertido` y el rendimiento como esa diferencia dividida por `Invertido`.
- La distribución usa el valor actual; el gráfico de comparación destaca las ocho posiciones de mayor valor actual. La tabla se ordena por ganancia en dinero, de mayor a menor.
- Los totales se suman exactamente como figuran en el Sheet: la aplicación no detecta ni convierte monedas. Para que los totales globales sean comparables, las columnas `Invertido` y `Valor Actual` deben estar expresadas en una moneda común.
- Los datos del Sheet se consideran datos de seguimiento, no recomendaciones para vender o comprar. Los activos sin costo o valoración no tienen rendimiento calculable.

## Publicación

El proyecto puede seguir desplegándose desde GitHub conectado a Railway. Después de configurar las variables de entorno indicadas, cada `git push` a la rama conectada vuelve a desplegar la aplicación.
