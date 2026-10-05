const COLORS = ["#5977b5", "#52a886", "#e2aa55", "#8d78bd", "#de7e83", "#56a7b4", "#71849e", "#9bb478"];
const EXCLUDED_ALLOCATION_ASSETS = new Set(["blatam", "binome t-bill"]);
const LIQUIDITY_TARGET_SYMBOL = "__LIQUIDITY__";
const moneyFormatter = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });
const percentageFormatter = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const elements = {
	authScreen: document.querySelector("#auth-screen"),
	setupScreen: document.querySelector("#setup-screen"),
	dashboard: document.querySelector("#dashboard"),
	homeView: document.querySelector("#home-view"),
	portfolioView: document.querySelector("#portfolio-view"),
	homeNav: document.querySelector("#home-nav"),
	portfolioNav: document.querySelector("#portfolio-nav"),
	targetsNav: document.querySelector("#targets-nav"),
	allocationTargetView: document.querySelector("#allocation-target-view"),
	pageEyebrow: document.querySelector("#page-eyebrow"),
	pageTitle: document.querySelector("#page-title"),
	pageSubtitle: document.querySelector("#page-subtitle"),
	loginTab: document.querySelector("#login-tab"),
	registerTab: document.querySelector("#register-tab"),
	loginForm: document.querySelector("#login-form"),
	registerForm: document.querySelector("#register-form"),
	authMessage: document.querySelector("#auth-message"),
	setupMessage: document.querySelector("#setup-message"),
	setupForm: document.querySelector("#setup-form"),
	sheetLink: document.querySelector("#sheet-link"),
	serviceAccountEmail: document.querySelector("#service-account-email"),
	copyServiceEmail: document.querySelector("#copy-service-email"),
	setupLogout: document.querySelector("#setup-logout"),
	dashboardLogout: document.querySelector("#dashboard-logout"),
	signedInUser: document.querySelector("#signed-in-user"),
	refresh: document.querySelector("#refresh-button"),
	updated: document.querySelector("#last-updated"),
	notice: document.querySelector("#notice"),
	totalCurrent: document.querySelector("#total-current"),
	totalInvested: document.querySelector("#total-invested"),
	cumulativeGain: document.querySelector("#cumulative-gain"),
	holdingsCount: document.querySelector("#holdings-count"),
	bestPerformer: document.querySelector("#best-performer"),
	bestPerformerFoot: document.querySelector("#best-performer-foot"),
	allocationChart: document.querySelector("#allocation-chart"),
	allocationCount: document.querySelector("#allocation-count"),
	allocationLegend: document.querySelector("#allocation-legend"),
	allocationTargetsBody: document.querySelector("#allocation-targets-body"),
	targetPortfolioValue: document.querySelector("#target-portfolio-value"),
	targetPercentTotal: document.querySelector("#target-percent-total"),
	targetStatus: document.querySelector("#target-status"),
	saveTargets: document.querySelector("#save-targets-button"),
	calculateTargets: document.querySelector("#calculate-targets-button"),
	targetAddForm: document.querySelector("#target-add-form"),
	targetSymbolInput: document.querySelector("#target-symbol-input"),
	targetInstrumentType: document.querySelector("#target-instrument-type"),
	addTargetAssetButton: document.querySelector("#add-target-asset-button"),
	positionsBody: document.querySelector("#positions-body"),
	liquidityPanel: document.querySelector("#liquidity-panel"),
	liquidityCount: document.querySelector("#liquidity-count"),
	liquidityBody: document.querySelector("#liquidity-body"),
	companyBody: document.querySelector("#company-body"),
	companyPanel: document.querySelector("#company-panel"),
	salesBody: document.querySelector("#sales-body"),
	salesTotalTag: document.querySelector("#sales-total-tag"),
	salesPanel: document.querySelector("#sales-panel"),
};

let allocationTargets = [];
let allocationRows = [];
let allocationTotalUsd = 0;
let allocationMep = 0;
let allocationPortfolioAssets = [];
let allocationPortfolioLiquidity = [];
const allocationQuoteCache = new Map();
let targetQuoteRequestSequence = 0;

function parseNumber(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	if (value === null || value === undefined || value === "") return 0;

	let text = String(value).trim().replace(/\s/g, "").replace(/%$/, "");
	if (!text) return 0;

	const comma = text.lastIndexOf(",");
	const dot = text.lastIndexOf(".");
	if (comma >= 0 && dot >= 0) {
		text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
	} else if (comma >= 0) {
		text = text.replace(",", ".");
	}

	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeHeader(value) {
	return String(value || "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim()
		.toLowerCase();
}

function normalizeAsset(value) {
	return String(value || "").trim().replace(/\s+/g, " ");
}

function isExcludedFromAllocation(asset) {
	if (asset.inAllocation !== undefined) return !asset.inAllocation;
	return asset.isFci || EXCLUDED_ALLOCATION_ASSETS.has(normalizeAsset(asset.name).toLocaleLowerCase("es"));
}

function formatUSD(value) {
	return `US$ ${moneyFormatter.format(value)}`;
}

function formatARS(value) {
	return `ARS ${moneyFormatter.format(value)}`;
}

function formatMoney(value) {
	return formatUSD(value);
}

function roundMoney(value) {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatPercent(value) {
	return `${percentageFormatter.format(value)}%`;
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (character) => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
	})[character]);
}

function applySignClass(element, value) {
	element.classList.toggle("positive", value > 0);
	element.classList.toggle("negative", value < 0);
}

function showScreen(screen) {
	elements.authScreen.hidden = screen !== "auth";
	elements.setupScreen.hidden = screen !== "setup";
	elements.dashboard.hidden = screen !== "dashboard";
	if (screen === "dashboard") setDashboardView("home", false);
}

function setDashboardView(view, scroll = true) {
	const isHome = view === "home";
	const isPortfolio = view === "portfolio";
	elements.homeView.hidden = !isHome;
	elements.portfolioView.hidden = !isPortfolio;
	elements.allocationTargetView.hidden = view !== "targets";
	elements.homeNav.classList.toggle("active", isHome);
	elements.portfolioNav.classList.toggle("active", isPortfolio);
	elements.targetsNav.classList.toggle("active", view === "targets");
	if (isHome) {
		elements.homeNav.setAttribute("aria-current", "page");
		elements.portfolioNav.removeAttribute("aria-current");
		elements.targetsNav.removeAttribute("aria-current");
		elements.pageEyebrow.textContent = "TU RESUMEN FINANCIERO";
		elements.pageTitle.textContent = "Inicio";
		elements.pageSubtitle.textContent = "Una mirada clara a tus inversiones y su evolución.";
	} else if (isPortfolio) {
		elements.portfolioNav.setAttribute("aria-current", "page");
		elements.homeNav.removeAttribute("aria-current");
		elements.targetsNav.removeAttribute("aria-current");
		elements.pageEyebrow.textContent = "TUS POSICIONES";
		elements.pageTitle.textContent = "Mi cartera";
		elements.pageSubtitle.textContent = "Posiciones abiertas, liquidez y operaciones realizadas.";
	} else {
		elements.targetsNav.setAttribute("aria-current", "page");
		elements.homeNav.removeAttribute("aria-current");
		elements.portfolioNav.removeAttribute("aria-current");
		elements.pageEyebrow.textContent = "REBALANCEO INFORMATIVO";
		elements.pageTitle.textContent = "Composición objetivo";
		elements.pageSubtitle.textContent = "Compará tu distribución actual con la que querés alcanzar.";
	}
	if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function showMessage(element, message) {
	element.textContent = message;
	element.classList.toggle("hidden", !message);
}

function setAuthMode(mode) {
	const isLogin = mode === "login";
	elements.loginForm.hidden = !isLogin;
	elements.registerForm.hidden = isLogin;
	elements.loginTab.classList.toggle("active", isLogin);
	elements.registerTab.classList.toggle("active", !isLogin);
	elements.loginTab.setAttribute("aria-selected", String(isLogin));
	elements.registerTab.setAttribute("aria-selected", String(!isLogin));
	showMessage(elements.authMessage, "");
}

async function requestJson(url, options = {}) {
	const response = await fetch(url, {
		credentials: "same-origin",
		...options,
		headers: { "Content-Type": "application/json", ...(options.headers || {}) },
	});
	const payload = await response.json();
	if (!response.ok) throw new Error(payload.error || "No se pudo completar la solicitud.");
	return payload;
}

async function showSetup(username) {
	showScreen("setup");
	elements.signedInUser.textContent = username || "";
	showMessage(elements.setupMessage, "");
	try {
		const config = await requestJson("/api/config");
		elements.serviceAccountEmail.textContent = config.serviceAccountEmail || "No está configurada en el servidor";
	} catch (error) {
		elements.serviceAccountEmail.textContent = error.message;
	}
}

async function handleAuthSubmit(event, endpoint) {
	event.preventDefault();
	const form = event.currentTarget;
	const submit = form.querySelector("button[type='submit']");
	const formData = new FormData(form);
	submit.disabled = true;
	showMessage(elements.authMessage, "");

	try {
		const result = await requestJson(endpoint, {
			method: "POST",
			body: JSON.stringify({ username: formData.get("username"), password: formData.get("password") }),
		});
		if (result.needsSetup) {
			await showSetup(result.username);
		} else {
			showScreen("dashboard");
			elements.signedInUser.textContent = result.username;
			await loadPortfolio();
		}
	} catch (error) {
		showMessage(elements.authMessage, error.message);
	} finally {
		submit.disabled = false;
	}
}

async function initializeApp() {
	showScreen("auth");
	try {
		const session = await requestJson("/api/session");
		if (!session.authenticated) return;
		if (session.needsSetup) {
			await showSetup(session.username);
			return;
		}
		elements.signedInUser.textContent = session.username;
		showScreen("dashboard");
		await loadPortfolio();
	} catch (error) {
		showMessage(elements.authMessage, error.message);
	}
}

async function logout() {
	try {
		await requestJson("/api/logout", { method: "POST", body: "{}" });
	} finally {
		elements.loginForm.reset();
		elements.registerForm.reset();
		setAuthMode("login");
		showScreen("auth");
	}
}

function renderSummary(assets, sales, liquidity, companyShares) {
	const totalInvestedUsd = roundMoney(assets.reduce((sum, asset) => sum + asset.costUsd, 0));
	const totalCurrentUsd = roundMoney(
		assets.reduce((sum, asset) => sum + asset.currentValueUsd, 0) +
		liquidity.reduce((sum, item) => sum + item.currentValueUsd, 0) +
		companyShares.reduce((sum, share) => sum + share.currentValueUsd, 0),
	);
	const totalCurrentArs = roundMoney(
		assets.reduce((sum, asset) => sum + asset.currentValueArs, 0) +
		liquidity.reduce((sum, item) => sum + item.currentValueArs, 0) +
		companyShares.reduce((sum, share) => sum + share.currentValueArs, 0),
	);
	const unrealizedUsd = roundMoney(assets.reduce((sum, asset) => sum + asset.gainUsd, 0));
	const unrealizedArs = roundMoney(assets.reduce((sum, asset) => sum + asset.gainArs, 0));
	const realizedUsd = roundMoney(sales.reduce((sum, sale) => sum + sale.gainUsd, 0));
	const realizedArs = roundMoney(sales.reduce((sum, sale) => sum + sale.gainArs, 0));
	const cumulativeUsd = roundMoney(unrealizedUsd + realizedUsd);
	const cumulativeArs = roundMoney(unrealizedArs + realizedArs);
	const bestReturn = assets.filter((asset) => asset.costUsd > 0 && !asset.isFci).sort((a, b) => b.returnPct - a.returnPct)[0];

	elements.totalCurrent.textContent = formatUSD(totalCurrentUsd);
	elements.holdingsCount.textContent = `${formatARS(totalCurrentArs)} · inversiones, efectivo y empresa`;
	elements.totalInvested.textContent = formatUSD(totalInvestedUsd);
	elements.cumulativeGain.textContent = formatUSD(cumulativeUsd);
	applySignClass(elements.cumulativeGain, cumulativeUsd);
	elements.cumulativeGain.nextElementSibling.textContent = `Equivalente: ${formatARS(cumulativeArs)}`;

	if (bestReturn) {
		elements.bestPerformer.textContent = bestReturn.symbol;
		elements.bestPerformerFoot.textContent = `${formatPercent(bestReturn.returnPct)} en USD`;
		applySignClass(elements.bestPerformerFoot, bestReturn.returnPct);
	} else {
		elements.bestPerformer.textContent = "—";
		elements.bestPerformerFoot.textContent = "Sin posiciones con costo";
	}
}

function renderAllocation(assets, liquidity) {
	const allocationAssets = [
		...assets.filter((asset) => !isExcludedFromAllocation(asset)),
		...liquidity.filter((item) => item.inAllocation),
	];
	const total = allocationAssets.reduce((sum, asset) => sum + Math.max(asset.currentValueUsd, 0), 0);
	const sorted = [...allocationAssets].sort((a, b) => b.currentValueUsd - a.currentValueUsd);
	const visible = sorted.slice(0, 10);
	if (sorted.length > 10) {
		const others = sorted.slice(10).reduce((sum, asset) => sum + Math.max(asset.currentValueUsd, 0), 0);
		if (others > 0) visible.push({ name: "Otros", currentValueUsd: others });
	}

	let cursor = 0;
	const segments = visible.map((asset, index) => {
		const percentage = total ? (Math.max(asset.currentValueUsd, 0) / total) * 100 : 0;
		const start = cursor;
		cursor += percentage;
		return `${COLORS[index % COLORS.length]} ${start}% ${cursor}%`;
	});
	elements.allocationChart.style.background = segments.length
		? `conic-gradient(${segments.join(", ")})`
		: "conic-gradient(#e9edf4 0 100%)";
	elements.allocationCount.textContent = String(allocationAssets.length);
	elements.allocationLegend.innerHTML = visible.length
		? visible.map((asset, index) => {
			const share = total ? (Math.max(asset.currentValueUsd, 0) / total) * 100 : 0;
			return `<div class="legend-item"><i class="legend-dot" style="background:${COLORS[index % COLORS.length]}"></i><span class="legend-label">${escapeHtml(asset.name)}</span><span class="legend-value">${formatPercent(share)}</span></div>`;
		}).join("")
		: '<span class="empty-state">Sin datos para mostrar</span>';
}

function getAllocationTargetInputs() {
	return [...elements.allocationTargetsBody.querySelectorAll("[data-target-symbol]")];
}

function getAllocationTargetPercentages() {
	return getAllocationTargetInputs().map((input) => ({
		symbol: input.dataset.targetSymbol,
		targetPercent: Number(input.value || 0),
		instrumentType: elements.allocationTargetsBody.querySelector(`[data-instrument-symbol="${CSS.escape(input.dataset.targetSymbol)}"]`)?.value
			|| input.dataset.targetInstrumentType,
	}));
}

function captureAllocationTargetsFromForm() {
	allocationTargets = getAllocationTargetPercentages();
}

function getAllocationTargetTotal() {
	return getAllocationTargetPercentages().reduce((sum, target) => sum + target.targetPercent, 0);
}

function hasValidAllocationTargetTotal() {
	const inputs = getAllocationTargetInputs();
	const valuesAreValid = inputs.length > 0 && inputs.every((input) => {
		const value = Number(input.value || 0);
		return Number.isFinite(value) && value >= 0 && value <= 100;
	});
	return valuesAreValid && Math.abs(getAllocationTargetTotal() - 100) <= 0.005;
}

function updateAllocationTargetControls(message = "", isError = false) {
	const total = getAllocationTargetTotal();
	const valid = hasValidAllocationTargetTotal();
	elements.targetPercentTotal.textContent = formatPercent(total);
	elements.saveTargets.disabled = !valid;
	const rowsMissingQuotes = allocationRows.filter((row) => row.instrumentType !== "LIQUIDITY" && !row.quote);
	elements.calculateTargets.disabled = !valid || allocationTotalUsd <= 0 || rowsMissingQuotes.length > 0;
	elements.targetStatus.classList.toggle("error", isError);
	elements.targetStatus.textContent = message || (valid
		? allocationTotalUsd <= 0
			? "No hay valor de cartera disponible para calcular."
			: rowsMissingQuotes.length
				? `Falta una cotización válida para ${rowsMissingQuotes.map((row) => row.symbol).join(", ")}; no se puede calcular todavía.`
				: "La distribución suma 100%. Ya podés guardar o calcular."
		: "La suma de los porcentajes debe ser 100%.");
}

function clearAllocationTargetResults() {
	for (const row of allocationRows) {
		const cell = elements.allocationTargetsBody.querySelector(`[data-allocation-row="${CSS.escape(row.symbol)}"] .target-result`);
		if (!cell) continue;
		cell.textContent = row.quoteError || "—";
		cell.classList.remove("positive", "negative");
	}
}

function getTargetInstrumentLabel(instrumentType) {
	return instrumentType === "CEDEAR" ? "CEDEAR · ARS" : "Acción · USD";
}

function isValidTargetSymbol(symbol) {
	return /^[A-Z0-9.^=_-]{1,20}$/.test(symbol);
}

function getAllocationQuoteKey(symbol, instrumentType) {
	return `${symbol}|${instrumentType}`;
}

async function fetchAllocationTargetQuote(symbol, instrumentType) {
	return requestJson("/api/allocation-target-quote", {
		method: "POST",
		body: JSON.stringify({ symbol, instrumentType }),
	});
}

async function renderAllocationTargets(assets, liquidity, currentMep) {
	allocationPortfolioAssets = assets;
	allocationPortfolioLiquidity = liquidity;
	allocationMep = currentMep;
	const targetAssets = assets
		.filter((asset) => !asset.isFci && !isExcludedFromAllocation(asset))
		.sort((a, b) => a.symbol.localeCompare(b.symbol, "es"));
	const currentCashUsd = liquidity.reduce((sum, item) => sum + Math.max(item.currentValueUsd, 0), 0);
	const savedTargetsBySymbol = new Map(allocationTargets.map((target) => [target.symbol.toUpperCase(), target]));
	const heldSymbols = new Set(targetAssets.map((asset) => asset.symbol.toUpperCase()));
	allocationRows = [
		...targetAssets.map((asset) => ({
			symbol: asset.symbol.toUpperCase(),
			name: asset.symbol,
			instrumentType: normalizeHeader(asset.type).includes("cedear") ? "CEDEAR" : "Acción EEUU",
			currentValueUsd: Math.max(asset.currentValueUsd, 0),
			asset,
			quote: {
				currentPrice: asset.currentPrice,
				currentPriceCurrency: asset.currentPriceCurrency,
			},
		})),
		...allocationTargets
			.filter((target) => target.symbol !== LIQUIDITY_TARGET_SYMBOL && !heldSymbols.has(target.symbol.toUpperCase()))
			.map((target) => ({
				symbol: target.symbol.toUpperCase(),
				name: target.symbol.toUpperCase(),
				instrumentType: target.instrumentType || "CEDEAR",
				currentValueUsd: 0,
				asset: null,
				quote: allocationQuoteCache.get(getAllocationQuoteKey(target.symbol.toUpperCase(), target.instrumentType || "CEDEAR")) || null,
				quoteError: "",
			})),
		{
			symbol: LIQUIDITY_TARGET_SYMBOL,
			name: "Liquidez",
			instrumentType: "LIQUIDITY",
			currentValueUsd: currentCashUsd,
			asset: null,
			quote: null,
		},
	];
	allocationTotalUsd = allocationRows.reduce((sum, row) => sum + row.currentValueUsd, 0);
	allocationMep = currentMep;
	elements.targetPortfolioValue.textContent = formatUSD(allocationTotalUsd);
	elements.allocationTargetsBody.innerHTML = allocationRows.map((row) => {
		const target = savedTargetsBySymbol.get(row.symbol);
		const currentPercent = allocationTotalUsd ? (row.currentValueUsd / allocationTotalUsd) * 100 : 0;
		return `<tr data-allocation-row="${escapeHtml(row.symbol)}">
			<td><span class="asset-cell">${escapeHtml(row.name)}</span></td>
			<td>${row.instrumentType === "LIQUIDITY"
				? "Efectivo"
				: row.asset
					? escapeHtml(getTargetInstrumentLabel(row.instrumentType))
					: `<select class="target-instrument-select" data-instrument-symbol="${escapeHtml(row.symbol)}" aria-label="Tipo de ${escapeHtml(row.name)}"><option value="CEDEAR" ${row.instrumentType === "CEDEAR" ? "selected" : ""}>CEDEAR · ARS</option><option value="Acción EEUU" ${row.instrumentType === "Acción EEUU" ? "selected" : ""}>Acción · USD</option></select>`}</td>
			<td>${formatUSD(row.currentValueUsd)}</td>
			<td>${formatPercent(currentPercent)}</td>
			<td><label class="target-input-wrap"><input class="target-percent-input" data-target-symbol="${escapeHtml(row.symbol)}" data-target-instrument-type="${escapeHtml(row.instrumentType)}" type="number" min="0" max="100" step="0.01" value="${target ? target.targetPercent : 0}" aria-label="Porcentaje objetivo para ${escapeHtml(row.name)}"><span>%</span></label></td>
			<td class="target-value">—</td>
			<td class="target-result">${row.quoteError ? escapeHtml(row.quoteError) : "—"}</td>
			<td>${row.asset || row.instrumentType === "LIQUIDITY" ? "" : `<button class="target-remove-button" data-remove-target="${escapeHtml(row.symbol)}" type="button" aria-label="Quitar ${escapeHtml(row.name)} de objetivos">Quitar</button>`}</td>
		</tr>`;
	}).join("");

	const unquotedRows = allocationRows.filter((row) => row.instrumentType !== "LIQUIDITY" && !row.quote);
	await Promise.all(unquotedRows.map(async (row) => {
		try {
			const quote = await fetchAllocationTargetQuote(row.symbol, row.instrumentType);
			allocationQuoteCache.set(getAllocationQuoteKey(row.symbol, row.instrumentType), quote);
			row.quote = quote;
		} catch (error) {
			row.quoteError = error.message;
		}
	}));
	for (const row of unquotedRows) {
		const resultCell = elements.allocationTargetsBody.querySelector(`[data-allocation-row="${CSS.escape(row.symbol)}"] .target-result`);
		if (resultCell) resultCell.textContent = row.quoteError || "Cotización lista";
	}
	updateAllocationTargetControls();
}

function calculateAllocationTargets() {
	if (!hasValidAllocationTargetTotal() || allocationTotalUsd <= 0) {
		updateAllocationTargetControls();
		return;
	}

	const percentages = new Map(getAllocationTargetPercentages().map((target) => [target.symbol, target.targetPercent]));
	const targetValues = new Map(allocationRows.map((row) => [
		row.symbol,
		allocationTotalUsd * (percentages.get(row.symbol) || 0) / 100,
	]));
	const trades = new Map();
	let netPurchasesUsd = 0;

	for (const row of allocationRows) {
		if (row.instrumentType === "LIQUIDITY") continue;
		const differenceUsd = targetValues.get(row.symbol) - row.currentValueUsd;
		const quote = row.quote || row.asset;
		const priceUsd = quote.currentPriceCurrency === "ARS"
			? quote.currentPrice / allocationMep
			: quote.currentPrice;
		if (Math.abs(differenceUsd) < 0.01 || !Number.isFinite(priceUsd) || priceUsd <= 0) {
			trades.set(row.symbol, { differenceUsd, priceUsd, quote, units: 0, tradeUsd: 0 });
			continue;
		}

		const unitsNeeded = Math.floor((Math.abs(differenceUsd) + 1e-9) / priceUsd);
		const availableUnits = row.asset ? Math.floor(row.asset.quantity + 1e-9) : 0;
		const units = differenceUsd > 0 ? unitsNeeded : Math.min(unitsNeeded, availableUnits);
		const tradeUsd = units * priceUsd * (differenceUsd > 0 ? 1 : -1);
		trades.set(row.symbol, { differenceUsd, priceUsd, quote, units, tradeUsd });
		netPurchasesUsd += tradeUsd;
	}

	for (const row of allocationRows) {
		const targetValueUsd = targetValues.get(row.symbol);
		const targetValueCell = elements.allocationTargetsBody.querySelector(`[data-allocation-row="${CSS.escape(row.symbol)}"] .target-value`);
		const resultCell = elements.allocationTargetsBody.querySelector(`[data-allocation-row="${CSS.escape(row.symbol)}"] .target-result`);
		targetValueCell.textContent = formatUSD(targetValueUsd);
		resultCell.classList.remove("positive", "negative");

		if (row.instrumentType === "LIQUIDITY") {
			const projectedCashUsd = row.currentValueUsd - netPurchasesUsd;
			const cashGapUsd = projectedCashUsd - targetValueUsd;
			if (Math.abs(cashGapUsd) < 0.01) {
				resultCell.textContent = `Liquidez estimada: ${formatUSD(projectedCashUsd)}; objetivo alineado`;
			} else if (cashGapUsd < 0) {
				resultCell.textContent = `Quedarían ${formatUSD(projectedCashUsd)}; ${formatUSD(Math.abs(cashGapUsd))} por debajo del objetivo`;
				resultCell.classList.add("positive");
			} else {
				resultCell.textContent = `Quedarían ${formatUSD(projectedCashUsd)}; ${formatUSD(cashGapUsd)} por encima del objetivo`;
				resultCell.classList.add("negative");
			}
			continue;
		}

		const trade = trades.get(row.symbol);
		if (Math.abs(trade.differenceUsd) < 0.01) {
			resultCell.textContent = "Mantener";
			continue;
		}

		if (!Number.isFinite(trade.priceUsd) || trade.priceUsd <= 0) {
			resultCell.textContent = "Sin cotización válida";
			resultCell.classList.add("negative");
			continue;
		}
		if (trade.units === 0) {
			const remaining = Math.abs(trade.differenceUsd);
			const nativeUnitPrice = trade.quote.currentPriceCurrency === "ARS"
				? formatARS(trade.quote.currentPrice)
				: formatUSD(trade.quote.currentPrice);
			if (trade.differenceUsd > 0) {
				resultCell.textContent = `No alcanza para 1 unidad (${nativeUnitPrice}); faltan ${formatUSD(Math.max(0, trade.priceUsd - remaining))} para comprarla`;
			} else if (row.asset && Math.floor(row.asset.quantity + 1e-9) === 0) {
				resultCell.textContent = `No hay unidades enteras para vender; quedan ${formatUSD(remaining)} por encima del objetivo`;
			} else {
				resultCell.textContent = `El exceso no alcanza para vender 1 unidad (${nativeUnitPrice}); quedan ${formatUSD(remaining)} por encima del objetivo`;
			}
			resultCell.classList.add(trade.differenceUsd > 0 ? "positive" : "negative");
			continue;
		}

		const action = trade.differenceUsd > 0 ? "Comprar" : "Vender";
		const remainingUsd = Math.abs(trade.differenceUsd - trade.tradeUsd);
		const nativePrice = trade.quote.currentPriceCurrency === "ARS"
			? formatARS(trade.quote.currentPrice)
			: formatUSD(trade.quote.currentPrice);
		const nativeTotal = trade.quote.currentPriceCurrency === "ARS"
			? formatARS(trade.quote.currentPrice * trade.units)
			: formatUSD(trade.quote.currentPrice * trade.units);
		const remainingAmount = trade.quote.currentPriceCurrency === "ARS"
			? `${formatARS(remainingUsd * allocationMep)} (≈ ${formatUSD(remainingUsd)})`
			: formatUSD(remainingUsd);
		const remainingLabel = trade.differenceUsd > 0 ? "por debajo" : "por encima";
		resultCell.textContent = `${action} ${numberFormatter.format(trade.units)} un. a ${nativePrice} c/u (${nativeTotal}); quedan ${remainingAmount} ${remainingLabel} del objetivo`;
		resultCell.classList.add(trade.differenceUsd > 0 ? "positive" : "negative");
	}
	updateAllocationTargetControls("Estimación informativa calculada con las cotizaciones actuales.");
}

function renderPositions(assets, liquidity) {
	const totalCurrent = assets
		.filter((asset) => !isExcludedFromAllocation(asset))
		.reduce((sum, asset) => sum + asset.currentValueUsd, 0) +
		liquidity.filter((item) => item.inAllocation).reduce((sum, item) => sum + item.currentValueUsd, 0);
	const sortedAssets = [...assets].sort((a, b) => b.returnPct - a.returnPct || b.gainUsd - a.gainUsd);
	elements.positionsBody.innerHTML = sortedAssets.length
		? sortedAssets.map((asset) => {
			const sign = asset.gainUsd > 0 ? "positive" : asset.gainUsd < 0 ? "negative" : "neutral";
			const initials = escapeHtml(asset.symbol.slice(0, 2).toUpperCase());
			const excludedFromAllocation = isExcludedFromAllocation(asset);
			const portfolioWeight = totalCurrent && !excludedFromAllocation ? (asset.currentValueUsd / totalCurrent) * 100 : 0;
			const age = formatHoldingAge(asset.averagePurchaseDate);
			return `<tr>
				<td><span class="asset-cell"><span class="asset-avatar">${initials}</span>${escapeHtml(asset.symbol)}</span></td>
				<td>${excludedFromAllocation ? '<span class="panel-tag">Reserva</span>' : formatPercent(portfolioWeight)}</td>
				<td class="gain-cell ${sign}">${formatUSD(asset.gainUsd)}</td>
				<td><span class="return-pill ${sign}">${asset.costUsd ? formatPercent(asset.returnPct) : "s/c"}</span></td>
				<td>${age}</td>
			</tr>`;
		}).join("")
		: '<tr><td colspan="5" class="empty-state">No hay posiciones abiertas para mostrar.</td></tr>';
}

function formatHoldingAge(acquisitionDate) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(acquisitionDate || "")) return "—";
	const [year, month, day] = acquisitionDate.split("-").map(Number);
	const parsedDate = new Date(Date.UTC(year, month - 1, day));
	if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day) return "—";
	const now = new Date();
	let months = (now.getFullYear() - year) * 12 + now.getMonth() + 1 - month;
	if (now.getDate() < day) months -= 1;
	if (months < 0) return "—";
	if (months === 0) return "Menos de 1 mes";
	return `${months} ${months === 1 ? "mes" : "meses"}`;
}

function renderLiquidity(liquidity) {
	elements.liquidityBody.innerHTML = liquidity.length
		? liquidity.map((item) => `<tr>
			<td><span class="asset-cell">${escapeHtml(item.name)}</span></td>
			<td>${escapeHtml(item.category)}</td>
			<td>${escapeHtml(item.currency)}</td>
			<td>${item.currency === "ARS" ? formatARS(item.amount) : formatUSD(item.amount)}</td>
			<td>${formatUSD(item.currentValueUsd)}</td>
			<td>${item.inAllocation ? "Sí" : "No, reserva"}</td>
		</tr>`).join("")
		: '<tr><td colspan="6" class="empty-state">No hay saldos registrados en Liquidez.</td></tr>';
}

function renderCompanyShares(shares) {
	elements.companyBody.innerHTML = shares.length
		? shares.map((share) => {
			const quote = share.currentPriceCurrency === "ARS" ? formatARS(share.currentPrice) : formatUSD(share.currentPrice);
			const status = share.quantityMissing ? `Completá cantidad (actual: ${escapeHtml(share.quantityInput || "vacía")})` : "Cotización actual";
			return `<tr>
				<td><span class="asset-cell">${escapeHtml(share.symbol)}</span></td>
				<td>${share.quantityMissing ? "—" : numberFormatter.format(share.quantity)}</td>
				<td>${quote}</td>
				<td>${formatUSD(share.currentValueUsd)}</td>
				<td>${formatARS(share.currentValueArs)}</td>
				<td>${status}</td>
			</tr>`;
		}).join("")
		: '<tr><td colspan="6" class="empty-state">No hay tenencias registradas en Empresa.</td></tr>';
}

function renderSales(sales) {
	elements.salesTotalTag.textContent = `${sales.reduce((sum, sale) => sum + sale.transactions, 0)} operaciones`;
	elements.salesBody.innerHTML = sales.length
		? sales.map((sale) => {
			const sign = sale.gainUsd > 0 ? "positive" : sale.gainUsd < 0 ? "negative" : "neutral";
			return `<tr>
				<td><span class="asset-cell">${escapeHtml(sale.symbol)}</span></td>
				<td>${sale.transactions}</td>
				<td>${numberFormatter.format(sale.quantity)}</td>
				<td>${formatUSD(sale.costBasisUsd)}</td>
				<td>${formatUSD(sale.proceedsUsd)}</td>
				<td class="gain-cell ${sign}">${formatUSD(sale.gainUsd)}</td>
				<td class="gain-cell ${sale.gainArs > 0 ? "positive" : sale.gainArs < 0 ? "negative" : ""}">${formatARS(sale.gainArs)}</td>
				<td><span class="return-pill ${sign}">${sale.costBasisUsd ? formatPercent(sale.returnPct) : "s/c"}</span></td>
			</tr>`;
		}).join("")
		: '<tr><td colspan="8" class="empty-state">No hay operaciones cerradas registradas en la pestaña Ventas.</td></tr>';
}

async function loadPortfolio() {
	elements.refresh.disabled = true;
	elements.refresh.innerHTML = "⟳ Actualizando…";
	elements.notice.classList.add("hidden");
		elements.updated.textContent = "Leyendo datos de Drive…";

	try {
		const response = await fetch("/api/portfolio", { cache: "no-store" });
		const payload = await response.json();
		if (!response.ok) throw new Error(payload.error || "No se pudo cargar la hoja.");

		const assets = payload.positions || [];
		const sales = payload.sales || [];
		const liquidity = payload.liquidity || [];
		const companyShares = payload.companyShares || [];
		const targetPayload = await requestJson("/api/allocation-targets");
		allocationTargets = targetPayload.targets || [];
		const hasSalesSheet = payload.hasSalesSheet !== false;
		elements.salesPanel.hidden = !hasSalesSheet;
		elements.liquidityPanel.hidden = payload.hasLiquiditySheet === false;
		elements.companyPanel.hidden = payload.hasCompanySheet === false;
		renderSummary(assets, sales, liquidity, companyShares);
		renderAllocation(assets, liquidity);
		renderAllocationTargets(assets, liquidity, payload.currentMep);
		renderPositions(assets, liquidity);
		renderLiquidity(liquidity);
		renderCompanyShares(companyShares);
		renderSales(sales);
		const quoteDate = payload.quoteUpdatedAt ? new Date(`${payload.quoteUpdatedAt}T12:00:00`).toLocaleDateString("es-AR") : "sin fecha";
		elements.updated.textContent = `Actualizado ${new Date(payload.updatedAt).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })} · cotizaciones ${quoteDate} · MEP ${moneyFormatter.format(payload.currentMep)}`;
	} catch (error) {
		elements.updated.textContent = "No se pudieron actualizar los datos";
		elements.notice.textContent = error.message;
		elements.notice.classList.remove("hidden");
		elements.positionsBody.innerHTML = '<tr><td colspan="5" class="empty-state">No hay datos conectados todavía.</td></tr>';
		elements.liquidityBody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay datos conectados todavía.</td></tr>';
		elements.companyBody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay datos conectados todavía.</td></tr>';
		elements.salesBody.innerHTML = '<tr><td colspan="8" class="empty-state">No hay datos conectados todavía.</td></tr>';
	} finally {
		elements.refresh.disabled = false;
		elements.refresh.innerHTML = "<span aria-hidden=\"true\">⟳</span> Actualizar";
	}
}

elements.refresh.addEventListener("click", loadPortfolio);
elements.homeNav.addEventListener("click", () => setDashboardView("home"));
elements.portfolioNav.addEventListener("click", () => setDashboardView("portfolio"));
elements.targetsNav.addEventListener("click", () => setDashboardView("targets"));
elements.allocationTargetsBody.addEventListener("input", (event) => {
	if (!event.target.matches("[data-target-symbol]")) return;
	clearAllocationTargetResults();
	updateAllocationTargetControls();
});
elements.allocationTargetsBody.addEventListener("change", async (event) => {
	if (event.target.matches("[data-instrument-symbol]")) {
		const symbol = event.target.dataset.instrumentSymbol;
		const row = allocationRows.find((item) => item.symbol === symbol);
		if (!row) return;
		row.instrumentType = event.target.value;
		row.quote = null;
		row.quoteError = "";
		const requestId = ++targetQuoteRequestSequence;
		row.quoteRequestId = requestId;
		const input = elements.allocationTargetsBody.querySelector(`[data-target-symbol="${CSS.escape(symbol)}"]`);
		input.dataset.targetInstrumentType = row.instrumentType;
		const resultCell = elements.allocationTargetsBody.querySelector(`[data-allocation-row="${CSS.escape(symbol)}"] .target-result`);
		clearAllocationTargetResults();
		resultCell.textContent = "Consultando cotización…";
		updateAllocationTargetControls();
		try {
			const quote = await fetchAllocationTargetQuote(symbol, row.instrumentType);
			if (row.quoteRequestId !== requestId) return;
			row.quote = quote;
			allocationQuoteCache.set(getAllocationQuoteKey(symbol, row.instrumentType), quote);
			resultCell.textContent = "Cotización lista";
		} catch (error) {
			if (row.quoteRequestId !== requestId) return;
			row.quoteError = error.message;
			resultCell.textContent = error.message;
		}
		clearAllocationTargetResults();
		updateAllocationTargetControls();
		return;
	}
});
elements.allocationTargetsBody.addEventListener("click", async (event) => {
	const button = event.target.closest("[data-remove-target]");
	if (!button) return;
	captureAllocationTargetsFromForm();
	allocationTargets = allocationTargets.filter((target) => target.symbol !== button.dataset.removeTarget);
	await renderAllocationTargets(allocationPortfolioAssets, allocationPortfolioLiquidity, allocationMep);
});
elements.targetAddForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const symbol = elements.targetSymbolInput.value.trim().toUpperCase();
	const instrumentType = elements.targetInstrumentType.value;
	if (!isValidTargetSymbol(symbol)) {
		updateAllocationTargetControls("Ingresá un símbolo válido.", true);
		return;
	}
	if (allocationRows.some((row) => row.symbol === symbol)) {
		updateAllocationTargetControls(`${symbol} ya aparece en los objetivos.`, true);
		return;
	}
	elements.addTargetAssetButton.disabled = true;
	elements.targetStatus.classList.remove("error");
	elements.targetStatus.textContent = `Consultando cotización de ${symbol}…`;
	try {
		const quote = await fetchAllocationTargetQuote(symbol, instrumentType);
		allocationQuoteCache.set(getAllocationQuoteKey(symbol, instrumentType), quote);
		captureAllocationTargetsFromForm();
		allocationTargets.push({ symbol, targetPercent: 0, instrumentType });
		elements.targetAddForm.reset();
		elements.targetInstrumentType.value = "CEDEAR";
		await renderAllocationTargets(allocationPortfolioAssets, allocationPortfolioLiquidity, allocationMep);
		const row = allocationRows.find((item) => item.symbol === symbol);
		if (row) row.quote = quote;
		updateAllocationTargetControls(`${symbol} agregado. Asignale un porcentaje objetivo.`);
	} catch (error) {
		updateAllocationTargetControls(error.message, true);
	} finally {
		elements.addTargetAssetButton.disabled = false;
	}
});
elements.saveTargets.addEventListener("click", async () => {
	elements.saveTargets.disabled = true;
	elements.targetStatus.classList.remove("error");
	elements.targetStatus.textContent = "Guardando porcentajes…";
	try {
		await requestJson("/api/allocation-targets", {
			method: "PUT",
			body: JSON.stringify({ targets: getAllocationTargetPercentages() }),
		});
		allocationTargets = getAllocationTargetPercentages();
		updateAllocationTargetControls("Porcentajes guardados en tu cuenta.");
	} catch (error) {
		updateAllocationTargetControls(error.message, true);
	} finally {
		elements.saveTargets.disabled = !hasValidAllocationTargetTotal();
	}
});
elements.calculateTargets.addEventListener("click", calculateAllocationTargets);
elements.loginTab.addEventListener("click", () => setAuthMode("login"));
elements.registerTab.addEventListener("click", () => setAuthMode("register"));
elements.loginForm.addEventListener("submit", (event) => handleAuthSubmit(event, "/api/login"));
elements.registerForm.addEventListener("submit", (event) => handleAuthSubmit(event, "/api/register"));
elements.setupForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const submit = elements.setupForm.querySelector("button[type='submit']");
	submit.disabled = true;
	showMessage(elements.setupMessage, "");
	try {
		await requestJson("/api/setup", {
			method: "POST",
			body: JSON.stringify({ sheetUrl: elements.sheetLink.value }),
		});
		elements.setupForm.reset();
		showScreen("dashboard");
		await loadPortfolio();
	} catch (error) {
		showMessage(elements.setupMessage, error.message);
	} finally {
		submit.disabled = false;
	}
});
elements.setupLogout.addEventListener("click", logout);
elements.dashboardLogout.addEventListener("click", logout);
elements.copyServiceEmail.addEventListener("click", async () => {
	const email = elements.serviceAccountEmail.textContent;
	if (!email || email.includes("No está configurada")) return;
	try {
		await navigator.clipboard.writeText(email);
		elements.copyServiceEmail.textContent = "Copiado";
		setTimeout(() => { elements.copyServiceEmail.textContent = "Copiar"; }, 1500);
	} catch {
		showMessage(elements.setupMessage, "No pude copiarlo automáticamente. Seleccioná el correo y copialo manualmente.");
	}
});
initializeApp();
