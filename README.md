# Inversiones

Panel web para seguir posiciones de inversión a partir de una hoja de Google Sheets. Consolida compras repetidas del mismo activo, calcula costo promedio ponderado por cantidad, ganancia y rendimiento, y muestra distribución, comparación de valores y ranking.

## Conexión segura con el archivo de Drive

La aplicación lee directamente el archivo actual de Drive: descarga el XLSX, o exporta temporalmente una hoja nativa de Google a XLSX, y procesa la pestaña indicada. No hace falta convertir el archivo ni hacerlo público. Las credenciales solo se usan en el servidor y tienen acceso de solo lectura.

1. En [Google Cloud Console](https://console.cloud.google.com/), seleccioná el proyecto de la cuenta de servicio y habilitá **Google Drive API** en **APIs y servicios → Biblioteca**. La aplicación usa Drive API, no necesita Google Sheets API.
2. La cuenta de servicio debe tener una clave JSON válida. Conservá el archivo de clave en privado y no lo subas a GitHub.
3. Compartí el archivo actual de Drive con el valor `client_email` del JSON, con permiso de **Lector**. El archivo no necesita ser público.
4. En Railway, configurá `GOOGLE_SERVICE_ACCOUNT_JSON` con el JSON completo de la clave.
5. El ID del archivo, la pestaña `Cartera dols` y la pestaña `Ventas` son valores predeterminados. Si necesitás cambiarlos, usá `GOOGLE_DRIVE_FILE_ID`, `GOOGLE_SHEETS_NAME` y `GOOGLE_SALES_SHEET_NAME`. Por compatibilidad, `GOOGLE_SHEETS_ID` también se acepta como ID del archivo.
6. En local, configurá esas variables en `.env`; luego iniciá o reiniciá el servidor. En Railway, guardá las variables y redeplegá.

### Probar localmente

Requiere Node.js 18 o superior. Copiá `.env.example` como `.env`, reemplazá `GOOGLE_SERVICE_ACCOUNT_JSON` por el contenido real del JSON descargado y confirmá que la cuenta de servicio tenga acceso de lector al archivo de Drive. `.env` está excluido de Git; no compartas ni subas ese archivo.

Luego ejecutá `npm start` y abrí `http://localhost:3000`. La ruta `/health` sirve para comprobar que el servidor está activo.

## Cómo interpreta los datos

- Lee la tabla abierta de `Cartera dols` hasta la primera fila sin `Precio Compra`; el peso de cada activo se calcula automáticamente como su `Valor Actual` dividido por el valor actual total de la cartera.
- La tabla termina en la primera fila donde `Precio Compra` está vacío. De esa manera, los bloques adicionales que se agreguen a la pestaña más adelante no entran en el dashboard.
- Las filas sin nombre de activo se asignan a la última posición nombrada, para consolidar las compras adicionales que dejás con la columna A vacía.
- El costo promedio de compra se pondera por cantidad. La ganancia no realizada se calcula como `Valor Actual - Invertido`; su rendimiento se divide por el capital invertido en posiciones abiertas.
- También lee `Ventas`, agrupa ventas repetidas del mismo activo y suma la columna `Ganado`. La ganancia acumulada mostrada es ganancia no realizada de posiciones abiertas más ganancias realizadas de ventas cerradas.
- El capital invertido representa el costo de las posiciones que aún están abiertas y no se modifica. Además se muestra un aporte propio estimado: costo abierto menos resultado neto de `Ganado` en ventas. Esa estimación supone que se reinvirtió todo el resultado neto; si hubo retiros o reinversión parcial, hace falta registrar depósitos, retiros y reinversiones para conocer el aporte exacto. La ganancia acumulada no implica que el efectivo de las ventas siga disponible.
- La distribución usa el valor actual; el gráfico de comparación destaca las ocho posiciones de mayor valor actual. La tabla se ordena por ganancia en dinero, de mayor a menor.
- Los totales se suman exactamente como figuran en el Sheet: la aplicación no detecta ni convierte monedas. Para que los totales globales sean comparables, las columnas `Invertido` y `Valor Actual` deben estar expresadas en una moneda común.
- Los datos del Sheet se consideran datos de seguimiento, no recomendaciones para vender o comprar. Los activos sin costo o valoración no tienen rendimiento calculable.

## Publicación

El proyecto puede seguir desplegándose desde GitHub conectado a Railway. Después de configurar las variables de entorno indicadas, cada `git push` a la rama conectada vuelve a desplegar la aplicación.
