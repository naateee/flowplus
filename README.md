# FlowPlus

**本地优先的 EPUB 阅读器** —— [Flow](https://github.com/pacexy/flow) 的修改版，
按「本机零常驻 + 浏览器缓存兜底离线」的方式自用。

- 应用名：FlowPlus（上游：Flow）
- 许可：AGPL-3.0（见 `LICENSE`，修改声明见 `NOTICE`）
- 与上游**没有任何官方关系**

## 相对上游的差异

| 方面          | 上游 Flow                       | FlowPlus                                    |
| ------------- | ------------------------------- | ------------------------------------------- |
| 云同步 / 账号 | Dropbox 授权 + 上传下载         | **已移除**                                  |
| 分享链接      | 有                              | **已移除**（保留「从 URL 导入」与 `?src=`） |
| 遥测          | Sentry（硬编码了作者 DSN）+ GTM | **全部移除**                                |
| 多语言        | en/zh/ja/de                     | **仅简体中文**                              |
| 部署形态      | SSR / Docker / Vercel           | **静态导出 + 本机按需投递**                 |
| 数据          | 浏览器 IndexedDB                | 相同（不经过任何服务器）                    |

## 开发与构建

```bash
# 依赖（Node 18 + pnpm 10.6.4，见 package.json 的 packageManager）
pnpm i

# 本地开发（热重载，默认端口 7127）
pnpm -F @flow/reader dev

# 构建纯静态产物 → apps/reader/out/
pnpm -F @flow/reader export
```

> ⚠️ **不要执行根目录的 `pnpm build`**：它会经 turbo 触发 `packages/epubjs` 的
> webpack 4 构建，webpack 4 使用的 `md4` 在 Node ≥17 + OpenSSL 3 下会抛
> `ERR_OSSL_EVP_UNSUPPORTED`。reader 并不需要该产物 —— 它通过
> `next-transpile-modules` 直接使用 epubjs 的源码。

## 本地运行

`out/` 是一个纯静态站点，用任意静态服务器在 **4300 端口** 起一次即可：

```bash
python -m http.server 4300 --bind 127.0.0.1 --directory apps/reader/out
```

然后在 Edge 中打开 `http://localhost:4300` 并「安装为应用」。

## 数据与备份

书籍、封面、阅读进度、标注全部存放在**浏览器的 IndexedDB** 里：

- 应用内「导出」→ `flow_backup_<日期>.zip`（含 `data.json`、`covers.json` 与每本 epub）
- 把该 zip 拖回应用即完成恢复

> ⚠️ 清理浏览器「**Cookie 和站点数据**」会连同 IndexedDB 一起删除，**书会丢**；
> 清理「缓存的图像和文件」不会影响书籍，只影响应用本身（重新投递一次即可恢复）。

## 目录

```
apps/reader        阅读器（Next.js，静态导出）
apps/website       上游的营销站（本项目不使用）
packages/epubjs    vendored 的 epub.js（阅读引擎）
packages/internal  共享工具
packages/tailwind  Tailwind 预设
```
