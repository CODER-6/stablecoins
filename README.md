# Stablecoin Atlas

一个静态 dashboard，用于展示：

- 稳定币总市值分布
- 单个稳定币在各链上的分布
- 各链稳定币池加权 APY
- 单个稳定币在不同链上的加权 APY
- 单个稳定币在各协议的分布

## 目录结构

- `public/`
  Cloudflare Pages 的发布目录
- `public/index.html`
  页面入口
- `public/app.js`
  数据拉取、聚合与图表逻辑
- `public/styles.css`
  样式
- `wrangler.toml`
  Cloudflare Pages 配置

## 数据源

- `https://stablecoins.llama.fi/stablecoins`
- `https://stablecoins.llama.fi/stablecoin/{id}`
- `https://stablecoins.llama.fi/stablecoincharts/all`
- `https://yields.llama.fi/pools`
- `https://yields.llama.fi/chart/{pool}`

## 本地运行

```bash
python3 -m http.server 8000 --directory public
```

然后打开 `http://localhost:8000`。

## Cloudflare Pages 最短部署步骤

### 方式一：网页上直接部署

1. 把项目推到 GitHub。
2. 打开 Cloudflare Dashboard。
3. 进入 `Workers & Pages`。
4. 选择 `Create application`。
5. 选择 `Pages`。
6. 连接你的 GitHub 仓库。
7. Build 设置填写：

```txt
Framework preset: None
Build command: 留空
Build output directory: public
Root directory: /
```

8. 点击 `Save and Deploy`。

### 方式二：Wrangler CLI

先登录：

```bash
npm install -g wrangler
wrangler login
```

然后部署：

```bash
wrangler pages deploy public
```

## 指标口径

- 市值：`circulating.peggedUSD`
- 分链分布：`chainCirculating[chain].current.peggedUSD`
- 链 APY：DefiLlama Yields 中 `stablecoin=true` 的池子，按 `tvlUsd` 加权
- 单币 APY：通过池子 `symbol` 与稳定币符号匹配后，再按 `tvlUsd` 加权
- 协议分布：对匹配池子的 `project` 按 `tvlUsd` 聚合

其中 APY 聚合公式为：

```txt
weighted_apy = sum(apy_i * tvl_i) / sum(tvl_i)
```

## 说明

- `public/` 是最终发布目录，Cloudflare Pages 会直接托管其中的静态文件。
- 根目录下的 `index.html`、`app.js`、`styles.css` 可以继续保留为本地开发副本；如果后续继续改功能，记得同步到 `public/`。
