require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { promisify } = require("util");
const { google } = require("googleapis");
const ExcelJS = require("exceljs");
const Database = require("better-sqlite3");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const ROOT = __dirname;
const DRIVE_FILE_ID = process.env.GOOGLE_DRIVE_FILE_ID || process.env.GOOGLE_SHEETS_ID || "1O2XLiCvGjeYsaBbRVxcSn2Ns4Yj_DNJv";
const PURCHASES_SHEET_NAME = process.env.GOOGLE_PURCHASES_SHEET_NAME || "Compras";
const SALES_SHEET_NAME = process.env.GOOGLE_SALES_SHEET_NAME || "Ventas";
const FCI_SHEET_NAME = process.env.GOOGLE_FCI_SHEET_NAME || "FCI";
const LIQUIDITY_SHEET_NAME = process.env.GOOGLE_LIQUIDITY_SHEET_NAME || "Liquidez";
const COMPANY_SHEET_NAME = process.env.GOOGLE_COMPANY_SHEET_NAME || "Empresa";
const MEP_HISTORY_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa";
const DATA_DIRECTORY = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(os.homedir(), ".local", "share", "inversiones"));
const SESSION_COOKIE = "inversiones_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 14;
const SCRYPT = promisify(crypto.scrypt);
const quoteCache = new Map();
const authAttempts = new Map();

fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
const database = new Database(path.join(DATA_DIRECTORY, "inversiones.sqlite"));
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    sheet_file_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    session_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

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

  const relativeToData = path.relative(DATA_DIRECTORY, filePath);
  if (relativeToData === "" || (!relativeToData.startsWith("..") && !path.isAbsolute(relativeToData))) {
    return null;
  }

  return filePath;
}

function getClientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function allowAuthAttempt(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const attempts = (authAttempts.get(ip) || []).filter((timestamp) => now - timestamp < windowMs);
  if (attempts.length >= 12) return false;
  attempts.push(now);
  authAttempts.set(ip, attempts);
  return true;
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((cookie) => {
    const separator = cookie.indexOf("=");
    if (separator < 0) return ["", ""];
    return [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function getSessionUser(req) {
  const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!sessionId) return null;
  const sessionHash = crypto.createHash("sha256").update(sessionId).digest("hex");
  const session = database.prepare(`
    SELECT users.id, users.username, users.sheet_file_id, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.session_hash = ?
  `).get(sessionHash);
  if (!session || session.expires_at <= Date.now()) {
    database.prepare("DELETE FROM sessions WHERE session_hash = ?").run(sessionHash);
    return null;
  }
  return session;
}

function createSession(userId, req, res) {
  const now = Date.now();
  const sessionId = crypto.randomBytes(32).toString("base64url");
  const sessionHash = crypto.createHash("sha256").update(sessionId).digest("hex");
  const expiresAt = now + SESSION_DURATION_MS;
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  database.prepare("INSERT INTO sessions (session_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sessionHash, userId, expiresAt);
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const secure = forwardedProto === "https" || process.env.NODE_ENV === "production";
  const secureAttribute = secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_MS / 1000}${secureAttribute}`);
}

function clearSession(req, res) {
  const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (sessionId) {
    const sessionHash = crypto.createHash("sha256").update(sessionId).digest("hex");
    database.prepare("DELETE FROM sessions WHERE session_hash = ?").run(sessionHash);
  }
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const secureAttribute = forwardedProto === "https" || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute}`);
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const requestHost = req.headers["x-forwarded-host"] || req.headers.host;
    return originHost === requestHost;
  } catch {
    return false;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8192) tooLarge = true;
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("La solicitud es demasiado grande."), { statusCode: 413 }));
        return;
      }
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("El cuerpo debe ser JSON válido."), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

async function createPasswordHash(password, salt = crypto.randomBytes(16)) {
  const hash = await SCRYPT(password, salt, 64);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

async function verifyPassword(password, user) {
  const salt = user ? Buffer.from(user.password_salt, "hex") : Buffer.from("inversiones-invalid-user-salt");
  const expectedHash = user ? Buffer.from(user.password_hash, "hex") : Buffer.alloc(64);
  const { hash } = await createPasswordHash(password, salt);
  const actualHash = Buffer.from(hash, "hex");
  return user ? crypto.timingSafeEqual(actualHash, expectedHash) : false;
}

function extractDriveFileId(sheetUrl) {
  let url;
  try {
    url = new URL(String(sheetUrl || "").trim());
  } catch {
    throw new Error("Pegá el enlace completo de Google Sheets o Drive.");
  }

  const allowedHost = url.hostname === "google.com" || url.hostname.endsWith(".google.com");
  const match = url.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!allowedHost || !match) throw new Error("El enlace no parece ser de un archivo válido de Google Sheets o Drive.");
  return match[1];
}

function getServiceAccountEmail() {
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}").client_email || "";
  } catch {
    return "";
  }
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
  if (value instanceof Date) return value;
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

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === "") return 0;

  let text = String(value).trim().replace(/\s/g, "").replace(/%$/, "");
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma >= 0) {
    text = text.replace(",", ".");
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value || "").trim();
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  const localDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (localDate) return `${localDate[3]}-${localDate[2].padStart(2, "0")}-${localDate[1].padStart(2, "0")}`;
  return "";
}

function normalizeCurrency(value) {
  const currency = normalizeHeader(value).toUpperCase();
  if (["ARS", "PESOS", "PESO"].includes(currency)) return "ARS";
  if (["USD", "DOLARES", "DOLAR", "US$"].includes(currency)) return "USD";
  throw new Error(`Moneda no reconocida: «${value}». Usá ARS o USD.`);
}

function rowsFromWorksheet(worksheet, columnCount) {
  return Array.from({ length: worksheet.rowCount }, (_, index) => {
    const row = worksheet.getRow(index + 1);
    return Array.from({ length: columnCount }, (_, column) => getCellValue(row.getCell(column + 1).value));
  });
}

function getHeaderMap(rows, marker, sheetName) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === normalizeHeader(marker)));
  if (headerIndex < 0) throw new Error(`No se encontró el encabezado «${marker}» en la pestaña «${sheetName}».`);
  const headers = rows[headerIndex].map(normalizeHeader);
  return {
    headerIndex,
    get(name) {
      const index = headers.indexOf(normalizeHeader(name));
      if (index < 0) throw new Error(`Falta la columna «${name}» en la pestaña «${sheetName}».`);
      return index;
    },
  };
}

async function getMepHistory() {
  const response = await fetch(MEP_HISTORY_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`No se pudo consultar el histórico de dólar MEP (HTTP ${response.status}).`);
  const history = await response.json();
  if (!Array.isArray(history) || !history.length) throw new Error("La fuente de dólar MEP no devolvió cotizaciones.");
  return history
    .filter((entry) => entry.fecha && parseNumber(entry.venta) > 0)
    .map((entry) => ({ date: entry.fecha, rate: parseNumber(entry.venta) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function findMepForDate(date, history) {
  if (!date) return 0;
  const exact = history.find((entry) => entry.date === date);
  if (exact) return exact.rate;
  const previous = [...history].reverse().find((entry) => entry.date < date);
  if (!previous) return 0;
  const dayDifference = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86400000;
  return dayDifference <= 5 ? previous.rate : 0;
}

async function getQuote(symbol, type) {
  const isCedear = normalizeHeader(type).includes("cedear");
  const ticker = isCedear ? `${symbol}.BA` : symbol;
  const cached = quoteCache.get(ticker);
  if (cached && Date.now() - cached.cachedAt < 60000) return cached.quote;

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set("range", "5d");
  url.searchParams.set("interval", "1d");
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!response.ok) throw new Error(`No se pudo consultar la cotización de ${ticker} (HTTP ${response.status}).`);

  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`No se encontró una cotización para ${ticker}. Revisá el símbolo y el tipo en Compras.`);
  const closes = result.indicators?.quote?.[0]?.close || [];
  const lastIndex = closes.findLastIndex((price) => Number.isFinite(price));
  if (lastIndex < 0) throw new Error(`No hay precios recientes disponibles para ${ticker}.`);

  const currency = result.meta.currency;
  if (!["ARS", "USD"].includes(currency)) throw new Error(`La cotización de ${ticker} llegó en moneda no compatible: ${currency}.`);
  const quote = {
    symbol,
    ticker,
    price: closes[lastIndex],
    currency,
    quoteDate: new Date(result.timestamp[lastIndex] * 1000).toISOString().slice(0, 10),
    type,
  };
  quoteCache.set(ticker, { quote, cachedAt: Date.now() });
  return quote;
}

function getRowsAfterHeader(rows, headerIndex) {
  return rows.slice(headerIndex + 1).filter((row) => row.some((cell) => cell !== "" && cell !== null && cell !== undefined));
}

async function getPortfolioRows(fileId = DRIVE_FILE_ID) {
  const drive = createDriveClient();
  const metadata = await drive.files.get({
    fileId,
    fields: "name,mimeType",
  });
  const mimeType = metadata.data.mimeType;
  let workbookResponse;

  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    workbookResponse = await drive.files.export(
      { fileId, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
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
      { fileId, alt: "media" },
      { responseType: "arraybuffer" },
    );
  } else {
    throw new Error(`El archivo de Drive no es una hoja Excel ni Google Sheets compatible (tipo: ${mimeType || "desconocido"}).`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(workbookResponse.data));
  const purchasesWorksheet = workbook.getWorksheet(PURCHASES_SHEET_NAME);
  const salesWorksheet = workbook.getWorksheet(SALES_SHEET_NAME);
  const fciWorksheet = workbook.getWorksheet(FCI_SHEET_NAME);
  const liquidityWorksheet = workbook.getWorksheet(LIQUIDITY_SHEET_NAME);
  const companyWorksheet = workbook.getWorksheet(COMPANY_SHEET_NAME);
  if (!purchasesWorksheet) {
    const missing = [
      [PURCHASES_SHEET_NAME, purchasesWorksheet],
    ].filter(([, sheet]) => !sheet).map(([name]) => name);
    throw new Error(`Faltan estas pestañas en el archivo: ${missing.join(", ")}.`);
  }

  const purchasesRows = rowsFromWorksheet(purchasesWorksheet, 12);
  const purchasesHeader = getHeaderMap(purchasesRows, "Simbolo", PURCHASES_SHEET_NAME);
  const purchaseColumn = {
    date: purchasesHeader.get("Fecha"),
    symbol: purchasesHeader.get("Simbolo"),
    type: purchasesHeader.get("Tipo"),
    quantity: purchasesHeader.get("Cantidad"),
    currency: purchasesHeader.get("Moneda"),
    unitPrice: purchasesHeader.get("Precio unitario"),
    mep: purchasesHeader.get("Mep"),
  };

  const salesRows = salesWorksheet ? rowsFromWorksheet(salesWorksheet, 12) : [];
  const salesHeader = salesWorksheet ? getHeaderMap(salesRows, "Simbolo", SALES_SHEET_NAME) : null;
  const salesColumn = salesHeader ? {
    date: salesHeader.get("Fecha"),
    symbol: salesHeader.get("Simbolo"),
    quantity: salesHeader.get("Cantidad"),
    currency: salesHeader.get("Moneda"),
    unitPrice: salesHeader.get("Precio Unitario"),
    mep: salesHeader.get("Mep"),
  } : null;
  const fciRows = fciWorksheet ? rowsFromWorksheet(fciWorksheet, 12) : [];
  const fciHeader = fciWorksheet ? getHeaderMap(fciRows, "Activo", FCI_SHEET_NAME) : null;
  const fciColumn = fciHeader ? {
    asset: fciHeader.get("Activo"),
    quantity: fciHeader.get("Cantidad"),
    purchasePrice: fciHeader.get("Precio Compra"),
    invested: fciHeader.get("Invertido"),
    currentValue: fciHeader.get("Valor Actual"),
    currentPrice: fciHeader.get("Precio Actual"),
  } : null;
  const liquidityRows = liquidityWorksheet ? rowsFromWorksheet(liquidityWorksheet, 8) : [];
  const liquidityHeader = liquidityWorksheet ? getHeaderMap(liquidityRows, "Concepto", LIQUIDITY_SHEET_NAME) : null;
  const liquidityColumn = liquidityHeader ? {
    concept: liquidityHeader.get("Concepto"),
    category: liquidityHeader.get("Categoria"),
    currency: liquidityHeader.get("Moneda"),
    amount: liquidityHeader.get("Importe"),
  } : null;
  const companyRows = companyWorksheet ? rowsFromWorksheet(companyWorksheet, 8) : [];
  const companyHeader = companyWorksheet ? getHeaderMap(companyRows, "Simbolo", COMPANY_SHEET_NAME) : null;
  const companyColumn = companyHeader ? {
    symbol: companyHeader.get("Simbolo"),
    type: companyHeader.get("Tipo"),
    quantity: companyHeader.get("Cantidad"),
    currency: companyHeader.get("Moneda"),
  } : null;

  const mepHistory = await getMepHistory();
  const currentMep = mepHistory.at(-1).rate;
  const transactions = [];
  const symbols = new Map();

  for (const row of getRowsAfterHeader(purchasesRows, purchasesHeader.headerIndex)) {
    const symbol = String(row[purchaseColumn.symbol] || "").trim().toUpperCase();
    const quantity = parseNumber(row[purchaseColumn.quantity]);
    const unitPrice = parseNumber(row[purchaseColumn.unitPrice]);
    if (!symbol || quantity <= 0 || unitPrice <= 0) continue;

    const date = normalizeDate(row[purchaseColumn.date]);
    if (!date) throw new Error(`Falta una fecha válida en una compra de ${symbol}.`);
    const type = String(row[purchaseColumn.type] || "").trim();
    if (!type) throw new Error(`Falta el Tipo de ${symbol} en Compras.`);
    const currency = normalizeCurrency(row[purchaseColumn.currency]);
    const mep = parseNumber(row[purchaseColumn.mep]) || findMepForDate(date, mepHistory);
    if (!mep) throw new Error(`No hay cotización MEP para la compra de ${symbol} del ${date}.`);

    const nativeAmount = quantity * unitPrice;
    const costArs = currency === "ARS" ? nativeAmount : nativeAmount * mep;
    const costUsd = currency === "USD" ? nativeAmount : nativeAmount / mep;
    transactions.push({ kind: "buy", date, symbol, type, quantity, costArs, costUsd, unitPrice, currency, mep });
    symbols.set(symbol, type);
  }

  for (const row of salesHeader ? getRowsAfterHeader(salesRows, salesHeader.headerIndex) : []) {
    const symbol = String(row[salesColumn.symbol] || "").trim().toUpperCase();
    const quantity = parseNumber(row[salesColumn.quantity]);
    const unitPrice = parseNumber(row[salesColumn.unitPrice]);
    if (!symbol || quantity <= 0 || unitPrice <= 0) continue;

    const date = normalizeDate(row[salesColumn.date]);
    if (!date) throw new Error(`Falta una fecha válida en una venta de ${symbol}.`);
    const currency = normalizeCurrency(row[salesColumn.currency]);
    const mep = parseNumber(row[salesColumn.mep]) || findMepForDate(date, mepHistory);
    if (!mep) throw new Error(`No hay cotización MEP para la venta de ${symbol} del ${date}.`);
    const type = symbols.get(symbol);
    if (!type) throw new Error(`La venta de ${symbol} no tiene una compra correspondiente en Compras.`);

    const nativeAmount = quantity * unitPrice;
    const proceedsArs = currency === "ARS" ? nativeAmount : nativeAmount * mep;
    const proceedsUsd = currency === "USD" ? nativeAmount : nativeAmount / mep;
    transactions.push({ kind: "sell", date, symbol, type, quantity, proceedsArs, proceedsUsd, unitPrice, currency, mep });
  }

  transactions.sort((a, b) => {
    const dateOrder = a.date.localeCompare(b.date);
    if (dateOrder) return dateOrder;
    if (a.kind === b.kind) return 0;
    return a.kind === "buy" ? -1 : 1;
  });
  const inventory = new Map();
  const salesBySymbol = new Map();

  for (const transaction of transactions) {
    if (!inventory.has(transaction.symbol)) {
      inventory.set(transaction.symbol, {
        symbol: transaction.symbol,
        type: transaction.type,
        quantity: 0,
        costArs: 0,
        costUsd: 0,
        purchasedQuantity: 0,
        purchaseAmountArs: 0,
        purchaseAmountUsd: 0,
      });
    }
    const asset = inventory.get(transaction.symbol);

    if (transaction.kind === "buy") {
      asset.quantity += transaction.quantity;
      asset.costArs += transaction.costArs;
      asset.costUsd += transaction.costUsd;
      asset.purchasedQuantity += transaction.quantity;
      asset.purchaseAmountArs += transaction.costArs;
      asset.purchaseAmountUsd += transaction.costUsd;
      continue;
    }

    if (transaction.quantity > asset.quantity + 1e-8) {
      throw new Error(`Las ventas de ${transaction.symbol} superan la cantidad comprada: quedan ${asset.quantity}, se intentan vender ${transaction.quantity}.`);
    }

    const averageCostArs = asset.quantity ? asset.costArs / asset.quantity : 0;
    const averageCostUsd = asset.quantity ? asset.costUsd / asset.quantity : 0;
    const costBasisArs = averageCostArs * transaction.quantity;
    const costBasisUsd = averageCostUsd * transaction.quantity;
    asset.quantity = Math.max(0, asset.quantity - transaction.quantity);
    asset.costArs = Math.max(0, asset.costArs - costBasisArs);
    asset.costUsd = Math.max(0, asset.costUsd - costBasisUsd);

    if (!salesBySymbol.has(transaction.symbol)) {
      salesBySymbol.set(transaction.symbol, {
        symbol: transaction.symbol,
        type: transaction.type,
        transactions: 0,
        quantity: 0,
        costBasisArs: 0,
        costBasisUsd: 0,
        proceedsArs: 0,
        proceedsUsd: 0,
      });
    }
    const sale = salesBySymbol.get(transaction.symbol);
    sale.transactions += 1;
    sale.quantity += transaction.quantity;
    sale.costBasisArs += costBasisArs;
    sale.costBasisUsd += costBasisUsd;
    sale.proceedsArs += transaction.proceedsArs;
    sale.proceedsUsd += transaction.proceedsUsd;
  }

  const openPositions = [...inventory.values()].filter((asset) => asset.quantity > 1e-8);
  const quotes = await Promise.all(openPositions.map((asset) => getQuote(asset.symbol, asset.type)));
  const quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const positions = openPositions.map((asset) => {
    const quote = quotesBySymbol.get(asset.symbol);
    const currentValueUsd = quote.currency === "ARS" ? (asset.quantity * quote.price) / currentMep : asset.quantity * quote.price;
    const currentValueArs = quote.currency === "ARS" ? asset.quantity * quote.price : asset.quantity * quote.price * currentMep;
    const gainUsd = currentValueUsd - asset.costUsd;
    const gainArs = currentValueArs - asset.costArs;
    return {
      ...asset,
      name: asset.symbol,
      currentPrice: quote.price,
      currentPriceCurrency: quote.currency,
      quoteDate: quote.quoteDate,
      currentValueUsd,
      currentValueArs,
      gainUsd,
      gainArs,
      returnPct: asset.costUsd ? (gainUsd / asset.costUsd) * 100 : 0,
      averagePurchasePriceUsd: asset.quantity ? asset.costUsd / asset.quantity : 0,
      averagePurchasePriceArs: asset.quantity ? asset.costArs / asset.quantity : 0,
      isFci: false,
    };
  });

  const fci = (fciHeader ? getRowsAfterHeader(fciRows, fciHeader.headerIndex) : [])
    .map((row) => {
      const name = String(row[fciColumn.asset] || "").trim();
      const quantity = parseNumber(row[fciColumn.quantity]);
      const investedUsd = parseNumber(row[fciColumn.invested]) || quantity * parseNumber(row[fciColumn.purchasePrice]);
      const currentValueUsd = parseNumber(row[fciColumn.currentValue]) || quantity * parseNumber(row[fciColumn.currentPrice]);
      if (!name || (!investedUsd && !currentValueUsd)) return null;
      const gainUsd = currentValueUsd - investedUsd;
      return {
        symbol: name,
        name,
        type: "FCI",
        quantity,
        costUsd: investedUsd,
        costArs: investedUsd * currentMep,
        currentValueUsd,
        currentValueArs: currentValueUsd * currentMep,
        currentPrice: parseNumber(row[fciColumn.currentPrice]),
        currentPriceCurrency: "USD",
        averagePurchasePriceUsd: parseNumber(row[fciColumn.purchasePrice]),
        averagePurchasePriceArs: parseNumber(row[fciColumn.purchasePrice]) * currentMep,
        gainUsd,
        gainArs: gainUsd * currentMep,
        returnPct: investedUsd ? (gainUsd / investedUsd) * 100 : 0,
        isFci: true,
      };
    })
    .filter(Boolean);

  const liquidity = (liquidityHeader ? getRowsAfterHeader(liquidityRows, liquidityHeader.headerIndex) : [])
    .map((row) => {
      const concept = String(row[liquidityColumn.concept] || "").trim();
      const category = String(row[liquidityColumn.category] || "").trim();
      const currency = normalizeCurrency(row[liquidityColumn.currency]);
      const amount = parseNumber(row[liquidityColumn.amount]);
      if (!concept || amount <= 0) return null;

      const amountUsd = currency === "USD" ? amount : amount / currentMep;
      const amountArs = currency === "ARS" ? amount : amount * currentMep;
      return {
        symbol: `${concept} ${currency}`,
        name: `${concept} ${currency}`,
        category,
        currency,
        amount,
        currentValueUsd: amountUsd,
        currentValueArs: amountArs,
        inAllocation: normalizeHeader(category) === "liquidez" && currency === "ARS",
        isLiquidity: true,
      };
    })
    .filter(Boolean);

  const companyRowsData = companyHeader ? getRowsAfterHeader(companyRows, companyHeader.headerIndex) : [];
  const companyInput = companyRowsData.map((row) => ({
    symbol: String(row[companyColumn.symbol] || "").trim().toUpperCase(),
    type: String(row[companyColumn.type] || "").trim(),
    quantityValue: row[companyColumn.quantity],
    quantity: parseNumber(row[companyColumn.quantity]),
    currency: normalizeCurrency(row[companyColumn.currency]),
  })).filter((entry) => entry.symbol);
  const companyQuotes = await Promise.all(companyInput.map((entry) => getQuote(entry.symbol, entry.type)));
  const companyShares = companyInput.map((entry) => {
    const quote = companyQuotes.find((item) => item.symbol === entry.symbol);
    const currentValueUsd = quote.currency === "ARS" ? (entry.quantity * quote.price) / currentMep : entry.quantity * quote.price;
    const currentValueArs = quote.currency === "ARS" ? entry.quantity * quote.price : entry.quantity * quote.price * currentMep;
    return {
      symbol: entry.symbol,
      type: entry.type,
      quantity: entry.quantity,
      quantityMissing: entry.quantity <= 0,
      quantityInput: String(entry.quantityValue || "").trim(),
      currency: entry.currency,
      currentPrice: quote.price,
      currentPriceCurrency: quote.currency,
      quoteDate: quote.quoteDate,
      currentValueUsd,
      currentValueArs,
      isCompanyShare: true,
      inAllocation: false,
    };
  });

  const sales = [...salesBySymbol.values()]
    .map((sale) => ({
      ...sale,
      name: sale.symbol,
      gainUsd: sale.proceedsUsd - sale.costBasisUsd,
      gainArs: sale.proceedsArs - sale.costBasisArs,
      returnPct: sale.costBasisUsd ? ((sale.proceedsUsd - sale.costBasisUsd) / sale.costBasisUsd) * 100 : 0,
    }))
    .sort((a, b) => b.gainUsd - a.gainUsd);

  return {
    positions: [...positions, ...fci],
    sales,
    liquidity,
    companyShares,
    hasSalesSheet: Boolean(salesWorksheet),
    hasLiquiditySheet: Boolean(liquidityWorksheet),
    hasCompanySheet: Boolean(companyWorksheet),
    currentMep,
    quoteUpdatedAt: [...quotes, ...companyQuotes].map((quote) => quote.quoteDate).sort().at(-1) || "",
  };
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

  if (/No se encontró|No hay|No se pudo|Falta|Las ventas|Moneda no reconocida|El archivo es XLS antiguo|El archivo de Drive no es/.test(googleMessage)) {
    return googleMessage;
  }

  if (/GOOGLE_SERVICE_ACCOUNT_JSON/.test(googleMessage)) {
    return googleMessage;
  }

  return "No se pudo leer Google Sheets. Revisá el error del servidor y la configuración de credenciales y permisos.";
}

async function handleApiRequest(req, res, requestUrl) {
  const { pathname } = requestUrl;
  const method = req.method || "GET";

  if (pathname === "/api/config" && method === "GET") {
    sendJson(res, 200, {
      serviceAccountEmail: getServiceAccountEmail(),
      requiredSheets: ["Compras"],
      optionalSheets: ["FCI", "Ventas", "Liquidez", "Empresa"],
    });
    return;
  }

  if (pathname === "/api/session" && method === "GET") {
    const user = getSessionUser(req);
    sendJson(res, 200, user
      ? { authenticated: true, username: user.username, needsSetup: !user.sheet_file_id }
      : { authenticated: false });
    return;
  }

  if (["/api/register", "/api/login", "/api/logout", "/api/setup"].includes(pathname) && !isSameOrigin(req)) {
    sendJson(res, 403, { error: "Origen de solicitud no permitido." });
    return;
  }

  if (pathname === "/api/register" && method === "POST") {
    if (!allowAuthAttempt(getClientIp(req))) {
      sendJson(res, 429, { error: "Demasiados intentos. Esperá 15 minutos y volvé a probar." });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const username = normalizeUsername(body.username);
      const password = String(body.password || "");
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
        sendJson(res, 400, { error: "El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo." });
        return;
      }
      if (password.length < 6 || password.length > 128) {
        sendJson(res, 400, { error: "La contraseña debe tener entre 6 y 128 caracteres." });
        return;
      }

      const { salt, hash } = await createPasswordHash(password);
      let result;
      try {
        result = database.prepare("INSERT INTO users (username, password_salt, password_hash) VALUES (?, ?, ?)")
          .run(username, salt, hash);
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          sendJson(res, 409, { error: "Ese usuario ya existe. Iniciá sesión o elegí otro nombre." });
          return;
        }
        throw error;
      }

      createSession(result.lastInsertRowid, req, res);
      sendJson(res, 201, { authenticated: true, username, needsSetup: true });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "No se pudo crear la cuenta." });
    }
    return;
  }

  if (pathname === "/api/login" && method === "POST") {
    if (!allowAuthAttempt(getClientIp(req))) {
      sendJson(res, 429, { error: "Demasiados intentos. Esperá 15 minutos y volvé a probar." });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const username = normalizeUsername(body.username);
      const password = String(body.password || "");
      const user = database.prepare("SELECT id, username, password_salt, password_hash, sheet_file_id FROM users WHERE username = ?")
        .get(username);
      const passwordMatches = await verifyPassword(password, user);
      if (!user || !passwordMatches) {
        sendJson(res, 401, { error: "Usuario o contraseña incorrectos." });
        return;
      }

      createSession(user.id, req, res);
      sendJson(res, 200, { authenticated: true, username, needsSetup: !user.sheet_file_id });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "No se pudo iniciar sesión." });
    }
    return;
  }

  if (pathname === "/api/logout" && method === "POST") {
    clearSession(req, res);
    sendJson(res, 200, { authenticated: false });
    return;
  }

  if (pathname === "/api/setup" && method === "POST") {
    const user = getSessionUser(req);
    if (!user) {
      sendJson(res, 401, { error: "Iniciá sesión para configurar tu hoja." });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const fileId = extractDriveFileId(body.sheetUrl);
      const drive = createDriveClient();
      const metadata = await drive.files.get({ fileId, fields: "name,mimeType" });
      const supportedTypes = [
        "application/vnd.google-apps.spreadsheet",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ];
      if (!supportedTypes.includes(metadata.data.mimeType)) {
        sendJson(res, 400, { error: "El enlace debe apuntar a una hoja de Google o un archivo Excel .xlsx." });
        return;
      }

      database.prepare("UPDATE users SET sheet_file_id = ? WHERE id = ?").run(fileId, user.id);
      sendJson(res, 200, { configured: true, fileName: metadata.data.name || "hoja de cálculo" });
    } catch (error) {
      if (error.response?.status === 403 || error.response?.status === 404) {
        sendJson(res, 400, { error: `No puedo acceder al archivo. Compartilo con ${getServiceAccountEmail()} como Lector y volvé a guardar el link.` });
        return;
      }
      sendJson(res, error.statusCode || 400, { error: error.statusCode ? error.message : getSheetsErrorMessage(error) });
    }
    return;
  }

  if (pathname === "/api/portfolio") {
    if (method !== "GET") {
      sendJson(res, 405, { error: "Método no permitido." });
      return;
    }

    const user = getSessionUser(req);
    if (!user) {
      sendJson(res, 401, { error: "Iniciá sesión para ver tu cartera." });
      return;
    }
    if (!user.sheet_file_id) {
      sendJson(res, 409, { error: "Configurá el link de tu hoja para cargar la cartera." });
      return;
    }

    try {
      const portfolio = await getPortfolioRows(user.sheet_file_id);
      sendJson(res, 200, { ...portfolio, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error("No se pudo leer Google Sheets:", error.message);
      sendJson(res, 503, { error: getSheetsErrorMessage(error) });
    }
    return;
  }

  sendJson(res, 404, { error: "Ruta API no encontrada." });
}

const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    handleApiRequest(req, res, requestUrl).catch((error) => {
      console.error("Error de API:", error.message);
      sendJson(res, 500, { error: "Ocurrió un error procesando la solicitud." });
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
