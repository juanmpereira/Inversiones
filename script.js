const COLORS = ["#5977b5", "#52a886", "#e2aa55", "#8d78bd", "#de7e83", "#56a7b4", "#71849e", "#9bb478"];
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
	holdingsCount: document.querySelector("#holdings-count"),
	bestPerformer: document.querySelector("#best-performer"),
	bestPerformerFoot: document.querySelector("#best-performer-foot"),
	allocationChart: document.querySelector("#allocation-chart"),
	allocationCount: document.querySelector("#allocation-count"),
	allocationLegend: document.querySelector("#allocation-legend"),
	comparisonChart: document.querySelector("#comparison-chart"),
	positionsBody: document.querySelector("#positions-body"),
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

function renderSummary(assets) {
	const totalInvested = assets.reduce((sum, asset) => sum + asset.invested, 0);
	const totalCurrent = assets.reduce((sum, asset) => sum + asset.currentValue, 0);
	const totalGain = totalCurrent - totalInvested;
	const totalReturn = totalInvested ? (totalGain / totalInvested) * 100 : 0;
	const bestReturn = assets.filter((asset) => asset.invested > 0).sort((a, b) => b.returnPct - a.returnPct)[0];

	elements.totalCurrent.textContent = formatMoney(totalCurrent);
	elements.totalInvested.textContent = formatMoney(totalInvested);
	elements.totalGain.textContent = formatMoney(totalGain);
	applySignClass(elements.totalGain, totalGain);
	elements.totalReturn.textContent = `${formatPercent(totalReturn)} de rendimiento total`;
	applySignClass(elements.totalReturn, totalReturn);
	elements.holdingsCount.textContent = `${assets.length} activos consolidados`;

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
	const total = assets.reduce((sum, asset) => sum + Math.max(asset.currentValue, 0), 0);
	const sorted = [...assets].sort((a, b) => b.currentValue - a.currentValue);
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
	elements.allocationCount.textContent = String(assets.length);
	elements.allocationLegend.innerHTML = visible.length
		? visible.map((asset, index) => {
			const share = total ? (Math.max(asset.currentValue, 0) / total) * 100 : 0;
			return `<div class="legend-item"><i class="legend-dot" style="background:${COLORS[index % COLORS.length]}"></i><span class="legend-label">${escapeHtml(asset.name)}</span><span class="legend-value">${formatPercent(share)}</span></div>`;
		}).join("")
		: '<span class="empty-state">Sin datos para mostrar</span>';
}

function renderComparison(assets) {
	const largest = [...assets].sort((a, b) => b.currentValue - a.currentValue).slice(0, 8);
	const maximum = Math.max(1, ...largest.flatMap((asset) => [asset.invested, asset.currentValue]));
	elements.comparisonChart.innerHTML = largest.length
		? largest.map((asset) => {
			const investedWidth = Math.max(0, (asset.invested / maximum) * 100);
			const currentWidth = Math.max(0, (asset.currentValue / maximum) * 100);
			return `<div class="comparison-row" title="${escapeHtml(asset.name)}: invertido ${formatMoney(asset.invested)}; actual ${formatMoney(asset.currentValue)}">
				<span class="comparison-name">${escapeHtml(asset.name)}</span>
				<span class="bar-pair"><i class="bar-track"><i class="bar-fill invested" style="width:${investedWidth}%"></i></i><i class="bar-track"><i class="bar-fill current" style="width:${currentWidth}%"></i></i></span>
				<span class="comparison-value">${formatMoney(asset.currentValue)}</span>
			</div>`;
		}).join("")
		: '<p class="empty-state">Sin datos para comparar.</p>';
}

function renderPositions(assets) {
	elements.positionsBody.innerHTML = assets.length
		? assets.map((asset) => {
			const sign = asset.gain > 0 ? "positive" : asset.gain < 0 ? "negative" : "neutral";
			const initials = escapeHtml(asset.name.slice(0, 2).toUpperCase());
			return `<tr>
				<td><span class="asset-cell"><span class="asset-avatar">${initials}</span>${escapeHtml(asset.name)}</span></td>
				<td>${numberFormatter.format(asset.quantity)}</td>
				<td>${asset.averagePurchasePrice ? formatMoney(asset.averagePurchasePrice) : "—"}</td>
				<td>${asset.currentPrice ? formatMoney(asset.currentPrice) : "—"}</td>
				<td>${formatMoney(asset.invested)}</td>
				<td>${formatMoney(asset.currentValue)}</td>
				<td class="gain-cell ${sign}">${formatMoney(asset.gain)}</td>
				<td><span class="return-pill ${sign}">${asset.invested ? formatPercent(asset.returnPct) : "s/c"}</span></td>
			</tr>`;
		}).join("")
		: '<tr><td colspan="8" class="empty-state">La hoja no contiene posiciones con valores.</td></tr>';
}

async function loadPortfolio() {
	elements.refresh.disabled = true;
	elements.refresh.innerHTML = "⟳ Actualizando…";
	elements.notice.classList.add("hidden");
	elements.updated.textContent = "Leyendo Google Sheets…";

	try {
		const response = await fetch("/api/portfolio", { cache: "no-store" });
		const payload = await response.json();
		if (!response.ok) throw new Error(payload.error || "No se pudo cargar la hoja.");

		const assets = consolidateRows(payload.rows || []);
		renderSummary(assets);
		renderAllocation(assets);
		renderComparison(assets);
		renderPositions(assets);
		elements.updated.textContent = `Actualizado ${new Date(payload.updatedAt).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}`;
	} catch (error) {
		elements.updated.textContent = "No se pudieron actualizar los datos";
		elements.notice.textContent = error.message;
		elements.notice.classList.remove("hidden");
		elements.positionsBody.innerHTML = '<tr><td colspan="8" class="empty-state">No hay datos conectados todavía.</td></tr>';
	} finally {
		elements.refresh.disabled = false;
		elements.refresh.innerHTML = "<span aria-hidden=\"true\">⟳</span> Actualizar";
	}
}

elements.refresh.addEventListener("click", loadPortfolio);
loadPortfolio();
