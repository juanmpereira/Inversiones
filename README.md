# Inversiones

Panel web para seguir inversiones desde un archivo de Drive. Lee las operaciones de `Compras` y `Ventas`, obtiene cotizaciones de mercado y MEP al actualizar, y conserva los FCI manuales desde `FCI`.

## Cuentas y privacidad

Cada persona crea su usuario y contraseña desde la pantalla inicial. Las contraseñas se guardan derivadas con scrypt; cada cuenta guarda su propio ID de Drive y la API de cartera exige una sesión. Al iniciar sesión, si ya conectó una hoja, el dashboard carga directamente; una cuenta nueva ve el formulario de conexión. Como no se pide email, no hay recuperación automática: cada usuario debe guardar su contraseña.

La base SQLite guarda usuarios, hashes, sesiones y links de hojas en `DATA_DIR` (por defecto, fuera de la carpeta pública del proyecto). **En Railway es obligatorio montar un Volume en `/data` y configurar `DATA_DIR=/data`**; si no, las cuentas se perderán al reemplazar el contenedor. Usá una sola réplica para este servicio SQLite. La cookie de sesión dura 14 días y se invalida al cerrar sesión.

Para agregar amistades, compartiles el URL de Railway: crean una cuenta propia, pegan el link de su archivo y comparten ese archivo con el correo de la cuenta de servicio que muestra el onboarding. El correo necesita permiso de lector; la hoja no se publica. La cuenta de servicio puede leer solamente los archivos que sus dueños le compartan.

## Conexión segura con el archivo de Drive

La aplicación lee directamente el archivo actual de Drive: descarga el XLSX, o exporta temporalmente una hoja nativa de Google a XLSX, y procesa la pestaña indicada. No hace falta convertir el archivo ni hacerlo público. Las credenciales solo se usan en el servidor y tienen acceso de solo lectura.

1. En [Google Cloud Console](https://console.cloud.google.com/), seleccioná el proyecto de la cuenta de servicio y habilitá **Google Drive API** en **APIs y servicios → Biblioteca**. La aplicación usa Drive API, no necesita Google Sheets API.
2. La cuenta de servicio debe tener una clave JSON válida. Conservá el archivo de clave en privado y no lo subas a GitHub.
3. Compartí el archivo actual de Drive con el valor `client_email` del JSON, con permiso de **Lector**. El archivo no necesita ser público.
4. En Railway, configurá `GOOGLE_SERVICE_ACCOUNT_JSON` con el JSON completo de la clave.
5. El ID del archivo y los nombres `Compras`, `Ventas`, `FCI`, `Liquidez` y `Empresa` son valores predeterminados. `Compras` es obligatoria; `FCI`, `Ventas`, `Liquidez` y `Empresa` son opcionales y sus secciones no aparecen cuando la pestaña no existe. Si cambiás nombres, usá `GOOGLE_DRIVE_FILE_ID`, `GOOGLE_PURCHASES_SHEET_NAME`, `GOOGLE_SALES_SHEET_NAME`, `GOOGLE_FCI_SHEET_NAME`, `GOOGLE_LIQUIDITY_SHEET_NAME` y `GOOGLE_COMPANY_SHEET_NAME`. Por compatibilidad, `GOOGLE_SHEETS_ID` también se acepta como ID del archivo.
6. En local, configurá esas variables en `.env`; luego iniciá o reiniciá el servidor. En Railway, guardá las variables y redeplegá.

### Probar localmente

Requiere Node.js 18 o superior. Copiá `.env.example` como `.env`, reemplazá `GOOGLE_SERVICE_ACCOUNT_JSON` por el contenido real del JSON descargado y confirmá que la cuenta de servicio tenga acceso de lector al archivo de Drive. `.env` está excluido de Git; no compartas ni subas ese archivo.

Luego ejecutá `npm start`, abrí `http://localhost:3000`, creá tu cuenta y conectá el link del archivo. La ruta `/health` sirve para comprobar que el servidor está activo.

## Cómo interpreta las operaciones

- `Compras` usa `Fecha`, `Simbolo`, `TIpo`/`Tipo`, `Cantidad`, `Moneda`, `Precio unitario` y `Mep`. `Ventas` usa `Fecha`, `Simbolo`, `Cantidad`, `Moneda`, `Precio Unitario` y `Mep`.
- Las ventas se aplican cronológicamente a las compras del mismo símbolo con costo promedio ponderado. Así se calcula la cantidad abierta, el costo que queda y la ganancia realizada; vender más unidades que las compradas genera un error explícito.
- Para operaciones en ARS se usa el MEP anotado en esa fila; si está vacío, se busca el MEP histórico de esa fecha o el día hábil anterior. Para operaciones en USD se usa directamente el precio USD.
- Las cotizaciones de `CEDEAR` se consultan como `SIMBOLO.BA` en Yahoo Finance; otros tipos usan el símbolo tal cual. Se muestra la cotización diaria más reciente disponible, que puede tener demora y no constituye un feed en tiempo real.
- El valor y las ganancias se presentan en USD y ARS. Las tenencias CEDEAR en ARS se convierten a USD con el MEP actual; el resultado en ARS se calcula contra la base de compra histórica en pesos.
- `FCI` es opcional y, si existe, conserva `Activo`, `Cantidad`, `Precio Compra`, `Invertido`, `Valor Actual`, `Ganancia $`, `Ganancia %` y `Precio Actual`; sus datos son manuales y, por el formato del libro, se interpretan como USD. Los FCI se incluyen en valores y ganancias, pero se excluyen de distribución y gráfico comparativo.
- `Liquidez` usa `Concepto`, `Categoria`, `Moneda` e `Importe`. Todo efectivo se suma al patrimonio en ambas monedas. Solo filas `Liquidez` denominadas en `ARS` entran en el gráfico; filas `Reserva` (por ejemplo, banco o caja en USD) quedan fuera.
- `Empresa` usa `Simbolo`, `Tipo`, `Cantidad` y `Moneda`. La cotización se busca con la misma fuente que las acciones; su valor cuenta en el patrimonio pero no en la cartera invertida ni en la distribución. Sin costo de adquisición no se calcula ganancia para esas acciones. Si la cantidad está vacía o no es numérica, se muestra como dato pendiente y no se suma al patrimonio hasta completarla.
- El patrimonio total incluye posiciones abiertas, FCI, efectivo y acciones de Empresa. El capital invertido y las ganancias de inversión excluyen efectivo y acciones de Empresa.
- La tabla de posiciones muestra solo cantidades netas abiertas. Los activos vendidos por completo aparecen en la sección desplegable de ventas.
- Las cotizaciones de Yahoo Finance y el histórico MEP son fuentes externas y pueden cambiar, retrasarse o no ofrecer un ticker. La app muestra el error si no consigue una cotización necesaria.
- El dashboard es informativo y no constituye una recomendación de inversión.

## Publicación

El proyecto puede seguir desplegándose desde GitHub conectado a Railway. Después de configurar las variables de entorno indicadas, cada `git push` a la rama conectada vuelve a desplegar la aplicación.
