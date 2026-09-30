const COLORS = ["#5977b5", "#52a886", "#e2aa55", "#8d78bd", "#de7e83", "#56a7b4", "#71849e", "#9bb478"];
const EXCLUDED_ALLOCATION_ASSETS = new Set(["blatam", "binome t-bill"]);
const moneyFormatter = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });
const percentageFormatter = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const elements = {
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
	cumulativeGain: document.querySelector("#cumulative-gain"),
	holdingsCount: document.querySelector("#holdings-count"),
	bestPerformer: document.querySelector("#best-performer"),
	bestPerformerFoot: document.querySelector("#best-performer-foot"),
	allocationChart: document.querySelector("#allocation-chart"),
	allocationCount: document.querySelector("#allocation-count"),
	allocationLegend: document.querySelector("#allocation-legend"),
	comparisonChart: document.querySelector("#comparison-chart"),
	positionsBody: document.querySelector("#positions-body"),
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
	return EXCLUDED_ALLOCATION_ASSETS.has(normalizeAsset(asset.name).toLocaleLowerCase("es"));
}

function consolidateRows(rows) {
	const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "activo"));
	if (headerIndex < 0) throw new Error("No se encontró el encabezado «Activo» en la primera columna de la hoja.");

	const headers = rows[headerIndex].map(normalizeHeader);
	const column = (name, fallback) => {
		const index = headers.indexOf(normalizeHeader(name));
		return index >= 0 ? index : fallback;
	};
	const columns = {
		asset: column("Activo", 0),
		quantity: column("Cantidad", 2),
		purchasePrice: column("Precio Compra", 3),
		invested: column("Invertido", 4),
		currentValue: column("Valor Actual", 5),
		currentPrice: column("Precio Actual", 8),
	};
	const grouped = new Map();
	let currentAsset = "";

	for (const row of rows.slice(headerIndex + 1)) {
		const priceValue = row[columns.purchasePrice];
		if (priceValue === "" || priceValue === null || priceValue === undefined) break;

		const explicitAsset = normalizeAsset(row[columns.asset]);
		if (explicitAsset) currentAsset = explicitAsset;
		if (!currentAsset) continue;

		const key = currentAsset.toLocaleLowerCase("es");
		if (!grouped.has(key)) {
			grouped.set(key, {
				name: currentAsset,
				quantity: 0,
				purchaseAmount: 0,
				purchaseQuantity: 0,
				invested: 0,
				currentValue: 0,
				currentPriceAmount: 0,
				currentPriceQuantity: 0,
				lastKnownPrice: 0,
			});
		}

		const asset = grouped.get(key);
		const quantity = parseNumber(row[columns.quantity]);
		const purchasePrice = parseNumber(row[columns.purchasePrice]);
		const currentPrice = parseNumber(row[columns.currentPrice]);
		const investedValue = parseNumber(row[columns.invested]) || quantity * purchasePrice;
		const currentValue = parseNumber(row[columns.currentValue]) || quantity * currentPrice;

		asset.quantity += quantity;
		asset.invested += investedValue;
		asset.currentValue += currentValue;
		if (currentPrice > 0) asset.lastKnownPrice = currentPrice;
		if (quantity > 0 && purchasePrice > 0) {
			asset.purchaseAmount += quantity * purchasePrice;
			asset.purchaseQuantity += quantity;
		}
		if (quantity > 0 && currentPrice > 0) {
			asset.currentPriceAmount += quantity * currentPrice;
			asset.currentPriceQuantity += quantity;
		}
	}

	return [...grouped.values()]
		.map((asset) => ({
			...asset,
			averagePurchasePrice: asset.purchaseQuantity ? asset.purchaseAmount / asset.purchaseQuantity : 0,
			currentPrice: asset.currentPriceQuantity ? asset.currentPriceAmount / asset.currentPriceQuantity : asset.lastKnownPrice,
			gain: asset.currentValue - asset.invested,
			returnPct: asset.invested ? ((asset.currentValue - asset.invested) / asset.invested) * 100 : 0,
		}))
		.filter((asset) => asset.quantity || asset.invested || asset.currentValue || asset.currentPrice)
		.sort((a, b) => b.gain - a.gain);
}

function formatMoney(value) {
	return `$${moneyFormatter.format(value)}`;
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

function renderSummary(assets, sales) {
	const totalInvested = roundMoney(assets.reduce((sum, asset) => sum + asset.invested, 0));
	const totalCurrent = roundMoney(assets.reduce((sum, asset) => sum + asset.currentValue, 0));
	const unrealizedGain = roundMoney(totalCurrent - totalInvested);
	const realizedGain = roundMoney(sales.reduce((sum, sale) => sum + sale.gain, 0));
	const cumulativeGain = roundMoney(unrealizedGain + realizedGain);
	const totalReturn = totalInvested ? (unrealizedGain / totalInvested) * 100 : 0;
	const bestReturn = assets.filter((asset) => asset.invested > 0).sort((a, b) => b.returnPct - a.returnPct)[0];

	elements.totalCurrent.textContent = formatMoney(totalCurrent);
	elements.totalInvested.textContent = formatMoney(totalInvested);
	elements.totalGain.textContent = formatMoney(unrealizedGain);
	applySignClass(elements.totalGain, unrealizedGain);
	elements.totalReturn.textContent = `${formatPercent(totalReturn)} en posiciones abiertas`;
	applySignClass(elements.totalReturn, totalReturn);
	elements.holdingsCount.textContent = `${assets.length} activos consolidados`;
	elements.realizedGain.textContent = formatMoney(realizedGain);
	applySignClass(elements.realizedGain, realizedGain);
	elements.salesCount.textContent = `${sales.reduce((sum, sale) => sum + sale.transactions, 0)} operaciones cerradas`;
	const ownCapitalEstimate = roundMoney(totalInvested - realizedGain);
	elements.ownCapitalEstimate.textContent = formatMoney(ownCapitalEstimate);
	elements.cumulativeGain.textContent = formatMoney(cumulativeGain);
	applySignClass(elements.cumulativeGain, cumulativeGain);

	if (bestReturn) {
		elements.bestPerformer.textContent = bestReturn.name;
		elements.bestPerformerFoot.textContent = `${formatPercent(bestReturn.returnPct)} de rendimiento`;
		applySignClass(elements.bestPerformerFoot, bestReturn.returnPct);
	} else {
		elements.bestPerformer.textContent = "—";
		elements.bestPerformerFoot.textContent = "Sin posiciones con costo cargado";
	}
}

function renderAllocation(assets) {
	const allocationAssets = assets.filter((asset) => !isExcludedFromAllocation(asset));
	const total = allocationAssets.reduce((sum, asset) => sum + Math.max(asset.currentValue, 0), 0);
	const sorted = [...allocationAssets].sort((a, b) => b.currentValue - a.currentValue);
	const visible = sorted.slice(0, 6);
	const others = sorted.slice(6).reduce((sum, asset) => sum + Math.max(asset.currentValue, 0), 0);
	if (others > 0) visible.push({ name: "Otros", currentValue: others });

	let cursor = 0;
	const segments = visible.map((asset, index) => {
		const percentage = total ? (Math.max(asset.currentValue, 0) / total) * 100 : 0;
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
			const share = total ? (Math.max(asset.currentValue, 0) / total) * 100 : 0;
			return `<div class="legend-item"><i class="legend-dot" style="background:${COLORS[index % COLORS.length]}"></i><span class="legend-label">${escapeHtml(asset.name)}</span><span class="legend-value">${formatPercent(share)}</span></div>`;
		}).join("")
		: '<span class="empty-state">Sin datos para mostrar</span>';
}

function renderComparison(assets) {
	const largestMovers = assets
		.filter((asset) => !isExcludedFromAllocation(asset))
		.filter((asset) => asset.invested > 0 || asset.currentValue > 0)
		.sort((a, b) => Math.abs(b.returnPct) - Math.abs(a.returnPct))
		.slice(0, 8);
	elements.comparisonChart.innerHTML = largestMovers.length
		? largestMovers.map((asset) => {
			const pairMaximum = Math.max(asset.invested, asset.currentValue, 1);
			const investedWidth = Math.max(0, (asset.invested / pairMaximum) * 100);
			const currentWidth = Math.max(0, (asset.currentValue / pairMaximum) * 100);
			const performanceClass = asset.returnPct > 0 ? "positive" : asset.returnPct < 0 ? "negative" : "neutral";
			return `<div class="comparison-row" title="${escapeHtml(asset.name)} — invertido: ${formatMoney(asset.invested)}; valor actual: ${formatMoney(asset.currentValue)}; rendimiento: ${formatPercent(asset.returnPct)}">
				<span class="comparison-asset"><span class="comparison-name">${escapeHtml(asset.name)}</span><span class="comparison-delta ${performanceClass}">${formatPercent(asset.returnPct)}</span></span>
				<span class="bar-pair">
					<span class="bar-track"><span class="bar-fill invested" style="width:${investedWidth}%"></span></span>
					<span class="bar-track"><span class="bar-fill current" style="width:${currentWidth}%"></span></span>
				</span>
				<span class="comparison-values"><span>${formatMoney(asset.invested)}</span><span>${formatMoney(asset.currentValue)}</span></span>
			</div>`;
		}).join("")
		: '<p class="empty-state">Sin datos para comparar.</p>';
}

function renderPositions(assets) {
	const totalCurrent = assets
		.filter((asset) => !isExcludedFromAllocation(asset))
		.reduce((sum, asset) => sum + asset.currentValue, 0);
	elements.positionsBody.innerHTML = assets.length
		? assets.map((asset) => {
			const sign = asset.gain > 0 ? "positive" : asset.gain < 0 ? "negative" : "neutral";
			const initials = escapeHtml(asset.name.slice(0, 2).toUpperCase());
			const excludedFromAllocation = isExcludedFromAllocation(asset);
			const portfolioWeight = totalCurrent && !excludedFromAllocation ? (asset.currentValue / totalCurrent) * 100 : 0;
			return `<tr>
				<td><span class="asset-cell"><span class="asset-avatar">${initials}</span>${escapeHtml(asset.name)}</span></td>
				<td>${excludedFromAllocation ? '<span class="panel-tag">Reserva</span>' : formatPercent(portfolioWeight)}</td>
				<td>${numberFormatter.format(asset.quantity)}</td>
				<td>${asset.averagePurchasePrice ? formatMoney(asset.averagePurchasePrice) : "—"}</td>
				<td>${asset.currentPrice ? formatMoney(asset.currentPrice) : "—"}</td>
				<td class="gain-cell ${sign}">${formatMoney(asset.gain)}</td>
				<td><span class="return-pill ${sign}">${asset.invested ? formatPercent(asset.returnPct) : "s/c"}</span></td>
			</tr>`;
		}).join("")
		: '<tr><td colspan="7" class="empty-state">La hoja no contiene posiciones con valores.</td></tr>';
}

function renderSales(sales) {
	const totalRealized = sales.reduce((sum, sale) => sum + sale.gain, 0);
	elements.salesTotalTag.textContent = `${sales.reduce((sum, sale) => sum + sale.transactions, 0)} operaciones`;
	elements.salesBody.innerHTML = sales.length
		? sales.map((sale) => {
			const sign = sale.gain > 0 ? "positive" : sale.gain < 0 ? "negative" : "neutral";
			return `<tr>
				<td><span class="asset-cell">${escapeHtml(sale.name)}</span></td>
				<td>${sale.transactions}</td>
				<td>${numberFormatter.format(sale.quantity)}</td>
				<td>${sale.averagePurchasePrice ? formatMoney(sale.averagePurchasePrice) : "—"}</td>
				<td>${sale.averageSalePrice ? formatMoney(sale.averageSalePrice) : "—"}</td>
				<td>${formatMoney(sale.invested)}</td>
				<td>${formatMoney(sale.saleTotal)}</td>
				<td class="gain-cell ${sign}">${formatMoney(sale.gain)}</td>
				<td><span class="return-pill ${sign}">${sale.invested ? formatPercent(sale.returnPct) : "s/c"}</span></td>
			</tr>`;
		}).join("")
		: '<tr><td colspan="9" class="empty-state">No hay operaciones cerradas registradas en la pestaña Ventas.</td></tr>';
	if (!sales.length && totalRealized !== 0) elements.salesTotalTag.textContent = "Revisar datos";
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

		const assets = consolidateRows(payload.positions || []);
		const sales = payload.sales || [];
		renderSummary(assets, sales);
		renderAllocation(assets);
		renderComparison(assets);
		renderPositions(assets);
		renderSales(sales);
		elements.updated.textContent = `Actualizado ${new Date(payload.updatedAt).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}`;
	} catch (error) {
		elements.updated.textContent = "No se pudieron actualizar los datos";
		elements.notice.textContent = error.message;
		elements.notice.classList.remove("hidden");
		elements.positionsBody.innerHTML = '<tr><td colspan="7" class="empty-state">No hay datos conectados todavía.</td></tr>';
		elements.salesBody.innerHTML = '<tr><td colspan="9" class="empty-state">No hay datos conectados todavía.</td></tr>';
	} finally {
		elements.refresh.disabled = false;
		elements.refresh.innerHTML = "<span aria-hidden=\"true\">⟳</span> Actualizar";
	}
}

elements.refresh.addEventListener("click", loadPortfolio);
elements.salesToggle.addEventListener("click", () => {
	const isExpanded = elements.salesToggle.getAttribute("aria-expanded") === "true";
	elements.salesToggle.setAttribute("aria-expanded", String(!isExpanded));
	elements.salesPanel.hidden = isExpanded;

	if (!isExpanded) {
		elements.salesPanel.scrollIntoView({ behavior: "smooth", block: "start" });
	}
});
loadPortfolio();
