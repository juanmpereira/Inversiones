# Inversiones

Proyecto inicial preparado para ejecutarse en Railway. Por ahora solo muestra una página de espera; la funcionalidad se definirá más adelante.

## Probar localmente

Requiere Node.js 18 o superior. Desde esta carpeta, ejecutá:

```bash
npm start
```

Abrí `http://localhost:3000`. La ruta `/health` responde `ok` para comprobar que el servidor está activo.

## Subir este proyecto a GitHub

1. En GitHub, creá un repositorio nuevo llamado `inversiones`. Para evitar conflictos, crealo vacío: no agregues README, licencia ni `.gitignore` desde la web.
2. Abrí una terminal en esta carpeta del proyecto, `Inversiones` (no en `DiaDeLaMadre`).
3. Inicializá Git y guardá los archivos:

   ```bash
   git init
   git add .
   git commit -m "Crear proyecto Inversiones"
   git branch -M main
   ```

4. Conectá la carpeta con el repositorio que creaste, reemplazando `TU-USUARIO` por tu usuario de GitHub:

   ```bash
   git remote add origin https://github.com/TU-USUARIO/inversiones.git
   git push -u origin main
   ```

5. Si Git solicita autenticación, completala en el navegador o mediante el método configurado para tu cuenta.

## Publicar en Railway

1. En Railway, elegí **New Project** y luego **Deploy from GitHub repo**.
2. Conectá GitHub si hace falta y seleccioná el repositorio `inversiones`.
3. Railway detectará la configuración y ejecutará `npm run start`.
4. Cuando termine el despliegue, generá un dominio público desde la configuración de networking del servicio.

Los cambios que luego subas a la rama `main` se podrán desplegar automáticamente desde Railway.
