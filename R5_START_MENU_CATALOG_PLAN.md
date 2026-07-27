# R5 — Start Menu 应用目录与大目录搜索

日期：2026-07-27
目标平台：本机 Windows 11；保留 Windows 10+ API 边界
交付方式：审查后直接提交并推送 `main`

## 1. 目标

让 JARVIS Start Menu 从“五分钟缓存的静态应用清单”升级为低开销、可观察、可手动恢复的实时目录，并保证 1,000—10,000 项应用数据下搜索输入、滚动和键盘导航仍然流畅。

## 2. 本轮范围

### R5-01 — 单一宿主目录服务

- 主桌面与自绘任务栏共享同一个 `ShellService`，避免重复扫描 Start Menu 与 AppsFolder。
- 宿主关闭时统一释放目录监听器。
- 保持应用启动 capability 校验，不把路径或任意命令暴露给前端。

### R5-02 — 增量失效与版本化快照

- 监听当前用户和所有用户的 Start Menu 根目录。
- 将连续文件事件以 350 ms 去抖合并为一次重建。
- 快照增加 `revision`、`refreshReason`、`watching` 和 `watchRootCount`。
- 保留五分钟缓存作为监听失效和纯 packaged app 变化的恢复兜底。
- 提供显式 `shell.refreshApplications`，失败时保留最后一份可用目录。

### R5-03 — 前端事件同步

- 通过 `shell.applicationsChanged` 将新快照推送到所有活动 WebView。
- 丢弃晚到的旧 revision，避免旧目录覆盖新目录。
- 无订阅者时解除前端事件监听。
- Mock 平台保持协议与刷新行为一致。

### R5-04 — 搜索与长列表性能

- 搜索使用 deferred query，避免输入被大目录同步渲染阻塞。
- 排名顺序：完整名称、名称前缀、名称词首、名称包含、元数据命中。
- All Apps 与搜索结果使用固定双列的窗口化渲染，只挂载可视区和少量 overscan。
- 保留字母分组视觉，并支持方向键、Home、End 跨虚拟窗口移动焦点。

### R5-05 — 可观察与恢复

- Start Menu 显示应用数、LIVE 状态和 revision。
- 显示索引时间与刷新原因。
- 提供手动刷新按钮及忙碌状态。
- 目录不可用或目录被截断时继续显示明确状态。

## 3. 验收标准

- 新建、删除或重命名 `.lnk` 后，无需重启 JARVIS 即可收到新 revision。
- 连续文件事件只触发一次去抖后的目录发布。
- 主桌面与任务栏不再分别创建应用目录监听器。
- 10,000 个 mock 应用的首屏挂载行数保持有界，搜索结果稳定。
- 搜索输入、滚动、Pin/Unpin 和应用启动入口保持可用。
- Browser 验证通过页面身份、非空页面、错误覆盖层、控制台、截图和至少一次真实交互。
- Host 冒烟测试结束后恢复原生任务栏，并确认无 JARVIS 或预览监听进程残留。

## 4. 性能预算

- 文件事件去抖：350 ms。
- 常态不轮询 Start Menu；仅文件变化、显式刷新或五分钟缓存过期时全量重建。
- 宿主只维护一套目录服务和两套根目录监听器。
- 前端可视窗口目标：常见 320—480 px 视口下不超过 20 个虚拟行。
- 搜索不引入第三方索引或窗口化依赖。

## 5. 本轮不做

- 不替换 Windows Search 索引器。
- 不抓取文档、邮件、网页历史或语音 Agent 结果。
- 不承诺仅通过 Start Menu 文件监听即时发现所有纯 MSIX 安装事件；由手动刷新和缓存过期兜底。
- 不在本轮扩大 Windows 10 真机兼容矩阵。

## 6. 验证矩阵

| 层级 | 验证 |
| --- | --- |
| 前端模型 | 排名、去重、分组、10,000 项窗口化、确定性搜索 |
| 前端静态门禁 | ESLint、格式、Node test、Vite build |
| 宿主单元 | 缓存/revision、手动刷新、真实 FileSystemWatcher 去抖发布 |
| 宿主编译 | Release build、xUnit |
| 浏览器 | Start 打开、All Apps、搜索、刷新、键盘焦点、控制台与截图 |
| 本机宿主 | 安全模式启动、Start 面板目录状态、关闭与原生恢复 |

## 7. 完成定义

- [x] 计划范围全部落地。
- [x] 测试与集中编译通过。
- [x] Browser 视觉与交互检查通过；Release 宿主安全启动及清理通过。
- [x] `git diff --check` 与最终审查无阻断问题。
- [x] 排除用户的 archive 删除，仅提交 R5 文件。
- [ ] GitHub Actions 通过。

## 8. 本地执行结果

- 前端：ESLint、格式检查、21 个 Node 测试、Vite production build 通过。
- 宿主：Release build 通过，0 warning / 0 error；22 个 xUnit 测试通过。
- Browser：Start、All Apps、窗口化挂载、搜索、方向键焦点与手动刷新均通过；控制台 0 error / 0 warning。
- 大目录模型：10,000 项数据下窗口保持少于 20 行，精确搜索结果稳定。
- 本机宿主：`JARVIS_KEEP_NATIVE_TASKBAR=1` 下完成 WebView2 导航、DOM ready 与 NativeVisible 生命周期；日志无 error。
- 本机可视交互：测试时 Windows 会话处于锁屏，遵守安全边界未注入点击；Browser 已完成同一界面的视觉与交互覆盖。
- 清理：`Jarvis.Host=0`、4188 监听为 0、`Explorer=1`。
