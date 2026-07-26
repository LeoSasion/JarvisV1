# JARVIS V1 下一轮开发计划

## Native Shell Lifecycle & Hybrid System Tray

状态：`IMPLEMENTED · NON-DESTRUCTIVE ACCEPTANCE PASSED`

计划基线：`origin/main @ 94e4f87`

首要调试环境：当前 Windows 11 测试机

后续兼容环境：Windows 10 1809+ Home / Pro

执行记录（2026-07-27）：

- R2-00 至 R2-08 已实现并通过自动化质量门禁。
- R2-09 已完成 Native / Hybrid / Full 三模式本机非破坏性验收；测试结束后 Explorer、原生任务栏和桌面均已恢复，JARVIS 进程残留为 0。
- Explorer 连续重启、断网、锁屏/解锁、睡眠/恢复和真实 DPI/显示器切换属于会干扰当前桌面的受控验收项，未在无人协调时强行执行；相关恢复逻辑与只读验收脚本已经落地。
- 本轮未制作安装包、未提交、未推送；用户已有的 archive 资产删除保持原样并排除在本轮改动之外。

---

## 1. 本轮目标

本轮不再继续堆叠 HUD 装饰，重点把任务栏从“视觉上已经替换”推进到“真实 Windows 日常环境中可以长期使用”。

目标包括：

1. JARVIS 在 Explorer 重启、分辨率/DPI变化、锁屏、睡眠恢复后能够自动重新绑定任务栏，失败时完整回退。
2. 验证并实现“混合任务栏”：保留 Explorer 原生通知区，JARVIS 负责 Start、固定应用、运行窗口和中央启动器。
3. 将音量、静音、网络、电源等状态接入真实 Windows 数据源。
4. 用真实的 JARVIS 系统事件流替换虚构通知和误导性状态文案。
5. 修正安装器最低 Windows 版本与 WebView2 运行条件。
6. 建立可重复的原生生命周期、DPI、全屏和恢复验收流程。

本轮完成后，JARVIS 应具备三档可回退模式：

| 模式 | 定位 | 行为 |
| --- | --- | --- |
| Native fallback | 最保守 | 完整保留 Windows 原生任务栏，JARVIS 只运行桌面与工具层 |
| Hybrid taskbar | 默认推荐 | 保留原生通知区，JARVIS 覆盖其余主任务栏区域 |
| Full replacement | 实验模式 | 沿用当前完整隐藏主任务栏的方案，明确提示第三方托盘不可用 |

任一探测或恢复环节失败时，都必须向更保守的模式回退，不能留下两条任务栏或两条任务栏都不可操作的状态。

---

## 2. 当前基线

已经完成：

- 自适应桌面图标、自动排列开关、手动拖拽和位置持久化。
- 主显示器任务栏替换、运行窗口同步、进程分组、固定项、溢出和原生飞出层。
- Start 菜单、已安装应用索引、本地快速搜索和最近使用记录。
- JARVIS File Explorer、ConPTY Terminal、System Inspector。
- CPU、内存、磁盘、网络和电源遥测。
- `off / conservative / enhanced / immersive` 原生窗口外观层级。
- Watchdog、全局 `Ctrl+Shift+Q`、原生任务栏恢复和按用户安装。

当前最明显的缺口：

- 显示设置变化后只会撤销替换并要求重启 JARVIS，尚不能自动重新绑定。
- 右下角不是完整的真实 Windows 通知区，第三方托盘图标会随原生任务栏一起被隐藏。
- 扬声器图标没有接入真实音量和静音状态。
- 顶部状态栏仍包含固定的音量、电池、Wi-Fi和麦克风状态。
- 右侧通知栏仍包含演示性质的虚构消息。
- 通知面板展示的是 JARVIS 摘要，却使用了“已与 Windows 同步”的误导性文案。
- 安装器允许所有 Windows 10 版本，与 README 声明的 Windows 10 1809 最低要求不一致。
- 前端尚无正式 lint、单元测试和交互回归脚本。

---

## 3. 产品与技术边界

### 必须遵守

- 保持 `Explorer.exe`、Windows 登录界面、安全桌面和恢复路径完整。
- 继续面向 Windows 10/11 Home 与 Pro，不依赖企业版 Shell Launcher。
- 不注入 Explorer、不读取私有 Toolbar 内存、不 reparent 第三方托盘图标、不修改系统 DLL。
- Renderer 只能发送有限的状态值或动作 ID，不能发送可执行路径、命令行、任意 HWND 或任意 Shell 动作。
- 所有新状态优先事件驱动；轮询只能作为低频恢复兜底。
- 不把温度、风扇、传感器或其他不可稳定获取的数据伪装为真实状态。

### 本轮明确不做

- 不开发语音识别、语音执行器或电脑操控 Agent。
- 不替换 Windows 登录、Credential Provider 或安全桌面。
- 不接管副显示器原生任务栏。
- 不承诺完整镜像 Windows 通知历史。
- 不直接提供 Wi-Fi、蓝牙、飞行模式等未经稳定 API 验证的伪开关。
- 不把 JARVIS File Explorer 宣称为完整 Windows Shell Namespace 替代品。

Windows 通知历史的 `UserNotificationListener` 需要包身份、Capability 和用户授权。当前 Inno Setup 的 unpackaged WPF 架构不具备稳定前提，只在本轮建立 MSIX 可行性调查项，不并入主线实现。

---

## 4. 开发任务

### R2-00 — 基线与安全门禁

优先级：`P0`

任务：

- 从最新 `origin/main` 创建新分支，不继续在已合并分支上开发。
- 保留并排除用户当前未提交的归档图片删除。
- 记录当前任务栏状态、Windows build、DPI、分辨率和主显示器信息。
- 将现有 `JARVIS_KEEP_NATIVE_TASKBAR=1` 保留为永远可用的恢复入口。
- 为任务栏模式增加明确、可持久化、可诊断的配置值。

验收：

- 新分支基线与 `origin/main` 一致。
- 无任何 archive 资产被覆盖、删除或误提交。
- 非法或未知模式自动回退到 `Native fallback`。
- 安全快捷键在任一模式下都能退出到 Windows。

---

### R2-01 — Shell 生命周期状态机

优先级：`P0`

计划状态：

```text
NativeVisible
  → Preparing
  → ReplacementActive
  → Rebinding
  → Recovering
  → NativeFallback
```

任务：

- 将当前分散的激活、隐藏、恢复逻辑收敛到显式状态机。
- 监听并处理：
  - Explorer 的 `TaskbarCreated`。
  - `DisplaySettingsChanged`。
  - 主显示器、分辨率和 Per-Monitor DPI 变化。
  - 锁屏/解锁。
  - 睡眠/恢复。
  - Explorer 进程重启和任务栏 HWND 重建。
- 每次重新绑定都重新验证：
  - Explorer 进程身份。
  - 主任务栏 HWND。
  - 任务栏位置与矩形。
  - WebView 任务栏 Renderer 是否 Ready。
  - Watchdog 是否属于当前 generation。
- 为异步激活和恢复加入 generation/token，旧会话不能恢复或隐藏新会话的任务栏。
- 重绑定超时或探测失败时完整显示原生任务栏。

验收：

- 分辨率、DPI或主显示器变化后，5 秒内完成重新布置或完整回退。
- 连续重启 Explorer 10 次，不出现重复任务栏或任务栏全部消失。
- 锁屏/解锁、睡眠/恢复后窗口事件和任务栏状态继续更新。
- 任意中间状态按 `Ctrl+Shift+Q` 都能恢复 Windows。
- 正常退出后 Explorer 存活，`Jarvis.Host` 进程数为 0。

---

### R2-02 — 混合通知区可行性验证

优先级：`P0 / 决策门`

目标：

不重新实现第三方托盘协议，而是让 Explorer 原生通知区继续负责 Wi-Fi、音量、电池、输入法、时钟、OneDrive、Windows Security 和第三方托盘交互。

任务：

- 实现只读 `NativeShellSurfaceService` 原型。
- 探测主显示器上的：
  - `Shell_TrayWnd`。
  - 原生通知区矩形。
  - 时钟与隐藏图标区域。
  - 当前 DPI、自动隐藏和任务栏位置。
- 验证 JARVIS 是否可以只覆盖通知区以外的区域，同时让原生通知区保持可见、可点击、可悬停。
- JARVIS 窗口 Region 或 Hit Test 必须真正让出通知区，不能只画成透明但继续拦截输入。
- 监听通知区 HWND 重建、矩形变化和 z-order 变化。
- 禁止 Explorer 注入、私有内存读取、子窗口重托管。

通过条件：

- 原生通知区左键、右键、悬停提示和隐藏图标菜单均正常。
- OneDrive、Windows Security 和至少一个第三方托盘程序可以正常交互。
- JARVIS 与原生区域之间没有黑块、输入死区或发光边框断裂。
- Explorer 重启后通知区自动恢复。
- 100%、125%、150%、200% DPI 下矩形探测正确。

否决条件：

- 必须依赖注入、私有 Toolbar 数据或系统补丁。
- 无法稳定让出鼠标命中区域。
- Explorer 重启或 DPI 变化后频繁出现不可恢复的双任务栏。

如果可行性验证未通过，不强行合并混合模式；保留 `Native fallback` 与明确标注的 `Full replacement`，继续完成本轮其他真实状态和生命周期任务。

---

### R2-03 — 混合任务栏正式集成

优先级：`P1`

依赖：`R2-01`、`R2-02 通过`

任务：

- 将任务栏窗口布局拆成 JARVIS 区域与 Explorer 原生通知区。
- 保持 Start、搜索框、固定项、运行窗口、中央 JARVIS 启动器归 JARVIS 管理。
- Hybrid 模式隐藏 JARVIS 自绘的重复网络、音量、电源、时钟图标。
- Full replacement 模式继续显示 JARVIS 自绘托盘，并明确标识功能受限。
- Native fallback 模式不得在原生任务栏上留下不可点击的覆盖层。
- Settings 中显示当前请求模式、实际模式和回退原因。

验收：

- 三种模式可切换，切换失败时安全回退。
- Hybrid 模式不存在重复时钟、重复网络或重复音量图标。
- JARVIS 中央启动器仍以物理屏幕中心定位，不受通知区宽度影响。
- 运行窗口区域不会覆盖通知区，也不会因长标题挤压中央启动器。
- 全屏程序激活时遵守当前任务栏策略，不压住 F11 内容。

---

### R2-04 — 真实音量与统一 Tray 状态总线

优先级：`P1`

任务：

- 新增原生音频状态服务，使用 Windows Core Audio 获取：
  - 默认输出端点。
  - 音量百分比。
  - 静音状态。
  - 默认设备变化。
- 通过事件回调更新音量，不增加高频轮询。
- 复用现有真实网络和电源快照，形成统一 Tray 状态。
- 建立受限 Bridge：
  - `tray.getSnapshot`
  - `tray.setVolume`
  - `tray.setMuted`
  - `tray.snapshot`
- 音量输入限制为 `0–100`；Renderer 不能指定设备 ID。
- 服务不可用时返回明确的 `available: false`，不能回退成 Mock 数值。
- Top bar、Full replacement 托盘和 Quick Settings 使用同一状态 Store。
- 删除固定的 `64%`、`100%`、假 Wi-Fi 和假麦克风状态。
- 顶部麦克风区域改为诚实的 `LOCAL SEARCH` 或 `AGENT NOT CONNECTED` 状态。

验收：

- 在 Windows 音量混合器修改音量或静音后，JARVIS 在 1 秒内同步。
- JARVIS 设置为 0、50、100 后，Windows 回读误差不超过 1。
- 切换默认输出设备后无需重启 JARVIS。
- 无音频设备时显示 `UNAVAILABLE`。
- Mock 模式必须明确显示 `SIMULATION`，不能伪装成原生状态。

---

### R2-05 — JARVIS System Feed

优先级：`P1`

定位：

这是 JARVIS 自身事件中心，不是 Windows 通知历史镜像。

任务：

- 将通知面板改名为 `JARVIS SYSTEM FEED`。
- 删除 `SYNCHRONIZED WITH WINDOWS` 等误导性声明。
- 删除 `data.js` 中的虚构任务、维护和通讯通知。
- 在 Host 建立最大 50 条的有界事件缓冲区。
- 事件至少覆盖：
  - 任务栏进入轮询降级。
  - Explorer/任务栏重新绑定成功或失败。
  - 网络上线/离线变化。
  - 低电量、开始充电、电源恢复。
  - 音频端点不可用或恢复。
  - Terminal 异常退出。
  - File Explorer 文件操作结果。
  - Runtime Diagnostics 失败。
  - 原生窗口外观模式回退。
- 相同事件必须去重并节流，状态抖动不能刷屏。
- 增加未读、全部已读、清空和时间戳。
- 徽标数量必须来自真实未读事件数。
- 事件动作只能使用 Host 定义的 action ID。
- 右侧 Telemetry Rail 与通知面板共用同一个事件 Store。

验收：

- 网络断开、低电量或诊断失败只产生一条去重事件。
- 事件列表最多 50 条，不发生无限增长。
- 清空、已读和未读徽标保持一致。
- 重启后的持久化策略明确：V1 默认仅保留当前会话，除非另行批准磁盘持久化。
- 所有事件有真实时间，不再固定显示 `NOW`。
- 空状态、服务不可用和读取失败都有明确文案。

---

### R2-06 — Quick Settings 与顶部状态收敛

优先级：`P1`

任务：

- Quick Settings 增加真实音量滑块和静音按钮。
- 网络、电源和音频入口打开对应 Windows 设置页。
- 不提供尚未验证的 Wi-Fi、蓝牙或飞行模式伪开关。
- Hybrid 模式优先使用原生通知区打开 Windows 系统面板。
- Full replacement 模式提供明确的 JARVIS 状态面板和 Windows 设置入口。
- Top bar、Taskbar、Quick Settings、Telemetry Rail 不再各自维护重复状态。
- 完成键盘焦点、`Esc` 返回、ARIA 状态和高对比度支持。

验收：

- 只用键盘可以打开 Quick Settings、调整音量、静音并关闭面板。
- 面板关闭后焦点回到原触发按钮。
- 200% 缩放下滑块、数值和按钮不重叠。
- 状态不能只依赖颜色表达。

---

### R2-07 — 安装和运行门槛修正

优先级：`P1`

任务：

- 将安装器最低版本收紧为 Windows 10 build 17763 或更高。
- 明确只支持 x64。
- 安装前检查 WebView2 Runtime，并提供可理解的失败提示。
- Runtime Diagnostics 展示：
  - Windows build。
  - WebView2 状态。
  - 请求任务栏模式与实际模式。
  - 当前回退原因。
- 扩展安装生命周期验证，除 Safe Mode 外增加一次受控的真实任务栏激活与恢复。
- 输出 JSON 验收凭据，包括：
  - Watchdog。
  - Explorer 存活。
  - 原生任务栏恢复。
  - 残留 JARVIS 进程。
  - 启动项。
  - 安装文件完整性。

验收：

- Windows 10 1809 以下不会完成安装。
- WebView2 缺失时不会启动成黑屏。
- 安装、修复、卸载后 Explorer 和原生任务栏正常。
- 验收脚本结束后无 JARVIS 进程、测试目录或测试启动项残留。

---

### R2-08 — 自动化与代码质量门禁

优先级：`P1`

任务：

- 为前端增加：
  - lint。
  - 格式检查。
  - 纯函数单元测试。
  - Mock 平台交互测试。
- 覆盖：
  - Tray 状态归一化。
  - 音量范围校验。
  - 事件去重和未读计数。
  - 任务栏模式回退。
  - 桌面坐标和任务栏分组现有逻辑。
- 为 Host 增加可脱离真实 Shell 运行的状态机和事件缓冲区测试。
- 增加原生生命周期 PowerShell 验证脚本。
- CI 至少执行：
  - 前端 lint/test/build。
  - Host build/test。
  - `git diff --check`。

性能预算：

- 不新增一秒内重复的全量 WMI 或应用目录扫描。
- Tray 和 Feed 只在状态变化时发布新快照。
- Feed 永远有界。
- 新增功能的空闲 CPU 增量应低于测试机基线的 0.2 个百分点。
- 状态变化到 UI 更新的 P95 目标低于 250 ms。

---

### R2-09 — 原生验收与交付

优先级：`P0 / 发布门`

### 测试程序

| 程序/场景 | 验证内容 |
| --- | --- |
| Notepad，多窗口 | 分组、激活、最小化、关闭、Explorer 重绑定后的任务栏同步 |
| Calculator | Packaged App 图标与固定项去重 |
| Microsoft Edge，多窗口 | 分组、预览、F11 全屏、退出全屏 |
| `SndVol.exe` / 声音设置 | 音量、静音、默认设备变化 |
| Windows 网络设置 | 在线、离线和设置入口 |
| OneDrive / Windows Security | 原生通知区左键、右键、Tooltip 与隐藏图标 |
| Task Manager | 普通与管理员窗口排除和窗口外观安全 |
| Display Settings | 100%、125%、150%、200% DPI，分辨率和主显示器变化 |
| Explorer 重启 | `TaskbarCreated`、重新绑定与完整回退 |
| 锁屏、解锁、睡眠、恢复 | 生命周期状态机和事件订阅恢复 |

可能影响用户当前工作的网络断开、Explorer 重启、锁屏、睡眠和显示器切换测试，执行前必须明确告知用户并获得同意。

### 必须通过

- 前端 build/test/lint 通过。
- Host build/test 通过，0 警告、0 错误。
- 当前 Win11 测试机上的 Native、Hybrid、Full 三档行为有记录。
- 1366×768、1920×1080、2560×1440 和高 DPI 无关键遮挡。
- Edge F11 时任务栏不覆盖全屏内容。
- Explorer 重启后能自动恢复或完整回退。
- `Ctrl+Shift+Q` 始终有效。
- 视觉测试取得必要截图后，立即关闭 Codex 打开的程序。
- 每轮原生测试结束时：
  - Windows 原生任务栏已恢复。
  - Explorer 正常运行。
  - `Jarvis.Host` 进程数为 0。
  - 明确告知用户桌面已经释放。

### 编译与发布规则

- 开发过程中不因每个小改动反复编译。
- 完成同一阶段代码审查后，再执行一次集中构建。
- 未得到用户明确许可时，不制作安装器、Release 包或推送远端。
- 提交前使用精确文件白名单，禁止 `git add -A`。
- 用户未提交的 archive 资产变更必须继续排除。

---

## 5. 推荐执行顺序

```text
R2-00 基线与安全门禁
  ↓
R2-01 Shell 生命周期状态机
  ↓
R2-02 混合通知区可行性验证
  ├─ 通过 → R2-03 混合任务栏正式集成
  └─ 否决 → 保留 Native fallback / Full replacement
  ↓
R2-04 真实音量与 Tray 状态总线
  ↓
R2-05 JARVIS System Feed
  ↓
R2-06 Quick Settings 与顶部状态收敛
  ↓
R2-07 安装和运行门槛
  ↓
R2-08 自动化与代码质量
  ↓
R2-09 原生验收与交付
```

---

## 6. Definition of Done

只有同时满足以下条件，本轮才算完成：

- 显示变化、Explorer 重启、锁屏和睡眠恢复不会要求用户手动重启 JARVIS。
- Hybrid 模式在当前 Win11 机器上真实保留原生通知区；若技术验证失败，产品会明确回退而不是伪造支持。
- 顶部栏、任务栏和 Quick Settings 使用真实音量、网络和电源状态。
- 不再显示假麦克风、固定音量、固定电池或虚构通知。
- JARVIS System Feed 的事件、时间和未读数来自真实运行状态。
- 安装器与 Windows 10 1809+ / x64 / WebView2 的实际要求一致。
- 自动化门禁与原生验收全部通过。
- 任意失败路径都能恢复 Explorer 原生任务栏。
- 本机测试结束后不残留 JARVIS 进程或 Codex 打开的测试窗口。

---

## 7. 后续轮次候选

以下事项有价值，但不应混入本轮主线：

1. JARVIS 内部窗口管理器：统一 Explorer、Terminal、Inspector 的拖动、最小化、最大化、层级和任务栏状态。
2. File Explorer 大文件进度、取消、冲突策略、长路径、reparse point 和跨盘事务。
3. Start Menu 应用目录热刷新、搜索虚拟化和大型目录性能。
4. 原生窗口外观应用级允许/禁用规则与完整兼容矩阵。
5. MSIX + `UserNotificationListener` 的 Windows 通知历史可行性验证。
6. 独立 Windows 10 测试机上的兼容性完善。
