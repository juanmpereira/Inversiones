require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const ExcelJS = require("exceljs");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const ROOT = __dirname;
const DRIVE_FILE_ID = process.env.GOOGLE_DRIVE_FILE_ID || process.env.GOOGLE_SHEETS_ID || "1O2XLiCvGjeYsaBbRVxcSn2Ns4Yj_DNJv";
const SHEET_NAME = process.env.GOOGLE_SHEETS_NAME || "Cartera dols";
const SALES_SHEET_NAME = process.env.GOOGLE_SALES_SHEET_NAME || "Ventas";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function resolveRequestPath(requestUrl) {
  let pathname;

  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  } catch {
    return null;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);
  const relativeToRoot = path.relative(ROOT, filePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  return filePath;
}

function createDriveClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error("Falta configurar GOOGLE_SERVICE_ACCOUNT_JSON en las variables de entorno.");
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no contiene un JSON válido.");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
}

function getCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return value;
  if (typeof value.formula === "string") {
    const fraction = value.formula.match(/^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (fraction && Number(fraction[2]) !== 0) return Number(fraction[1]) / Number(fraction[2]);
  }
  if (Object.prototype.hasOwnProperty.call(value, "result")) return value.result ?? "";
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("");
  if (typeof value.text === "string") return value.text;
  return "";
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function getPortfolioRows() {
  const drive = createDriveClient();
  const metadata = await drive.files.get({
    fileId: DRIVE_FILE_ID,
    fields: "name,mimeType",
  });
  const mimeType = metadata.data.mimeType;
  let workbookResponse;

  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    workbookResponse = await drive.files.export(
      { fileId: DRIVE_FILE_ID, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { responseType: "arraybuffer" },
    );
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    if (mimeType === "application/vnd.ms-excel") {
      throw new Error("El archivo es XLS antiguo (.xls). Guardalo como .xlsx en Drive para poder leerlo.");
    }
    workbookResponse = await drive.files.get(
      { fileId: DRIVE_FILE_ID, alt: "media" },
      { responseType: "arraybuffer" },
    );
  } else {
    throw new Error(`El archivo de Drive no es una hoja Excel ni Google Sheets compatible (tipo: ${mimeType || "desconocido"}).`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(workbookResponse.data));
  const worksheet = workbook.getWorksheet(SHEET_NAME);

  if (!worksheet) {
    throw new Error(`No se encontró la pestaña «${SHEET_NAME}» en el archivo de Drive.`);
  }

  const readRows = (sheet, columnCount) => {
    const rows = [];
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const worksheetRow = sheet.getRow(rowNumber);
      rows.push(Array.from({ length: columnCount }, (_, index) => getCellValue(worksheetRow.getCell(index + 1).value)));
    }
    return rows;
  };

  const positionRows = readRows(worksheet, 12);
  const headerIndex = positionRows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "activo"));

  if (headerIndex < 0) {
    throw new Error(`No se encontró la tabla de activos en la pestaña «${SHEET_NAME}».`);
  }

  const positionHeaders = positionRows[headerIndex].map(normalizeHeader);
  const purchasePriceIndex = positionHeaders.indexOf("precio compra");
  if (purchasePriceIndex < 0) {
    throw new Error("No se encontró la columna «Precio Compra» en la tabla de activos.");
  }

  const positionTableRows = positionRows.slice(headerIndex + 1);
  const endIndex = positionTableRows.findIndex((row) => {
    const value = row[purchasePriceIndex];
    return value === "" || value === null || value === undefined;
  });
  const positions = [positionRows[headerIndex], ...positionTableRows.slice(0, endIndex < 0 ? positionTableRows.length : endIndex)];

  const salesWorksheet = workbook.getWorksheet(SALES_SHEET_NAME);
  let sales = [];
  if (salesWorksheet) {
    const salesRows = readRows(salesWorksheet, 10);
    const salesHeaderIndex = salesRows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "cerrado"));

    if (salesHeaderIndex >= 0) {
      const salesHeaders = salesRows[salesHeaderIndex].map(normalizeHeader);
      const salesColumn = (name) => salesHeaders.indexOf(normalizeHeader(name));
      const assetColumn = salesColumn("Cerrado");
      const quantityColumn = salesColumn("Cantidad");
      const purchaseColumn = salesColumn("Precio compra");
      const salePriceColumn = salesColumn("Precio venta");
      const gainColumn = salesColumn("Ganado");
      const investedColumn = salesColumn("Invertido");
      const saleTotalColumn = salesColumn("Total venta");
      const salesByAsset = new Map();

      for (const row of salesRows.slice(salesHeaderIndex + 1)) {
        const assetName = String(row[assetColumn] || "").trim();
        if (!assetName) break;

        const key = assetName.toLocaleLowerCase("es");
        if (!salesByAsset.has(key)) {
          salesByAsset.set(key, {
            name: assetName,
            quantity: 0,
            purchaseAmount: 0,
            salePriceAmount: 0,
            invested: 0,
            saleTotal: 0,
            gain: 0,
            transactions: 0,
          });
        }

        const sale = salesByAsset.get(key);
        const quantity = Number(row[quantityColumn]) || 0;
        const purchasePrice = Number(row[purchaseColumn]) || 0;
        const salePrice = Number(row[salePriceColumn]) || 0;
        const invested = Number(row[investedColumn]) || quantity * purchasePrice;
        const saleTotal = Number(row[saleTotalColumn]) || 0;
        const gain = Number(row[gainColumn]) || saleTotal - invested;

        sale.quantity += quantity;
        sale.purchaseAmount += quantity * purchasePrice;
        sale.salePriceAmount += quantity * salePrice;
        sale.invested += invested;
        sale.saleTotal += saleTotal;
        sale.gain += gain;
        sale.transactions += 1;
      }

      sales = [...salesByAsset.values()]
        .map((sale) => ({
          ...sale,
          averagePurchasePrice: sale.quantity ? sale.purchaseAmount / sale.quantity : 0,
          averageSalePrice: sale.quantity ? sale.salePriceAmount / sale.quantity : 0,
          returnPct: sale.invested ? (sale.gain / sale.invested) * 100 : 0,
        }))
        .sort((a, b) => b.gain - a.gain);
    }
  }

  return { positions, sales };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function getSheetsErrorMessage(error) {
  const googleMessage = error.response?.data?.error?.message || error.message || "";

  if (/Drive API has not been used|drive\.googleapis\.com.*disabled|Drive API.*disabled/i.test(googleMessage)) {
    return "Google Drive API está deshabilitada en el proyecto de Google Cloud de la cuenta de servicio. Habilitala en APIs y servicios → Biblioteca → Google Drive API y volvé a probar en unos minutos.";
  }

  if (error.response?.status === 403) {
    return "Google Drive rechazó el acceso. Compartí el archivo con el client_email de la cuenta de servicio como Lector y confirmá que Drive API esté habilitada.";
  }

  if (error.response?.status === 404) {
    return "Google Drive no encuentra el archivo. Revisá GOOGLE_DRIVE_FILE_ID y confirmá que lo compartiste con el client_email de la cuenta de servicio.";
  }

  if (/No se encontró la pestaña|No se encontró la tabla|No se encontró la columna|El archivo es XLS antiguo|El archivo de Drive no es/.test(googleMessage)) {
    return googleMessage;
  }

  if (/GOOGLE_SERVICE_ACCOUNT_JSON/.test(googleMessage)) {
    return googleMessage;
  }

  return "No se pudo leer Google Sheets. Revisá el error del servidor y la configuración de credenciales y permisos.";
}

const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (requestUrl.pathname === "/api/portfolio") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Método no permitido." });
      return;
    }

    getPortfolioRows()
      .then((portfolio) => sendJson(res, 200, { ...portfolio, updatedAt: new Date().toISOString() }))
      .catch((error) => {
        console.error("No se pudo leer Google Sheets:", error.message);
        sendJson(res, 503, {
          error: getSheetsErrorMessage(error),
        });
      });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
    res.end("Method Not Allowed");
    return;
  }

  const filePath = resolveRequestPath(req.url || "/");

  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Cache-Control": "no-cache",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
