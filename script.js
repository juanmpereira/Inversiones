const COLORS = ["#5977b5", "#52a886", "#e2aa55", "#8d78bd", "#de7e83", "#56a7b4", "#71849e", "#9bb478"];
const EXCLUDED_ALLOCATION_ASSETS = new Set(["blatam", "binome t-bill"]);
const moneyFormatter = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });
const percentageFormatter = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const elements = {
	authScreen: document.querySelector("#auth-screen"),
	setupScreen: document.querySelector("#setup-screen"),
	dashboard: document.querySelector("#dashboard"),
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
	totalGain: document.querySelector("#total-gain"),
	totalReturn: document.querySelector("#total-return"),
	realizedGain: document.querySelector("#realized-gain"),
	salesCount: document.querySelector("#sales-count"),
	ownCapitalEstimate: document.querySelector("#own-capital-estimate"),
	ownCapitalFoot: document.querySelector("#own-capital-foot"),
	cumulativeGain: document.querySelector("#cumulative-gain"),
	cumulativeGainFoot: document.querySelector("#cumulative-gain-foot"),
	holdingsCount: document.querySelector("#holdings-count"),
	bestPerformer: document.querySelector("#best-performer"),
	bestPerformerFoot: document.querySelector("#best-performer-foot"),
	allocationChart: document.querySelector("#allocation-chart"),
	allocationCount: document.querySelector("#allocation-count"),
	allocationLegend: document.querySelector("#allocation-legend"),
	comparisonChart: document.querySelector("#comparison-chart"),
	positionsBody: document.querySelector("#positions-body"),
	liquidityTotal: document.querySelector("#liquidity-total"),
	liquidityCard: document.querySelector("#liquidity-card"),
	liquidityPanel: document.querySelector("#liquidity-panel"),
	liquidityTotalArs: document.querySelector("#liquidity-total-ars"),
	liquidityCount: document.querySelector("#liquidity-count"),
	liquidityBody: document.querySelector("#liquidity-body"),
	companyBody: document.querySelector("#company-body"),
	companyPanel: document.querySelector("#company-panel"),
	salesBody: document.querySelector("#sales-body"),
	salesTotalTag: document.querySelector("#sales-total-tag"),
	salesToggle: document.querySelector("#sales-toggle"),
	salesPanel: document.querySelector("#sales-panel"),
};

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

function renderSummary(assets, sales, currentMep, liquidity, companyShares) {
	const totalInvestedUsd = roundMoney(assets.reduce((sum, asset) => sum + asset.costUsd, 0));
	const totalInvestedArs = roundMoney(assets.reduce((sum, asset) => sum + asset.costArs, 0));
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
	const liquidUsd = roundMoney(liquidity.reduce((sum, item) => sum + item.currentValueUsd, 0));
	const liquidArs = roundMoney(liquidity.reduce((sum, item) => sum + item.currentValueArs, 0));
	const unrealizedUsd = roundMoney(assets.reduce((sum, asset) => sum + asset.gainUsd, 0));
	const unrealizedArs = roundMoney(assets.reduce((sum, asset) => sum + asset.gainArs, 0));
	const realizedUsd = roundMoney(sales.reduce((sum, sale) => sum + sale.gainUsd, 0));
	const realizedArs = roundMoney(sales.reduce((sum, sale) => sum + sale.gainArs, 0));
	const cumulativeUsd = roundMoney(unrealizedUsd + realizedUsd);
	const cumulativeArs = roundMoney(unrealizedArs + realizedArs);
	const totalReturn = totalInvestedUsd ? (unrealizedUsd / totalInvestedUsd) * 100 : 0;
	const bestReturn = assets.filter((asset) => asset.costUsd > 0 && !asset.isFci).sort((a, b) => b.returnPct - a.returnPct)[0];

	elements.totalCurrent.textContent = formatUSD(totalCurrentUsd);
	elements.holdingsCount.textContent = `${formatARS(totalCurrentArs)} · inversiones, efectivo y empresa`;
	elements.liquidityTotal.textContent = formatUSD(liquidUsd);
	elements.liquidityTotalArs.textContent = `Equivalente total: ${formatARS(liquidArs)}`;
	elements.liquidityCount.textContent = `${liquidity.length} saldos`;
	elements.totalInvested.textContent = formatUSD(totalInvestedUsd);
	elements.totalInvested.nextElementSibling.textContent = `Base histórica: ${formatARS(totalInvestedArs)}`;
	elements.totalGain.textContent = formatUSD(unrealizedUsd);
	applySignClass(elements.totalGain, unrealizedUsd);
	elements.totalReturn.textContent = `${formatPercent(totalReturn)} · ${formatARS(unrealizedArs)} en posiciones abiertas`;
	applySignClass(elements.totalReturn, totalReturn);
	elements.realizedGain.textContent = formatUSD(realizedUsd);
	applySignClass(elements.realizedGain, realizedUsd);
	elements.salesCount.textContent = `${sales.reduce((sum, sale) => sum + sale.transactions, 0)} operaciones · ${formatARS(realizedArs)}`;
	const ownCapitalUsd = roundMoney(totalInvestedUsd - realizedUsd);
	elements.ownCapitalEstimate.textContent = formatUSD(ownCapitalUsd);
	elements.ownCapitalEstimate.nextElementSibling.textContent = `Equivalente: ${formatARS(roundMoney(ownCapitalUsd * currentMep))} · MEP ${moneyFormatter.format(currentMep)}`;
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
	const visible = sorted.slice(0, 6);
	const others = sorted.slice(6).reduce((sum, asset) => sum + Math.max(asset.currentValueUsd, 0), 0);
	if (others > 0) visible.push({ name: "Otros", currentValueUsd: others });

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

function renderComparison(assets) {
	const largestMovers = assets
		.filter((asset) => !isExcludedFromAllocation(asset))
		.filter((asset) => asset.costUsd > 0 || asset.currentValueUsd > 0)
		.sort((a, b) => Math.abs(b.returnPct) - Math.abs(a.returnPct))
		.slice(0, 8);
	elements.comparisonChart.innerHTML = largestMovers.length
		? largestMovers.map((asset) => {
			const pairMaximum = Math.max(asset.costUsd, asset.currentValueUsd, 1);
			const investedWidth = Math.max(0, (asset.costUsd / pairMaximum) * 100);
			const currentWidth = Math.max(0, (asset.currentValueUsd / pairMaximum) * 100);
			const performanceClass = asset.returnPct > 0 ? "positive" : asset.returnPct < 0 ? "negative" : "neutral";
			return `<div class="comparison-row" title="${escapeHtml(asset.symbol)} — invertido: ${formatUSD(asset.costUsd)}; valor actual: ${formatUSD(asset.currentValueUsd)}; rendimiento: ${formatPercent(asset.returnPct)}">
				<span class="comparison-asset"><span class="comparison-name">${escapeHtml(asset.symbol)}</span><span class="comparison-delta ${performanceClass}">${formatPercent(asset.returnPct)}</span></span>
				<span class="bar-pair">
					<span class="bar-track"><span class="bar-fill invested" style="width:${investedWidth}%"></span></span>
					<span class="bar-track"><span class="bar-fill current" style="width:${currentWidth}%"></span></span>
				</span>
				<span class="comparison-values"><span>${formatUSD(asset.costUsd)}</span><span>${formatUSD(asset.currentValueUsd)}</span></span>
			</div>`;
		}).join("")
		: '<p class="empty-state">Sin datos para comparar.</p>';
}

function renderPositions(assets, liquidity) {
	const totalCurrent = assets
		.filter((asset) => !isExcludedFromAllocation(asset))
		.reduce((sum, asset) => sum + asset.currentValueUsd, 0) +
		liquidity.filter((item) => item.inAllocation).reduce((sum, item) => sum + item.currentValueUsd, 0);
	const sortedAssets = [...assets].sort((a, b) => Math.abs(b.returnPct) - Math.abs(a.returnPct));
	elements.positionsBody.innerHTML = sortedAssets.length
		? sortedAssets.map((asset) => {
			const sign = asset.gainUsd > 0 ? "positive" : asset.gainUsd < 0 ? "negative" : "neutral";
			const initials = escapeHtml(asset.symbol.slice(0, 2).toUpperCase());
			const excludedFromAllocation = isExcludedFromAllocation(asset);
			const portfolioWeight = totalCurrent && !excludedFromAllocation ? (asset.currentValueUsd / totalCurrent) * 100 : 0;
			const currentPrice = asset.currentPriceCurrency === "ARS" ? formatARS(asset.currentPrice) : formatUSD(asset.currentPrice);
			return `<tr>
				<td><span class="asset-cell"><span class="asset-avatar">${initials}</span>${escapeHtml(asset.symbol)}</span></td>
				<td>${excludedFromAllocation ? '<span class="panel-tag">Reserva</span>' : formatPercent(portfolioWeight)}</td>
				<td>${numberFormatter.format(asset.quantity)}</td>
				<td>${asset.averagePurchasePriceUsd ? formatUSD(asset.averagePurchasePriceUsd) : "—"}</td>
				<td>${asset.currentPrice ? currentPrice : "—"}</td>
				<td class="gain-cell ${sign}">${formatUSD(asset.gainUsd)}</td>
				<td class="gain-cell ${asset.gainArs > 0 ? "positive" : asset.gainArs < 0 ? "negative" : ""}">${formatARS(asset.gainArs)}</td>
				<td><span class="return-pill ${sign}">${asset.costUsd ? formatPercent(asset.returnPct) : "s/c"}</span></td>
			</tr>`;
		}).join("")
		: '<tr><td colspan="8" class="empty-state">No hay posiciones abiertas para mostrar.</td></tr>';
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
		const hasSalesSheet = payload.hasSalesSheet !== false;
		elements.salesToggle.hidden = !hasSalesSheet;
		elements.salesPanel.hidden = true;
		elements.salesToggle.setAttribute("aria-expanded", "false");
		elements.liquidityCard.hidden = payload.hasLiquiditySheet === false;
		elements.liquidityPanel.hidden = payload.hasLiquiditySheet === false;
		elements.companyPanel.hidden = payload.hasCompanySheet === false;
		renderSummary(assets, sales, payload.currentMep, liquidity, companyShares);
		elements.ownCapitalFoot.textContent = hasSalesSheet ? "Abierto menos resultado neto de ventas*" : "Igual al invertido abierto";
		elements.cumulativeGainFoot.textContent = hasSalesSheet ? "Abiertas + ventas cerradas" : "Resultado abierto";
		renderAllocation(assets, liquidity);
		renderComparison(assets);
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
		elements.positionsBody.innerHTML = '<tr><td colspan="8" class="empty-state">No hay datos conectados todavía.</td></tr>';
		elements.liquidityBody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay datos conectados todavía.</td></tr>';
		elements.companyBody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay datos conectados todavía.</td></tr>';
		elements.salesBody.innerHTML = '<tr><td colspan="8" class="empty-state">No hay datos conectados todavía.</td></tr>';
	} finally {
		elements.refresh.disabled = false;
		elements.refresh.innerHTML = "<span aria-hidden=\"true\">⟳</span> Actualizar";
	}
}

elements.refresh.addEventListener("click", loadPortfolio);
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
elements.salesToggle.addEventListener("click", () => {
	const isExpanded = elements.salesToggle.getAttribute("aria-expanded") === "true";
	elements.salesToggle.setAttribute("aria-expanded", String(!isExpanded));
	elements.salesPanel.hidden = isExpanded;

	if (!isExpanded) {
		elements.salesPanel.scrollIntoView({ behavior: "smooth", block: "start" });
	}
});
initializeApp();
