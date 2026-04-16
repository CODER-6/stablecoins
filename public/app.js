const STABLECOINS_API_BASE = "/api/stablecoins";
const YIELDS_API_BASE = "/api/yields";
const STABLECOINS_URL = `${STABLECOINS_API_BASE}/stablecoins`;
const YIELDS_URL = `${YIELDS_API_BASE}/pools`;
const GLOBAL_HISTORY_URL = `${STABLECOINS_API_BASE}/stablecoincharts/all`;
const EXCLUDED_YIELD_PROTOCOL_RULES = [{ chain: "berachain", project: "bex" }];

const state = {
  stablecoins: [],
  chains: [],
  selectedSymbol: "",
  topLimit: 12,
  apySamples: [],
  allApySamples: [],
  apyMatchMode: "strict",
  distributionMode: "total",
  stackMode: "dominance",
  chartRangeDays: 365,
  comboStablecoinMode: "merged",
  comboProtocolMode: "merged",
  historyCache: new Map(),
  poolChartCache: new Map(),
  globalHistory: [],
  lastUpdated: null,
};

const elements = {
  status: document.querySelector("#status"),
  totalMarketCap: document.querySelector("#total-market-cap"),
  stablecoinCount: document.querySelector("#stablecoin-count"),
  chainCount: document.querySelector("#chain-count"),
  globalApy: document.querySelector("#global-apy"),
  marketShareList: document.querySelector("#market-share-list"),
  marketShareCaption: document.querySelector("#market-share-caption"),
  chainApyList: document.querySelector("#chain-apy-list"),
  selectedTitle: document.querySelector("#selected-title"),
  selectedCaption: document.querySelector("#selected-caption"),
  selectedChainList: document.querySelector("#selected-chain-list"),
  selectedApyCaption: document.querySelector("#selected-apy-caption"),
  selectedApyList: document.querySelector("#selected-apy-list"),
  protocolDistributionTitle: document.querySelector("#protocol-distribution-title"),
  protocolDistributionCaption: document.querySelector("#protocol-distribution-caption"),
  protocolDistributionList: document.querySelector("#protocol-distribution-list"),
  poolTableBody: document.querySelector("#pool-table-body"),
  stablecoinSelect: document.querySelector("#stablecoin-select"),
  stablecoinOptions: document.querySelector("#stablecoin-options"),
  topLimit: document.querySelector("#top-limit"),
  apyMatchMode: document.querySelector("#apy-match-mode"),
  distributionMode: document.querySelector("#distribution-mode"),
  refreshBtn: document.querySelector("#refresh-btn"),
  globalTrendChart: document.querySelector("#global-trend-chart"),
  selectedTrendTitle: document.querySelector("#selected-trend-title"),
  selectedTrendCaption: document.querySelector("#selected-trend-caption"),
  selectedTrendChart: document.querySelector("#selected-trend-chart"),
  comboChart: document.querySelector("#combo-chart"),
  stackChart: document.querySelector("#stack-chart"),
  stackModeDominance: document.querySelector("#stack-mode-dominance"),
  stackModeArea: document.querySelector("#stack-mode-area"),
  comboExportCsv: document.querySelector("#combo-export-csv"),
  comboExportPng: document.querySelector("#combo-export-png"),
  stackExportCsv: document.querySelector("#stack-export-csv"),
  stackExportPng: document.querySelector("#stack-export-png"),
};

elements.topLimit.addEventListener("change", () => {
  state.topLimit = Number(elements.topLimit.value);
  render();
});

elements.stablecoinSelect.addEventListener("change", async () => {
  const value = elements.stablecoinSelect.value.trim().toUpperCase();
  if (state.stablecoins.some((coin) => coin.symbol === value)) {
    state.selectedSymbol = value;
    await ensureSelectedChartsData();
    render();
  }
});

elements.apyMatchMode.addEventListener("change", async () => {
  state.apyMatchMode = elements.apyMatchMode.value;
  await ensureSelectedYieldHistory();
  render();
});

elements.distributionMode.addEventListener("change", () => {
  state.distributionMode = elements.distributionMode.value;
  render();
});

elements.refreshBtn.addEventListener("click", () => {
  loadDashboard();
});

elements.stackModeDominance.addEventListener("click", () => {
  state.stackMode = "dominance";
  render();
});

elements.stackModeArea.addEventListener("click", () => {
  state.stackMode = "area";
  render();
});

elements.comboExportCsv.addEventListener("click", () => exportChartCsv("combo"));
elements.comboExportPng.addEventListener("click", () => exportChartPng("combo"));
elements.stackExportCsv.addEventListener("click", () => exportChartCsv("stack"));
elements.stackExportPng.addEventListener("click", () => exportChartPng("stack"));

document.querySelectorAll("[data-info-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const targetId = button.getAttribute("data-info-target");
    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }

    const nextHidden = !target.hidden;
    document.querySelectorAll(".info-popover").forEach((popover) => {
      popover.hidden = true;
    });
    target.hidden = nextHidden;
  });
});

loadDashboard();

async function loadDashboard() {
  setStatus("正在从 DefiLlama 拉取实时数据…");
  elements.refreshBtn.disabled = true;

  try {
    const [stablecoinResponse, yieldsResponse, globalHistoryResponse] = await Promise.all([
      fetchJson(STABLECOINS_URL),
      fetchJson(YIELDS_URL),
      fetchJson(GLOBAL_HISTORY_URL),
    ]);

    const processed = processDataset(
      stablecoinResponse.peggedAssets ?? [],
      yieldsResponse.data ?? [],
    );

    state.stablecoins = processed.stablecoins;
    state.chains = processed.chains;
    state.allApySamples = processed.apySamples;
    state.globalHistory = processGlobalHistory(globalHistoryResponse ?? []);
    state.selectedSymbol =
      state.selectedSymbol && state.stablecoins.some((coin) => coin.symbol === state.selectedSymbol)
        ? state.selectedSymbol
        : processed.defaultSymbol;
    state.lastUpdated = new Date();

    await ensureSelectedChartsData();
    populateStablecoinOptions();
    render();

    const updatedTime = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(state.lastUpdated);
    setStatus(`数据已更新，时间 ${updatedTime}`);
  } catch (error) {
    console.error(error);
    setStatus(`加载失败：${error.message}`, true);
  } finally {
    elements.refreshBtn.disabled = false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败 ${response.status}: ${url}`);
  }
  return response.json();
}

function processDataset(peggedAssets, pools) {
  const stablecoins = peggedAssets
    .filter((asset) => asset.pegType === "peggedUSD" && Number(asset.circulating?.peggedUSD) > 0)
    .map((asset) => {
      const chainDistribution = Object.entries(asset.chainCirculating ?? {})
        .map(([chain, info]) => ({
          chain,
          marketCap: Number(info?.current?.peggedUSD ?? 0),
        }))
        .filter((entry) => entry.marketCap > 0)
        .sort((a, b) => b.marketCap - a.marketCap);

      return {
        id: asset.id,
        name: asset.name,
        symbol: normalizeSymbol(asset.symbol),
        price: Number(asset.price ?? 1),
        marketCap: Number(asset.circulating?.peggedUSD ?? 0),
        pegMechanism: asset.pegMechanism,
        chainDistribution,
      };
    })
    .sort((a, b) => b.marketCap - a.marketCap);

  const symbolSet = new Set(stablecoins.map((coin) => coin.symbol));
  const chainApyMap = new Map();
  const symbolChainApyMap = new Map();
  const apySamples = [];

  for (const pool of pools) {
    if (!pool.stablecoin || !Number.isFinite(pool.apy) || !Number.isFinite(pool.tvlUsd) || pool.tvlUsd <= 0) {
      continue;
    }
    if (shouldExcludeYieldPool(pool)) {
      continue;
    }

    const normalizedChain = pool.chain || "Unknown";
    accumulateWeighted(chainApyMap, normalizedChain, pool.apy, pool.tvlUsd);

    const poolSymbols = extractPoolSymbols(pool.symbol, symbolSet);
    for (const symbol of poolSymbols) {
      accumulateWeighted(symbolChainApyMap, `${symbol}::${normalizedChain}`, pool.apy, pool.tvlUsd);
    }

    apySamples.push({
      pool: pool.pool,
      chain: normalizedChain,
      project: pool.project,
      symbol: pool.symbol,
      apy: Number(pool.apy),
      tvlUsd: Number(pool.tvlUsd),
    });
  }

  const chains = Array.from(chainApyMap.entries())
    .map(([chain, value]) => ({
      chain,
      weightedApy: value.weightedSum / value.weight,
      tvlUsd: value.weight,
    }))
    .sort((a, b) => b.weightedApy - a.weightedApy);

  for (const coin of stablecoins) {
    coin.apyByChain = coin.chainDistribution
      .map(({ chain }) => {
        const apyValue = symbolChainApyMap.get(`${coin.symbol}::${chain}`);
        return apyValue
          ? {
              chain,
              weightedApy: apyValue.weightedSum / apyValue.weight,
              tvlUsd: apyValue.weight,
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.weightedApy - a.weightedApy);
  }

  return {
    stablecoins,
    chains,
    apySamples: apySamples.sort((a, b) => b.tvlUsd - a.tvlUsd),
    defaultSymbol: stablecoins[0]?.symbol ?? "",
  };
}

function shouldExcludeYieldPool(pool) {
  const normalizedChain = normalizeFilterValue(pool.chain);
  const normalizedProject = normalizeFilterValue(pool.project);

  return EXCLUDED_YIELD_PROTOCOL_RULES.some((rule) => {
    const chainMatches = !rule.chain || normalizeFilterValue(rule.chain) === normalizedChain;
    const projectMatches = !rule.project || normalizeFilterValue(rule.project) === normalizedProject;
    return chainMatches && projectMatches;
  });
}

function normalizeFilterValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function processGlobalHistory(points) {
  return points
    .map((point) => ({
      date: Number(point.date) * 1000,
      total: Number(point.totalCirculatingUSD?.peggedUSD ?? point.totalCirculating?.peggedUSD ?? 0),
    }))
    .filter((point) => point.date && point.total > 0)
    .slice(-180);
}

function accumulateWeighted(map, key, apy, weight) {
  const current = map.get(key) ?? { weightedSum: 0, weight: 0 };
  current.weightedSum += apy * weight;
  current.weight += weight;
  map.set(key, current);
}

function extractPoolSymbols(symbolText, symbolSet, mode = "expanded") {
  const candidates = String(symbolText)
    .toUpperCase()
    .replaceAll(".", "-")
    .split(/[^A-Z0-9]+/)
    .map(normalizeSymbol)
    .filter(Boolean);

  const matched = new Set();
  for (const token of candidates) {
    if (symbolSet.has(token)) {
      matched.add(token);
      continue;
    }

    if (mode === "strict") {
      continue;
    }

    const trimmedPrefixes = [
      token.replace(/^S/, ""),
      token.replace(/^STK/, ""),
      token.replace(/^W/, ""),
      token.replace(/-E$/, ""),
      token.replace(/^USD[A-Z]/, ""),
    ].filter(Boolean);

    for (const candidate of trimmedPrefixes) {
      if (symbolSet.has(candidate)) {
        matched.add(candidate);
      }
    }
  }

  return [...matched];
}

function normalizeSymbol(value) {
  return String(value ?? "").trim().toUpperCase();
}

function render() {
  if (!state.stablecoins.length) {
    return;
  }

  const totalMarketCap = state.stablecoins.reduce((sum, coin) => sum + coin.marketCap, 0);
  const allChains = new Set();
  for (const coin of state.stablecoins) {
    for (const entry of coin.chainDistribution) {
      allChains.add(entry.chain);
    }
  }

  const globalApy = weightedAverage(state.chains);
  const selectedCoin = state.stablecoins.find((coin) => coin.symbol === state.selectedSymbol) ?? state.stablecoins[0];
  const selectedHistory = getSelectedHistory(selectedCoin.id);
  const distributionRows = getDistributionRows(selectedCoin, selectedHistory, state.distributionMode);
  const selectedApyRows = getSelectedApyRows(selectedCoin.symbol);
  const protocolRows = getProtocolDistributionRows(selectedCoin.symbol);
  state.apySamples = getSelectedPoolRows(selectedCoin.symbol);

  elements.totalMarketCap.textContent = formatUsd(totalMarketCap);
  elements.stablecoinCount.textContent = String(state.stablecoins.length);
  elements.chainCount.textContent = String(allChains.size);
  elements.globalApy.textContent = formatPercent(globalApy);
  elements.marketShareCaption.textContent = `Top ${state.topLimit} / ${state.stablecoins.length}`;
  elements.selectedTitle.textContent = `${selectedCoin.symbol} 跨链分布`;
  elements.selectedCaption.textContent = `${selectedCoin.name} · ${formatUsd(selectedCoin.marketCap)}`;
  elements.selectedApyCaption.textContent = selectedApyRows.length
    ? `覆盖 ${selectedApyRows.length} 条链 · ${state.apyMatchMode === "strict" ? "严格匹配" : "扩展匹配"}`
    : "暂无收益率样本";
  elements.protocolDistributionTitle.textContent = `${selectedCoin.symbol} 在各协议的分布`;
  const protocolTrackedTotal = protocolRows.reduce((sum, item) => sum + item.tvlUsd, 0);
  elements.protocolDistributionCaption.textContent = protocolTrackedTotal
    ? `已追踪协议总量 ${formatUsd(protocolTrackedTotal)}`
    : "暂无协议覆盖";
  elements.selectedTrendTitle.textContent = `${selectedCoin.symbol} 趋势`;
  elements.selectedTrendCaption.textContent = selectedHistory.series.length
    ? "总量 / 原生净流通 / 桥接流出"
    : "暂无历史覆盖";
  elements.stablecoinSelect.value = selectedCoin.symbol;
  elements.apyMatchMode.value = state.apyMatchMode;
  elements.distributionMode.value = state.distributionMode;
  elements.stackModeDominance.classList.toggle("active", state.stackMode === "dominance");
  elements.stackModeArea.classList.toggle("active", state.stackMode === "area");

  renderComboStudio();
  renderStackStudio(selectedCoin, selectedHistory);

  renderBarList(
    elements.marketShareList,
    state.stablecoins.slice(0, state.topLimit).map((coin) => ({
      title: `${coin.symbol} · ${coin.name}`,
      subtitle: coin.pegMechanism || "unknown",
      value: formatUsd(coin.marketCap),
      width: totalMarketCap ? (coin.marketCap / totalMarketCap) * 100 : 0,
      fillClass: "",
    })),
  );

  const maxChainApy = Math.max(...state.chains.slice(0, state.topLimit).map((item) => item.weightedApy), 0);
  renderBarList(
    elements.chainApyList,
    state.chains.slice(0, state.topLimit).map((item) => ({
      title: item.chain,
      subtitle: `样本 TVL ${formatUsd(item.tvlUsd)}`,
      value: formatPercent(item.weightedApy),
      width: maxChainApy ? (item.weightedApy / maxChainApy) * 100 : 0,
      fillClass: "apy",
    })),
  );

  const selectedTotalForMode = distributionRows.reduce((sum, entry) => sum + entry.value, 0);
  renderBarList(
    elements.selectedChainList,
    distributionRows.slice(0, state.topLimit).map((entry) => ({
      title: entry.chain,
      subtitle: `${selectedTotalForMode ? ((entry.value / selectedTotalForMode) * 100).toFixed(2) : "0.00"}% of ${selectedCoin.symbol}`,
      value: formatUsd(entry.value),
      width: selectedTotalForMode ? (entry.value / selectedTotalForMode) * 100 : 0,
      fillClass: "alt",
    })),
    "该稳定币暂无跨链分布数据。",
  );

  const maxSelectedApy = Math.max(...selectedApyRows.map((item) => item.weightedApy), 0);
  renderBarList(
    elements.selectedApyList,
    selectedApyRows.slice(0, state.topLimit).map((item) => ({
      title: item.chain,
      subtitle: `样本 TVL ${formatUsd(item.tvlUsd)}`,
      value: formatPercent(item.weightedApy),
      width: maxSelectedApy ? (item.weightedApy / maxSelectedApy) * 100 : 0,
      fillClass: "apy",
    })),
    "这个稳定币暂时没有匹配到足够的 DefiLlama 收益率样本。",
  );

  renderBarList(
    elements.protocolDistributionList,
    protocolRows.slice(0, state.topLimit).map((item) => ({
      title: item.project,
      subtitle: `${item.poolCount} pools · ${protocolTrackedTotal ? ((item.tvlUsd / protocolTrackedTotal) * 100).toFixed(2) : "0.00"}% of tracked protocol TVL`,
      value: formatUsd(item.tvlUsd),
      width: protocolTrackedTotal ? (item.tvlUsd / protocolTrackedTotal) * 100 : 0,
      fillClass: "apy",
    })),
    "这个稳定币暂时没有匹配到足够的协议样本。",
  );

  renderSingleLineChart(
    elements.globalTrendChart,
    state.globalHistory,
    [
      { key: "total", label: "总市值", className: "total" },
    ],
    "暂无全市场历史数据。",
  );

  renderSingleLineChart(
    elements.selectedTrendChart,
    selectedHistory.series,
    [
      { key: "total", label: "总流通", className: "total" },
      { key: "native", label: "原生净流通", className: "native" },
      { key: "bridged", label: "桥接流出", className: "bridged" },
    ],
    "这个稳定币暂时没有可用的历史数据。",
  );

  renderPoolTable(selectedCoin.symbol);
}

function renderBarList(container, items, emptyText = "暂无数据。") {
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    return;
  }

  container.innerHTML = items
    .map(
      (item) => `
        <div class="bar-row">
          <div class="bar-meta">
            <div>
              <div class="bar-title">${escapeHtml(item.title)}</div>
              <div class="bar-subtitle">${escapeHtml(item.subtitle)}</div>
            </div>
            <div class="bar-value">${escapeHtml(item.value)}</div>
          </div>
          <div class="bar-track">
            <div class="bar-fill ${item.fillClass}" style="width:${Math.max(item.width, 1)}%"></div>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderPoolTable(selectedSymbol) {
  const rows = state.apySamples.slice(0, 12);

  if (!rows.length) {
    elements.poolTableBody.innerHTML = `
      <tr>
        <td colspan="5">没有匹配到 ${escapeHtml(selectedSymbol)} 的收益率样本池。</td>
      </tr>
    `;
    return;
  }

  elements.poolTableBody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.chain)}</td>
          <td>${escapeHtml(row.project)}</td>
          <td>${escapeHtml(row.symbol)}</td>
          <td>${escapeHtml(formatPercent(row.apy))}</td>
          <td>${escapeHtml(formatUsd(row.tvlUsd))}</td>
        </tr>
      `,
    )
    .join("");
}

function renderComboStudio() {
  const focusSymbols = getFocusStablecoinSymbols();
  const groups = getComboGroups(focusSymbols).map((group) => ({
    ...group,
    series: applyRange(buildPoolGroupSeries(group.pools), state.chartRangeDays),
  }));
  const note = `稳定币取市值前 3 名：${focusSymbols.join(" / ")}；每个币只取 TVL 前 3 个池；APY按TVL加权`;

  elements.comboChart.innerHTML = `
    <div class="chart-meta-row">
      <div class="chart-meta-note">${escapeHtml(note)}</div>
      <div class="chart-actions">
        <div class="range-pills">
          <button class="tab-btn ${state.comboStablecoinMode === "merged" ? "active" : ""}" type="button" data-combo-stablecoin-mode="merged">稳定币合并</button>
          <button class="tab-btn ${state.comboStablecoinMode === "split" ? "active" : ""}" type="button" data-combo-stablecoin-mode="split">稳定币区分</button>
          <button class="tab-btn ${state.comboProtocolMode === "merged" ? "active" : ""}" type="button" data-combo-protocol-mode="merged">协议合并</button>
          <button class="tab-btn ${state.comboProtocolMode === "split" ? "active" : ""}" type="button" data-combo-protocol-mode="split">协议区分</button>
        </div>
        <div class="range-pills">${renderRangeButtons()}</div>
      </div>
    </div>
    <div class="combo-groups">
      ${groups.map((group, index) => renderComboGroupCard(group, index)).join("")}
    </div>
  `;

  bindRangeButtons(elements.comboChart);
  bindComboModeButtons(elements.comboChart);

  elements.comboChart.querySelectorAll("[data-combo-group-index]").forEach((frame) => {
    const index = Number(frame.getAttribute("data-combo-group-index"));
    const group = groups[index];
    const chart = renderInteractiveComboChart(group.series);
    const host = frame.querySelector(".combo-group-chart");
    host.innerHTML = chart.html;
    mountChartInteractivity(host.querySelector("[data-interactive-chart]"), chart.payload);
  });

  elements.comboChart.__exportRows = groups.flatMap((group) =>
    group.series.map((point) => ({
      group: group.title,
      date: formatDate(point.date),
      tvl_usd: Math.round(point.tvl),
      apy: Number(point.apy.toFixed(4)),
    })),
  );
}

function renderStackStudio(selectedCoin, selectedHistory) {
  const stackData = getStackSeries(selectedHistory, state.distributionMode, state.stackMode);
  const ranged = {
    ...stackData,
    points: applyRange(stackData.points, state.chartRangeDays),
  };
  const chart = renderInteractiveStackChart(ranged);

  const noteMap = {
    total: "总流通",
    native: "原生净流通",
    bridged: "桥接流出",
  };

  elements.stackChart.innerHTML = `
    <div class="chart-meta-row">
      <div class="chart-meta-note">${escapeHtml(selectedCoin.symbol)} 链分布 · ${escapeHtml(noteMap[state.distributionMode])}</div>
      <div class="range-pills">${renderRangeButtons()}</div>
    </div>
    ${chart.html}
  `;

  bindRangeButtons(elements.stackChart);
  mountChartInteractivity(elements.stackChart.querySelector("[data-interactive-chart]"), chart.payload);
  elements.stackChart.__exportRows = ranged.points.map((point) => ({
    date: formatDate(point.date),
    ...Object.fromEntries(ranged.keys.map((key) => [key, state.stackMode === "dominance"
      ? Number((((point.chains[key] ?? 0) / Math.max(point.total, 1)) * 100).toFixed(4))
      : Math.round(point.chains[key] ?? 0)])),
  }));
}

function renderComboGroupCard(group, index) {
  return `
    <div class="mini-chart-card" data-combo-group-index="${index}">
      <div class="mini-chart-head">
        <div>
          <div class="mini-chart-title">${escapeHtml(group.title)}</div>
          <div class="mini-chart-subtitle">${escapeHtml(group.subtitle)}</div>
        </div>
      </div>
      <div class="combo-group-chart"></div>
    </div>
  `;
}

function renderRangeButtons() {
  const options = [
    { label: "30D", value: 30 },
    { label: "90D", value: 90 },
    { label: "180D", value: 180 },
    { label: "1Y", value: 365 },
    { label: "ALL", value: "all" },
  ];

  return options
    .map(
      (option) => `
        <button
          class="range-btn ${String(state.chartRangeDays) === String(option.value) ? "active" : ""}"
          type="button"
          data-range="${option.value}"
        >${option.label}</button>
      `,
    )
    .join("");
}

function bindRangeButtons(scope) {
  scope.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.getAttribute("data-range");
      state.chartRangeDays = value === "all" ? "all" : Number(value);
      render();
    });
  });
}

function bindComboModeButtons(scope) {
  scope.querySelectorAll("[data-combo-stablecoin-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.comboStablecoinMode = button.getAttribute("data-combo-stablecoin-mode");
      await ensureSelectedYieldHistory();
      render();
    });
  });

  scope.querySelectorAll("[data-combo-protocol-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.comboProtocolMode = button.getAttribute("data-combo-protocol-mode");
      await ensureSelectedYieldHistory();
      render();
    });
  });
}

function renderInteractiveComboChart(series) {
  if (!series.length) {
    return {
      html: `<div class="empty-state">这个稳定币暂时没有可用的 TVL/APY 历史样本。</div>`,
      payload: null,
    };
  }

  const width = 1100;
  const height = 320;
  const padding = { top: 18, right: 74, bottom: 52, left: 56 };
  const xScale = createXScale(series, width, padding);
  const apyMax = Math.max(...series.map((point) => point.apy), 0);
  const tvlMax = Math.max(...series.map((point) => point.tvl), 1);
  const yLeft = (value) => height - padding.bottom - (value / Math.max(apyMax * 1.08, 1)) * (height - padding.top - padding.bottom);
  const yRight = (value) => height - padding.bottom - (value / (tvlMax * 1.08)) * (height - padding.top - padding.bottom);

  const apyPath = linePath(series, xScale, yLeft, "apy");
  const tvlLine = linePath(series, xScale, yRight, "tvl");
  const tvlArea = areaPath(series, xScale, yRight, height - padding.bottom, "tvl");
  const axisLabels = createXAxisLabels(series, xScale, height);

  const leftTicks = buildTicks(0, apyMax * 1.08, 7).map((tick) => ({
    value: `${tick.value.toFixed(0)}%`,
    x: 12,
    y: yLeft(tick.raw) + 4,
    color: "#ff4db8",
  }));

  const rightTicks = buildTicks(0, tvlMax * 1.08, 7).map((tick) => ({
    value: formatUsdCompact(tick.raw),
    x: width - 28,
    y: yRight(tick.raw) + 4,
    color: "#5f9dff",
    anchor: "start",
  }));

  const grid = buildHorizontalGrid(buildTicks(0, Math.max(apyMax * 1.08, 1), 7), yLeft, width, padding);
  const payload = series.map((point) => ({
    date: point.date,
    tooltipTitle: formatDate(point.date),
    values: [
      { label: "TVL", value: formatUsd(point.tvl), color: "#5f9dff" },
      { label: "APY", value: formatPercent(point.apy), color: "#ff4db8" },
    ],
  }));

  const svg = `
    <svg class="chart-svg pro" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="tvl-gradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#5f9dff" stop-opacity="0.48"></stop>
          <stop offset="100%" stop-color="#5f9dff" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="#111315"></rect>
      ${grid}
      <line class="chart-axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}"></line>
      ${tvlArea}
      <path class="chart-line total" d="${tvlLine}" stroke="#5f9dff"></path>
      <path class="chart-line bridged" d="${apyPath}" stroke="#ff4db8"></path>
      ${leftTicks.map(renderAxisLabel).join("")}
      ${rightTicks.map(renderAxisLabel).join("")}
      ${axisLabels}
    </svg>
  `;

  return {
    html: renderInteractiveChartFrame(svg, width, "combo"),
    payload: { payload, width, padding },
  };
}

function renderInteractiveStackChart(data) {
  if (!data.points.length || !data.keys.length) {
    return {
      html: `<div class="empty-state">这个稳定币暂时没有可用的链分布历史。</div>`,
      payload: null,
    };
  }

  const width = 1100;
  const height = 430;
  const padding = { top: 18, right: 16, bottom: 52, left: 56 };
  const xScale = createXScale(data.points, width, padding);
  const maxY = data.mode === "dominance" ? 1 : Math.max(...data.points.map((point) => point.total), 1);
  const y = (value) => height - padding.bottom - (value / Math.max(maxY, 1)) * (height - padding.top - padding.bottom);
  const stackedAreas = buildStackedAreas(data.points, data.keys, xScale, y, data.mode);
  const axisLabels = createXAxisLabels(data.points, xScale, height);
  const leftTicks = buildTicks(0, maxY, 5).map((tick) => ({
    value: data.mode === "dominance" ? `${Math.round(tick.raw * 100)}%` : formatUsdCompact(tick.raw),
    x: 12,
    y: y(tick.raw) + 4,
    color: "#d7dde5",
  }));
  const grid = buildHorizontalGrid(buildTicks(0, maxY, 5), y, width, padding);
  const payload = data.points.map((point) => ({
    date: point.date,
    tooltipTitle: formatDate(point.date),
    values: data.keys
      .map((key) => ({
        label: key,
        value: data.mode === "dominance"
          ? `${(((point.chains[key] ?? 0) / Math.max(point.total, 1)) * 100).toFixed(2)}%`
          : formatUsd(point.chains[key] ?? 0),
        color: CHART_COLORS[key] || fallbackColor(key),
      }))
      .filter((entry) => !entry.value.startsWith("0.00%"))
      .slice(0, 16),
  }));

  const svg = `
    <svg class="chart-svg pro" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <rect width="${width}" height="${height}" fill="#111315"></rect>
      ${grid}
      <line class="chart-axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}"></line>
      ${stackedAreas}
      ${leftTicks.map(renderAxisLabel).join("")}
      ${axisLabels}
    </svg>
  `;

  return {
    html: renderInteractiveChartFrame(svg, width, "stack"),
    payload: { payload, width, padding },
  };
}

function renderInteractiveChartFrame(svg, width, type) {
  return `
    <div class="chart-frame" data-interactive-chart="${type}">
      ${svg}
      <div class="chart-cursor"></div>
      <div class="chart-tooltip"></div>
    </div>
  `;
}

function mountChartInteractivity(frame, model) {
  if (!frame || !model?.payload?.length) {
    return;
  }

  const tooltip = frame.querySelector(".chart-tooltip");
  const cursor = frame.querySelector(".chart-cursor");
  const svg = frame.querySelector("svg");
  frame.__chartModel = model;

  frame.addEventListener("mousemove", (event) => {
    const rect = frame.getBoundingClientRect();
    const xPx = event.clientX - rect.left;
    const chartX = (xPx / rect.width) * model.width;
    const innerWidth = model.width - model.padding.left - model.padding.right;
    const ratio = Math.min(Math.max((chartX - model.padding.left) / Math.max(innerWidth, 1), 0), 1);
    const index = Math.min(model.payload.length - 1, Math.max(0, Math.round(ratio * (model.payload.length - 1))));
    const point = model.payload[index];
    const pointRatio = index / Math.max(model.payload.length - 1, 1);
    const pointX = model.padding.left + pointRatio * innerWidth;

    cursor.classList.add("visible");
    tooltip.classList.add("visible");
    cursor.style.left = `${(pointX / model.width) * rect.width}px`;

    tooltip.innerHTML = `
      <div class="chart-tooltip-date">${escapeHtml(point.tooltipTitle)}</div>
      ${point.values
        .map(
          (item) => `
            <div class="tooltip-row">
              <span class="tooltip-label">
                <span class="tooltip-dot" style="background:${item.color}"></span>
                ${escapeHtml(item.label)}
              </span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `,
        )
        .join("")}
    `;

    const tooltipWidth = 220;
    const tooltipX = Math.min(rect.width - tooltipWidth - 12, Math.max(12, xPx + 18));
    tooltip.style.left = `${tooltipX}px`;
    tooltip.style.top = `${Math.max(20, rect.height * 0.26)}px`;
  });

  frame.addEventListener("mouseleave", () => {
    cursor.classList.remove("visible");
    tooltip.classList.remove("visible");
  });

  if (svg) {
    frame.__svg = svg;
  }
}

function createXScale(series, width, padding) {
  const start = series[0].date;
  const end = series[series.length - 1].date;
  return (value) =>
    padding.left + ((value - start) / Math.max(end - start, 1)) * (width - padding.left - padding.right);
}

function linePath(points, xScale, yScale, key) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xScale(point.date).toFixed(2)} ${yScale(point[key]).toFixed(2)}`)
    .join(" ");
}

function areaPath(points, xScale, yScale, baseline, key) {
  const upper = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xScale(point.date).toFixed(2)} ${yScale(point[key]).toFixed(2)}`)
    .join(" ");
  const lower = [...points]
    .reverse()
    .map((point, index) => `${index === 0 ? "L" : "L"} ${xScale(point.date).toFixed(2)} ${baseline.toFixed(2)}`)
    .join(" ");
  return `<path class="chart-fill tvl" d="${upper} ${lower} Z"></path>`;
}

function buildTicks(min, max, count) {
  const safeCount = Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, index) => {
    const raw = min + ((max - min) / safeCount) * index;
    return { raw, value: raw };
  });
}

function buildHorizontalGrid(ticks, yScale, width, padding) {
  return ticks
    .map((tick) => {
      const yPos = yScale(tick.raw);
      return `<line class="chart-grid" x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}"></line>`;
    })
    .join("");
}

function createXAxisLabels(points, xScale, height) {
  const sampleIndices = [0, Math.floor(points.length * 0.25), Math.floor(points.length * 0.5), Math.floor(points.length * 0.75), points.length - 1];
  const unique = [...new Set(sampleIndices)].filter((index) => index >= 0 && index < points.length);

  return unique
    .map((index) => {
      const point = points[index];
      const label = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(point.date);
      return `<text class="chart-label dim" x="${xScale(point.date)}" y="${height - 12}" text-anchor="middle">${label}</text>`;
    })
    .join("");
}

function renderAxisLabel(tick) {
  return `<text class="chart-label" x="${tick.x}" y="${tick.y}" text-anchor="${tick.anchor || "start"}" fill="${tick.color}">${tick.value}</text>`;
}

function applyRange(points, rangeDays) {
  if (!points.length || rangeDays === "all") {
    return points;
  }

  const end = points[points.length - 1].date;
  const start = end - rangeDays * 24 * 60 * 60 * 1000;
  const filtered = points.filter((point) => point.date >= start);
  return filtered.length >= 2 ? filtered : points;
}

function buildStackedAreas(points, keys, xScale, yScale, mode) {
  const cumulative = Array(points.length).fill(0);
  const areas = [];

  for (const key of keys) {
    const upper = [];
    const lower = [];

    for (let i = 0; i < points.length; i += 1) {
      const rawValue = points[i].chains[key] ?? 0;
      const value = mode === "dominance" ? rawValue / Math.max(points[i].total, 1) : rawValue;
      lower.push(cumulative[i]);
      cumulative[i] += value;
      upper.push(cumulative[i]);
    }

    const topPath = upper
      .map((value, index) => `${index === 0 ? "M" : "L"} ${xScale(points[index].date).toFixed(2)} ${yScale(value).toFixed(2)}`)
      .join(" ");
    const bottomPath = lower
      .slice()
      .reverse()
      .map((value, index) => {
        const pointIndex = lower.length - 1 - index;
        return `L ${xScale(points[pointIndex].date).toFixed(2)} ${yScale(value).toFixed(2)}`;
      })
      .join(" ");
    const color = CHART_COLORS[key] || fallbackColor(key);
    areas.push(`<path class="stack-area" d="${topPath} ${bottomPath} Z" fill="${color}"></path>`);
  }

  return areas.join("");
}

function renderSingleLineChart(container, points, seriesDefs, emptyText) {
  if (!points.length) {
    container.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    return;
  }

  const width = 760;
  const height = 260;
  const padding = { top: 20, right: 16, bottom: 28, left: 12 };
  const xMin = points[0].date;
  const xMax = points[points.length - 1].date;
  const maxY = Math.max(
    ...seriesDefs.flatMap((series) => points.map((point) => Number(point[series.key] ?? 0))),
    0,
  );
  const safeMaxY = maxY || 1;

  const x = (value) =>
    padding.left + ((value - xMin) / Math.max(xMax - xMin, 1)) * (width - padding.left - padding.right);
  const y = (value) =>
    height - padding.bottom - (value / safeMaxY) * (height - padding.top - padding.bottom);

  const axisLabels = [
    points[0],
    points[Math.floor(points.length / 2)],
    points[points.length - 1],
  ];

  const lines = seriesDefs
    .map((series) => {
      const path = points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.date).toFixed(2)} ${y(point[series.key] ?? 0).toFixed(2)}`)
        .join(" ");
      return `<path class="chart-line ${series.className}" d="${path}"></path>`;
    })
    .join("");

  const gridLines = [0.25, 0.5, 0.75]
    .map((ratio) => {
      const yPos = padding.top + (1 - ratio) * (height - padding.top - padding.bottom);
      return `<line class="chart-grid" x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}"></line>`;
    })
    .join("");

  const legend = seriesDefs
    .map(
      (series) => `
        <span class="legend-item">
          <span class="legend-swatch ${series.className}" style="background:${legendColor(series.className)}"></span>
          ${escapeHtml(series.label)}
        </span>
      `,
    )
    .join("");

  const labels = axisLabels
    .map((point) => {
      const label = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(point.date);
      return `<text x="${x(point.date)}" y="${height - 8}" text-anchor="middle" fill="currentColor" opacity="0.58" font-size="11">${label}</text>`;
    })
    .join("");

  container.innerHTML = `
    <div class="chart-legend">${legend}</div>
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="trend chart">
      ${gridLines}
      <line class="chart-axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}"></line>
      ${lines}
      ${labels}
    </svg>
    <div class="bar-subtitle">最新值 ${seriesDefs.map((series) => `${series.label} ${formatUsd(points[points.length - 1][series.key] ?? 0)}`).join(" · ")}</div>
  `;
}

function populateStablecoinOptions() {
  elements.stablecoinOptions.innerHTML = state.stablecoins
    .slice(0, 80)
    .map((coin) => `<option value="${escapeHtml(coin.symbol)}">${escapeHtml(coin.name)}</option>`)
    .join("");
}

async function ensureSelectedHistory() {
  const selectedCoin = state.stablecoins.find((coin) => coin.symbol === state.selectedSymbol);
  if (!selectedCoin || state.historyCache.has(selectedCoin.id)) {
    return;
  }

  const detail = await fetchJson(`${STABLECOINS_API_BASE}/stablecoin/${selectedCoin.id}`);
  state.historyCache.set(selectedCoin.id, processStablecoinHistory(detail));
}

async function ensureSelectedYieldHistory() {
  const symbols = getFocusStablecoinSymbols();
  if (!symbols.length) {
    return;
  }

  const pools = symbols.flatMap((symbol) => getTopPoolsForSymbol(symbol));
  await Promise.all(
    pools.map(async (pool) => {
      if (!pool?.pool || state.poolChartCache.has(pool.pool)) {
        return;
      }

      const request = fetchJson(`${YIELDS_API_BASE}/chart/${pool.pool}`)
        .then((response) => response.data ?? [])
        .catch(() => []);
      state.poolChartCache.set(pool.pool, request);
      const data = await request;
      state.poolChartCache.set(pool.pool, data);
    }),
  );
}

async function ensureSelectedChartsData() {
  await Promise.all([ensureSelectedHistory(), ensureSelectedYieldHistory()]);
}

function processStablecoinHistory(detail) {
  const chainBalances = detail.chainBalances ?? {};
  const perDate = new Map();
  const compositionByDate = new Map();
  const latestByChain = [];

  for (const [chain, value] of Object.entries(chainBalances)) {
    const tokens = value.tokens ?? [];
    if (!tokens.length) {
      continue;
    }

    const latest = tokens[tokens.length - 1];
    latestByChain.push({
      chain,
      total: Number(latest.circulating?.peggedUSD ?? 0),
      bridged: Number(latest.bridgedTo?.peggedUSD ?? 0),
      native: Math.max(Number(latest.circulating?.peggedUSD ?? 0) - Number(latest.bridgedTo?.peggedUSD ?? 0), 0),
    });

    for (const token of tokens.slice(-180)) {
      const date = Number(token.date) * 1000;
      const current = perDate.get(date) ?? { date, total: 0, bridged: 0, native: 0 };
      const total = Number(token.circulating?.peggedUSD ?? 0);
      const bridged = Number(token.bridgedTo?.peggedUSD ?? 0);
      current.total += total;
      current.bridged += bridged;
      current.native += Math.max(total - bridged, 0);
      perDate.set(date, current);

      const composition = compositionByDate.get(date) ?? {
        date,
        chainsTotal: {},
        chainsNative: {},
        chainsBridged: {},
      };
      composition.chainsTotal[chain] = total;
      composition.chainsBridged[chain] = bridged;
      composition.chainsNative[chain] = Math.max(total - bridged, 0);
      compositionByDate.set(date, composition);
    }
  }

  return {
    series: Array.from(perDate.values()).sort((a, b) => a.date - b.date).slice(-180),
    latestByChain: latestByChain.sort((a, b) => b.total - a.total),
    compositionSeries: Array.from(compositionByDate.values()).sort((a, b) => a.date - b.date).slice(-180),
  };
}

function getSelectedHistory(stablecoinId) {
  return state.historyCache.get(stablecoinId) ?? { series: [], latestByChain: [], compositionSeries: [] };
}

function getDistributionRows(selectedCoin, selectedHistory, mode) {
  if (!selectedHistory.latestByChain.length || mode === "total") {
    return selectedCoin.chainDistribution.map((entry) => ({ chain: entry.chain, value: entry.marketCap }));
  }

  return selectedHistory.latestByChain
    .map((entry) => ({
      chain: entry.chain,
      value: mode === "native" ? entry.native : entry.bridged,
    }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
}

function getSelectedPoolRows(selectedSymbol) {
  const symbolSet = new Set([selectedSymbol]);
  return state.allApySamples
    .filter((sample) => extractPoolSymbols(sample.symbol, symbolSet, state.apyMatchMode).includes(selectedSymbol));
}

function getMatchedPools(selectedSymbol) {
  return getSelectedPoolRows(selectedSymbol)
    .slice()
    .sort((a, b) => b.tvlUsd - a.tvlUsd);
}

function getTopPoolsForSymbol(symbol) {
  return getMatchedPools(symbol).slice(0, 3);
}

function getFocusStablecoinSymbols() {
  return state.stablecoins.slice(0, 3).map((coin) => coin.symbol);
}

function getSelectedApyRows(selectedSymbol) {
  const rows = getSelectedPoolRows(selectedSymbol);
  const map = new Map();

  for (const row of rows) {
    accumulateWeighted(map, row.chain, row.apy, row.tvlUsd);
  }

  return Array.from(map.entries())
    .map(([chain, value]) => ({
      chain,
      weightedApy: value.weightedSum / value.weight,
      tvlUsd: value.weight,
    }))
    .sort((a, b) => b.weightedApy - a.weightedApy);
}

function getProtocolDistributionRows(selectedSymbol) {
  const rows = getSelectedPoolRows(selectedSymbol);
  const map = new Map();

  for (const row of rows) {
    const current = map.get(row.project) ?? { project: row.project, tvlUsd: 0, poolCount: 0 };
    current.tvlUsd += row.tvlUsd;
    current.poolCount += 1;
    map.set(row.project, current);
  }

  return Array.from(map.values()).sort((a, b) => b.tvlUsd - a.tvlUsd);
}

function getSelectedYieldSeries(selectedSymbol) {
  const pools = getMatchedPools(selectedSymbol).slice(0, 8);
  if (!pools.length) {
    return [];
  }

  const perDate = new Map();
  for (const pool of pools) {
    const history = state.poolChartCache.get(pool.pool);
    if (!history || typeof history.then === "function") {
      continue;
    }

    for (const point of history) {
      const dateKey = new Date(point.timestamp).toISOString().slice(0, 10);
      const date = new Date(dateKey).getTime();
      const current = perDate.get(date) ?? { date, tvl: 0, apyWeightedSum: 0, weight: 0 };
      const tvl = Number(point.tvlUsd ?? 0);
      const apy = Number(point.apy ?? 0);
      current.tvl += tvl;
      current.apyWeightedSum += apy * tvl;
      current.weight += tvl;
      perDate.set(date, current);
    }
  }

  return Array.from(perDate.values())
    .map((point) => ({
      date: point.date,
      tvl: point.tvl,
      apy: point.weight ? point.apyWeightedSum / point.weight : 0,
    }))
    .sort((a, b) => a.date - b.date);
}

function buildPoolGroupSeries(pools) {
  const perDate = new Map();
  for (const pool of pools) {
    const history = state.poolChartCache.get(pool.pool);
    if (!history || typeof history.then === "function") {
      continue;
    }

    for (const point of history) {
      const dateKey = new Date(point.timestamp).toISOString().slice(0, 10);
      const date = new Date(dateKey).getTime();
      const current = perDate.get(date) ?? { date, tvl: 0, apyWeightedSum: 0, weight: 0 };
      const tvl = Number(point.tvlUsd ?? 0);
      const apy = Number(point.apy ?? 0);
      current.tvl += tvl;
      current.apyWeightedSum += apy * tvl;
      current.weight += tvl;
      perDate.set(date, current);
    }
  }

  return Array.from(perDate.values())
    .map((point) => ({
      date: point.date,
      tvl: point.tvl,
      apy: point.weight ? point.apyWeightedSum / point.weight : 0,
    }))
    .sort((a, b) => a.date - b.date);
}

function getComboGroups(symbols) {
  const symbolPools = symbols.map((symbol) => ({
    symbol,
    pools: getTopPoolsForSymbol(symbol),
  }));

  if (state.comboStablecoinMode === "merged" && state.comboProtocolMode === "merged") {
    return [
      {
        title: "Top 3 Stablecoins Combined",
        subtitle: symbols.join(" / "),
        pools: symbolPools.flatMap((item) => item.pools),
      },
    ];
  }

  if (state.comboStablecoinMode === "split" && state.comboProtocolMode === "merged") {
    return symbolPools.map((item) => ({
      title: item.symbol,
      subtitle: "Top 3 pools merged",
      pools: item.pools,
    }));
  }

  if (state.comboStablecoinMode === "merged" && state.comboProtocolMode === "split") {
    return groupPoolsByProject(symbolPools.flatMap((item) => item.pools))
      .slice(0, 3)
      .map((entry) => ({
        title: entry.project,
        subtitle: `Across ${symbols.join(" / ")}`,
        pools: entry.pools,
      }));
  }

  return symbolPools.flatMap((item) =>
    groupPoolsByProject(item.pools)
      .slice(0, 3)
      .map((entry) => ({
        title: `${item.symbol} · ${entry.project}`,
        subtitle: "Protocol split",
        pools: entry.pools,
      })),
  );
}

function groupPoolsByProject(pools) {
  const map = new Map();
  for (const pool of pools) {
    const current = map.get(pool.project) ?? { project: pool.project, pools: [], tvlUsd: 0 };
    current.pools.push(pool);
    current.tvlUsd += pool.tvlUsd;
    map.set(pool.project, current);
  }
  return Array.from(map.values()).sort((a, b) => b.tvlUsd - a.tvlUsd);
}

function getStackSeries(selectedHistory, mode, stackMode) {
  const keyMap = {
    total: "chainsTotal",
    native: "chainsNative",
    bridged: "chainsBridged",
  };
  const valueKey = mode;
  const latestSorted = selectedHistory.latestByChain
    .slice()
    .sort((a, b) => (b[valueKey] ?? 0) - (a[valueKey] ?? 0));
  const topKeys = latestSorted.slice(0, 10).map((entry) => entry.chain);

  const points = selectedHistory.compositionSeries.map((point) => {
    const chainsSource = point[keyMap[mode]] ?? {};
    const chains = {};
    let others = 0;
    let total = 0;

    for (const [chain, value] of Object.entries(chainsSource)) {
      total += value;
      if (topKeys.includes(chain)) {
        chains[chain] = value;
      } else {
        others += value;
      }
    }

    if (others > 0) {
      chains.Others = others;
    }

    return { date: point.date, total, chains };
  });

  const keys = [...topKeys];
  if (points.some((point) => point.chains.Others)) {
    keys.push("Others");
  }

  return { points, keys, mode: stackMode };
}

function weightedAverage(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.tvlUsd, 0);
  if (!totalWeight) {
    return 0;
  }
  return items.reduce((sum, item) => sum + item.weightedApy * item.tvlUsd, 0) / totalWeight;
}

function formatUsd(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1e9 ? "compact" : "standard",
    maximumFractionDigits: value >= 1e9 ? 2 : 0,
  }).format(value);
}

function formatUsdCompact(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(2)}%`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function legendColor(className) {
  if (className === "native") {
    return "#0f766e";
  }
  if (className === "bridged") {
    return "#e76f51";
  }
  return "#264653";
}

function exportChartCsv(type) {
  const container = type === "combo" ? elements.comboChart : elements.stackChart;
  const rows = container.__exportRows ?? [];
  if (!rows.length) {
    return;
  }

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${type}-chart.csv`);
}

function exportChartPng(type) {
  const container = type === "combo" ? elements.comboChart : elements.stackChart;
  const svg = container.querySelector("svg");
  if (!svg) {
    return;
  }

  const cloned = svg.cloneNode(true);
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "style");
  defs.textContent = `
    .chart-axis{stroke:rgba(255,255,255,.14);stroke-width:1}
    .chart-grid{stroke:rgba(255,255,255,.08);stroke-width:1;stroke-dasharray:4 5}
    .chart-line{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
    .chart-label{fill:rgba(255,255,255,.84);font-size:11px;font-family:Arial,sans-serif}
    .chart-label.dim{fill:rgba(162,173,186,.86)}
  `;
  cloned.prepend(defs);

  const svgText = new XMLSerializer().serializeToString(cloned);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const viewBox = svg.viewBox.baseVal;
    const canvas = document.createElement("canvas");
    canvas.width = viewBox.width || 1100;
    canvas.height = viewBox.height || 430;
    const context = canvas.getContext("2d");
    context.fillStyle = "#111315";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    canvas.toBlob((pngBlob) => {
      if (pngBlob) {
        downloadBlob(pngBlob, `${type}-chart.png`);
      }
      URL.revokeObjectURL(url);
    });
  };
  image.src = url;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  if (value == null) {
    return "";
  }
  const text = String(value).replaceAll('"', '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
}

const CHART_COLORS = {
  Tron: "#46c3f2",
  Ethereum: "#7b35d6",
  BSC: "#ff7b38",
  Solana: "#2db7b7",
  Polygon: "#7cff00",
  Arbitrum: "#1b9ed1",
  Avalanche: "#6927aa",
  TON: "#d1b07c",
  Mantle: "#ffb606",
  Aptos: "#3bcc36",
  Base: "#4da2ff",
  Others: "#5c6673",
};

function fallbackColor(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360;
  }
  return `hsl(${hash} 68% 52%)`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
