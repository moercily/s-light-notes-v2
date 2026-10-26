# s-light notes v2 Test Plan

## 最新执行记录 — 2026-10-26 / 0.1.1 / P0～P3

本轮只在本地 Docker/无窗口 ARM64 QEMU 和远端一次性 Windows/Linux VM 中执行；没有使用本机 Mac 界面或 Parallels。用户确认 P3“只准备材料”。自动更新已移出开发目标；不新建公开发布。

- **P0 通过**：`scripts/test-android-headless.py --previous-apk release/android/0.1.0/s-light-notes-0.1.0-arm64-v8a.apk --p2p-peer-archive /path/to/syncthing-linux-arm64-v2.1.2.tar.gz`。签名 Android 原生 UI 配对 ARM64 Docker 中的独立固定引擎，只有两条初始笔记；实际双向传输和界面编辑、离线竞争修改后保留两版本、Android 冲突列表可见、停止 Android 不影响对端均通过。
- 签名原地升级 `2000002` → `2000003`（0.1.0 → 0.1.1）后，设备码、证书摘要、文件夹 ID/路径/设备列表和既有配对均保留；重连后继续传输通过。整轮 **218.31 秒**，完整报告在 `release/qa/android-p2p-upgrade.json`。与上次的“同版本重装身份”范围区分。
- 0.1.1 ARM64 APK SHA-256：`3985036337395ec7dae2a87e1db92548628b2733cafa798c65c476b394409109`；实际 ZIP 只含 arm64-v8a 的 Rust 与 Syncthing 两个库，两者与当前编译结果一致。APK v2/v3 签名通过，证书仍为 `bde886bebb20114c53661299f4d40bb679acbe433bb476eb4ab5bf7977efaddd`。保留在 `release/android/0.1.1/`；本轮没有重复 x86-64/AAB 打包，不将旧 0.1.0 产物改名当作新版。
- **P1 Linux 通过**：[40287800683 的 Linux job](https://github.com/moercily/s-light-notes-v2/actions/runs/40287800683) 在一次性 Ubuntu VM 的 Xvfb/Openbox 中安装 deb，验证原生初始化、Markdown 保存、便签编辑、真实 `_NET_WM_STATE_ABOVE` 切换、从另一客体应用触发全局快捷键、正常退出和引擎停止。该运行的 Windows job 仍失败，不能把整个运行写成成功。
- **P1 Windows 通过**：[40288211756](https://github.com/moercily/s-light-notes-v2/actions/runs/40288211756) 单独 Windows job 成功。安装 NSIS 后验证真实旧 Service Worker/CacheStorage 恢复，同时保留 localStorage、IndexedDB 与无关缓存；原生初始化、保存、便签编辑、真实 HWND TOPMOST 切换、从 Notepad 触发全局快捷键、原生 WM_CLOSE 触发保存/退出屏障和引擎停止均通过。此结果不等于本机旧 Win10 用户配置已验收。
- 两个平台复用 [40286079333](https://github.com/moercily/s-light-notes-v2/actions/runs/40286079333) 构建的 0.1.1 安装包。该构建运行的前端 **13 组**、Rust **38 项**、真实双引擎及打包通过，UI 检查当时失败；后续只修测试定位/焦点/依赖。复用前比较源提交与当前 `app`、`src-tauri`、npm 元数据，并核对 SHA256SUMS，避免重复编译。
- 原始失败原因均保留于对应日志：Windows 切换按钮使用 TogglePattern；状态文字不能当作控件 Name；关闭使用原生窗口句柄，而不是 UIA 缓存对象是否失效；跨应用后需明确给目标窗口发送退出。Linux 安装 X11 检查工具并激活主窗口后退出。
- 本地 Docker 的 `native-shell reliability editor` 三组通过，**1.02 秒**。另在无网络、无挂载容器中检查了发行摘要入口：合法含空格文件名通过，改动后的安装包和未列出的额外安装包均被拒绝。
- **P2 通过**：`python3 scripts/test-android-headless.py --editor-qa-ime release/qa/slight-qa-ime.apk`，真实 Android WebView InputConnection 中文组合期间原 Markdown 不变，提交后保存并重开正确；200 个生成的原生 Markdown 文件加 1 条输入法笔记，共 201 个文件。24,697 字节长笔记的末尾编辑逐字保留所有原内容。完整报告 `release/qa/android-editor.json`，整轮 **101.18 秒**。观察到冷启动/列表 7.37 秒、搜索 2.15 秒、长笔记编辑保存 2.19 秒，均含 ADB/UI Automator 开销，不是渲染帧延迟，也不作为低端真机结论。
- 编辑器夹具同时修正了输入法注册列表须包含尚未启用项、不能使用 Escape 清空 HTML 搜索框、不能点击屏幕外的零坐标控件和长文必须定位文档末尾等测试事件问题。没有为这些夹具问题改动产品编辑逻辑。
- **P3 材料完成**：[发行材料包](RELEASE_MATERIALS_0.1.1.md)、[隐私草案](PRIVACY_DRAFT.md)。包含渠道文案、签名备份恢复、权限/网络和第三方诊断说明、真机/后台/耗电操作单。未执行机外备份、正式证书/公证、真机耗电或商店上传。

测试夹具修正：模拟器在 Wi-Fi/移动数据关闭后仍有虚拟以太网；启用 Wi-Fi 会导致 10.0.2.15 → 10.0.2.16 切换、断开连接并触发拉取重试。本轮固定虚拟以太网，临时客体出站防火墙只允许 loopback 与 10.0.2.2，禁用对端公共发现/中继/NAT/报告服务。截图、键盘、剪贴板和窗口均留在客体或远端 VM。本轮临时 AVD 和容器已清理；Colima 在测试后停止，镜像缓存保留。

覆盖边界：Android 厂商输入法/物理键盘、低端手机、真机通知/相机/耗电、两台桌面安装包互配、Mac 物理快捷键/真实登录、既有本机 Win10 配置、Android x86-64 运行和正式发行仍未由本轮证明。后续如需本机 Mac 或 Parallels，先询问用户。

## 上次执行记录 — 2026-10-26 / 0.1.0

- 桌面上次完整矩阵基线 `50b5877` 的主分支原生 CI [40262430857](https://github.com/moercily/s-light-notes-v2/actions/runs/40262430857) 四个平台全部完成并成功；此前同提交的分支运行 `40261312065` 也成功。每个平台通过 12 组前端、38 项 Rust、双引擎和打包检查。后续 Android 定向修复没有重复这套桌面矩阵。
- Windows 原生运行器新增一次性安装、原生存储初始化、UI Automation 新建/保存并核对 Markdown、正常退出并检查引擎停止的检查，已通过。此范围不等于既有 Windows 用户配置迁移、便签或物理快捷键验收。
- 修复全局快捷键插件的初始化顺序，并在原生壳恢复自身旧 PWA Service Worker/CacheStorage；恢复脚本保留 localStorage、IndexedDB、笔记和设备身份，有针对性回归。
- 本轮政策变更前，Mac 新包严格签名校验、加载 10 个原有笔记、空便签打开/关闭和正常退出通过。用户要求停止宿主机窗口测试后，不再新增 Mac 真机验收。
- 本机 Windows 旧环境仍显示旧界面且未完成初始化，未确认新恢复包实际替换成功；不将远端 CI 成功延伸为本机旧配置恢复通过。最后一次文件核对：10 个原有 Markdown 变化数为 0，原设备证书摘要一致。
- 本轮独立 Android API 36 ARM64 AVD 已安装签名包并启动；用户要求停止后已关闭并删除本轮 AVD，没有完成编辑或保留数据验收，原有 AVD 保留。
- 按用户要求停止 Windows UI 自动化任务并挂起 Win10，关闭本轮两处临时 HTTP 服务；后续使用 Docker 与无界面 QEMU，小规模相关检查优先。需使用 Parallels 或 Mac 真机时必须先询问用户。
- 无界面 QEMU 11.1.2 / Colima 0.10.3 / ARM64 Linux / Docker 下，默认 3 组相关测试全部通过，测试执行 0.34 秒；首次上下文 461 KB、npm 安装约 1 秒（不含首次虚拟机及 Node 镜像下载）。资源边界见 [HEADLESS_TESTING.md](HEADLESS_TESTING.md)，此结果不能替代原生图形验收。
- 按单组选择 `native-shell` 通过，执行 0.02 秒，整条命令约 0.94 秒；基础镜像摘要及 npm 依赖缓存命中。测试容器退出即清理，当前 Docker context 保持 `desktop-linux`。
- QEMU 停止后再次启动约 9 秒，Docker 镜像缓存保留；随后单独执行设置/版本检查通过，执行 0.03 秒、整条命令约 0.96 秒。验证后再次停止本轮 QEMU，保留磁盘与镜像缓存供后续使用。

### Android 签名版原生修复与无窗口验收

- 原签名包首次启动正常，但实际编辑保存失败。一次性、同签名的客体内诊断确认 `mobile_storage_ensure not allowed by ACL`，而不是文件内容损坏；诊断辅助包未进入发行目录。
- `build.rs` 和 Android capability 现在覆盖全部 21 个 Android 命令。移动端在存储就绪前禁止新建，初始化失败显示明确提示，不转存浏览器。新增授权覆盖检查，并验证失败与异步初始化时的界面屏障。
- 针对性 Docker 检查 `android-permissions reliability mobile-storage-service` 三组通过，0.38 秒；随后新增的网络规则检查单组通过，0.31 秒。`npm test` 已接入第 13 组 Android 检查，本轮没有重复全部 13 组或桌面 Rust 测试。
- 实际发现 x86-64 APK 夹带上次编译的 Rust 库。原因是 Gradle 在另一个 ABI 的 Cargo 任务完成前已缓存共享 JNI 目录；现声明输出并让各变体等待已配置 ABI 构建。收集前的 8 份原生载荷比较先拒绝旧 APK，修复后全部匹配当前 Rust/Syncthing 文件。
- 签名版禁止 HTTP 时也阻止了本机控制接口，导致启动超时。按 [Android 网络安全配置](https://developer.android.com/privacy-and-security/security-config)仅允许 `127.0.0.1` 的明文访问；其他地址仍默认禁止，debug 资源保留原有开发服务器行为。增加启动前校验，启动失败或取消时清理本次子进程。
- Activity 重建会使插件构造时保留的权限 launcher 失效。权限及扫码入口改用当前 Activity 的弱引用；局域网和通知请求启动失败时释放待处理请求。无窗口用例主动改变客体密度重建 Activity 后，附近设备授权及引擎启动、停止通过。
- 最终 arm64 签名 APK SHA-256 `10556eafb25e753f8ae1cd0411d9febde86173e512f7f1eb910cc251f19d6fc7`。在独立 API 36 ARM64 QEMU 中关闭 Wi-Fi/移动数据后，通过当前版本引擎启动/停止、停止后无进程残留、同签名重装后界面设备码一致；不读取私钥或 API Key。
- 同一轮的独立笔记用例从历史 `2.0.0-alpha.0`（版本码 `2000000`）升级到 `0.1.0`（`2000002`）：两条 ASCII 笔记的保存、重开、回收站保留、更新后修改、恢复和冷启动均通过。整轮 208.62 秒，报告在 `release/qa/android-headless.json`。身份比较是当前版本同签名重装，未宣称旧版到新版的身份或配对迁移通过。
- 最新 x86-64 APK SHA-256 `daf33123f25e000cfbabe9ced6b49aea6d9c7500bc1cdc7d3d8081154efb8fff`；通用 AAB `a446487cd076ab7c9e54ce36e0ca984896bff9d4dd37d95f060931155a083e1e`。构建、原生载荷、签名和清单校验单独记录，x86-64 运行仍未验收。
- 本轮只在 Docker/无窗口 QEMU 中运行测试；没有使用 Parallels 或 Mac 真机界面。所有本轮 AVD 已删除，既有 `slight-notes-api36` 保留；Colima 已停止。签名身份机外备份、真实 P2P、完整真机/中文输入法/通知/耗电、跨版本身份绑定、商店与发行签名门槛仍待完成，不启用更新器，不创建公开发布。

## 上次完整执行记录 — 2026-10-25 / 0.1.0

本节优先于后面的历史检查点；历史记录不代表本版已重新通过。

| 验证范围 | 本次结果 |
| --- | --- |
| 前端/服务/编辑器回归 | 11 组通过，新增真实 DOM 的 Markdown 保真、URL、粘贴、撤销、IME 状态及移动保存失败测试 |
| Rust | 38 项通过，含备份导入、目录版本及旧内容覆盖保护 |
| Android Kotlin | arm64 与 x86-64 各 12 项单元测试通过，无失败 |
| 本机实际双引擎 | 双向文件交换、离线新增、竞争修改冲突、重启身份及独立停止通过；仅本机 loopback，非两台桌面安装包 UI 验收 |
| Mac arm64 | 0.1.0 app/DMG 构建；原生界面新建中文笔记、导入、编辑代码块、保存和导出通过；导入样本修改 42 为 43 后，Markdown 与预期逐字一致 |
| 同步停止时编辑 | 停止已确认属于应用包的引擎进程，确认 8385 不可连接；本地新建中文笔记、保存、文件回读和切换后重开均通过；未停止另一个 8384 服务 |
| Markdown 导出 | 原生文件夹选择、11 个文件导出及清单摘要校验通过。测试笔记移入回收站；与验收前导出摘要比较，原有 10 个文件内容哈希全部不变；含原有笔记的临时导出副本已清理 |
| Android 发布包 | arm64、x86-64 签名 APK 和通用 AAB 构建；两个 APK 签名验证、AAB JAR 签名验证通过；最终包同签名覆盖重装和再次启动也通过（未以此替代数据迁移验收） |
| Android 签名版首次运行 | 新建独立 `slight-release-qa` API 36 arm64 模拟器，全新安装成功，冷启动约 1.1 秒，无 AndroidRuntime 崩溃；非完整编辑/配对验收 |
| Windows 原地升级与文件完整性 | Win10 19044.1947 / AMD64 中，已校验的 NSIS 将既有 `0.0.1` 原地升到 `0.1.0`，安装任务返回 0，程序版本和原用户卸载记录一致；升级前后 10 个原有 Markdown 摘要及设备证书摘要相同。仅此范围通过，编辑/便签/迁移完整验收仍未通过 |
| 原生桌面 CI | 最终运行 [40188409227](https://github.com/moercily/s-light-notes-v2/actions/runs/40188409227) 四个平台全部成功，提交 `32fac85`；每个平台均通过 11 组前端测试、38 项 Rust 测试、真实双引擎测试及安装包构建；两个 Mac 目标另通过严格资源签名、版本及主程序/引擎架构校验 |

可重复的模拟 DOM 负载：`node scripts/measure-editing.mjs`。本机 Node 24 / jsdom，1000 条笔记列表约 53 ms，未变化列表约 4 ms；约 79 KB、1000 段长笔记装载约 75 ms，未修改内容读回约 7 ms，文本完全一致。结果在忽略目录 `release/qa/editing-performance.json`。这是无布局的合成基准，不能证明真机滚动、输入法或低端手机性能。

本版尚未通过：两台桌面安装包互相配对及同步 UI；Windows/Linux 安装后的便签和编辑交互；物理跨应用快捷键；重新登录后的开机启动；Android 签名版完整编辑/升级/同步真机验收；真机长时间耗电；x86-64 Android 运行；商店上传与桌面发行签名/公证。

当前没有连接 Android 真机；宿主是 Apple Silicon；可用本机代码签名身份数量为 0。签名身份的机外备份需要指定安全介质，不能以另一个本机目录冒充完成。上述门槛未完成前不启用自动更新，也不把本次开发版本公开发布。


## Desktop Sticky Checkpoint — 2026-10-08

All eight frontend suites and 34 Rust tests pass. macOS Apple Silicon release
packaging and Android arm64 debug APK packaging pass. Native macOS sticky
save/reopen, pin persistence, main-window recreation, individual close,
empty-draft reuse, and multi-window quit were exercised.

Physical-key activation in another application, Windows/Linux sticky runtime,
and this checkpoint's Android phone regression remain unverified. Detailed
steps and evidence limits are in [`V2_STICKY_NOTES.md`](V2_STICKY_NOTES.md).

## Settings / 0.0.1 Checkpoint — 2026-10-08

All nine frontend suites and 35 Rust tests pass. Packaged macOS settings were
checked for four-category navigation, icon/name/version, key capture + Esc
commit, Esc-only removal, cancellation on navigation, sync status refresh,
and login-startup registration/removal. A second executable launch exited
successfully with one application instance remaining. Autostart and shortcut
settings were restored to their pre-test state.

The macOS bundle reports `0.0.1`; the arm64 Android debug APK reports
version name `0.0.1` and version code `2000001`, above the existing release's
`2000000`. Login after reboot, Windows/Linux native settings acceptance,
cross-application physical shortcut input, and phone runtime testing remain
separate unverified gates. See [`V2_SETTINGS.md`](V2_SETTINGS.md).

## Automated Tests

- From `v2/`, `npm test`
  - Verifies `syncService` uses Tauri invoke when available.
  - Verifies `syncService` falls back to existing Web sync helpers.
  - Verifies `syncService.testConnection()` returns a UI-compatible shape in desktop mode.
  - Verifies `syncService.startEngine()` calls the desktop command.
  - Verifies desktop requests wrap Tauri structure arguments correctly.
  - Verifies the desktop proxy receives the API Key for status and configuration-assist requests.
  - Verifies real desktop connection results include device ID, folders, devices, and selected folder state.
  - Verifies HTTP 403 is shown as an API Key authentication failure.
  - Verifies desktop-only calls fail clearly in Web/PWA context.
  - Verifies the sync center view model separates local save status from P2P sync status.
  - Verifies the desktop service calls Tauri commands for app paths and default notes folder actions.
  - Verifies `desktop` storage mode routes list, read, save, trash, restore, and permanent deletion through the desktop service.
  - Verifies the sync center reports desktop Markdown storage separately from browser storage.
  - Verifies the safe binding preview and separate confirmation controls are present in the desktop sync center.
  - Verifies confirmed-write requests send the short-lived token and current API Key through the dedicated Tauri command.
  - Verifies v2 desktop sync scripts are included in the isolated v2 Service Worker cache.

- From `v2/`, `cargo test --manifest-path src-tauri/Cargo.toml`
  - Verifies unsafe Syncthing proxy paths are rejected.
  - Verifies valid Syncthing REST paths target `127.0.0.1:8384`.
  - Verifies explicit, `PATH`, and common-location Syncthing executable discovery precedence.
  - Verifies managed-process state cleanup and early-exit messages.
  - Verifies unsafe note IDs cannot escape the default notes directory.
  - Verifies API Key header injection is rejected and a valid key is applied as `X-API-Key`.
  - Verifies Markdown files can be created, read, listed, moved to trash, restored, and permanently deleted in a temporary directory.
  - Verifies configuration previews do not write, recognize an existing binding, reject outside paths, and reject duplicate folder IDs.
  - Verifies confirmation tokens are single-use, expire after five minutes, and are required before a write plan can be obtained.
  - Verifies confirmed writes recheck folder ID/path conflicts and preserve the Syncthing default folder template.
  - Verifies the authenticated GET, POST, readback, restart-status, and rollback DELETE sequence against a temporary loopback server.

- From `v2/`, `npm run tauri:build`
  - Verifies the Tauri desktop shell compiles.
  - Verifies the v2 frontend under `v2/app` is bundled into a macOS `.app`.
  - Alpha target is `.app`; DMG packaging is intentionally deferred.

- From `v2/`, `npm run tauri:build:macos-intel`
  - Verifies the Tauri desktop shell cross-compiles for `x86_64-apple-darwin`.
  - Verifies the Intel `.app` contains the matching x86-64 Syncthing sidecar.

- From `v2/`, `npm run tauri:build:linux`
  - Builds the Linux `deb` and AppImage targets on a native Linux x64 environment.
  - This command is defined and structure-tested; native Linux execution remains pending.

## Desktop Manual Tests

- Launch the Tauri app on macOS, Windows, and Linux.
- Create the default notes folder.
- Open the notes folder from the app.
- Create, edit, save, close, and reopen a Markdown note.
- Confirm the desktop build does not show the browser folder permission picker.
- Confirm the saved `.md` file is visible and readable in the default notes folder.
- Confirm delete, restore, and permanent delete behave consistently with v1.
- Confirm v1 browser entry still opens `index.html` normally.

### macOS Apple Silicon Smoke Checkpoint - 2026-07-15

Verified in the current environment:

- The latest `.app` bundle launches from `src-tauri/target/release/bundle/macos/`.
- With sidecar startup deliberately made unavailable in a disposable package copy, the main app remained running and logged the sidecar startup failure instead of exiting.
- `npm test`, all 31 Rust tests, and `npm run tauri:build` passed from the independent v2 repository.
- The v1 repository still contains only its pre-existing `css/style.css` modification; the v2 run did not change v1.

Manual acceptance confirmed by the user on 2026-07-15:

- Create, edit, save, quit, reopen, and content persistence passed.
- The saved Markdown file was visible and readable outside the app.
- An external Markdown edit was observed by the app after reopen or refresh.
- Delete, restore, repeated delete, permanent delete, and `.trash` behavior passed.
- No browser folder-permission picker appeared during the packaged-app workflow.

Remaining macOS check:

- The disposable-package test proved that sidecar startup failure leaves the main app running, but actual editing and saving while the sidecar is unavailable still requires explicit confirmation.

Manual acceptance run:

1. Open the latest `s-light notes.app` and create a note named `macOS smoke note` with a second line of body text.
2. Quit and reopen the app; open the note and confirm both lines remain.
3. Use **Open Notes Folder** and confirm `macOS smoke note.md` is readable in Finder or a text editor.
4. Append `external edit` in a text editor, then reopen or refresh the app and confirm the added line appears.
5. Delete the note, restore it from Trash, delete it again, and permanently delete it; confirm the file moves through `.trash` and is finally absent.
6. Confirm no browser folder-permission picker appears at any point.

All six manual steps above were reported as passed on 2026-07-15. Phase 5.1 remains open only for the separate editing-without-sidecar check.

### Windows x64 Package Checkpoint - 2026-07-16

Verified in Parallels Windows 11 ARM64 using Windows x64 application emulation:

- Node.js v22.22.0 x64, Rust 1.97.0 with `x86_64-pc-windows-msvc`, Visual Studio 2022 x64 C++ tools, the Windows 11 SDK, and WebView2 were available.
- The frontend suite passed and all 31 Rust tests passed on Windows.
- The first Rust build correctly exposed the missing Windows sidecar, and the next build exposed the required Windows `.ico`; both package gaps were added to the repository and covered by the structure test.
- `syncthing-windows-amd64-v2.1.2.zip` matched SHA-256 `4626c13012e9620ece2393bfc3300aeafead654695d5dc096a873c27a7543c96` from Syncthing's official signed checksum manifest.
- The extracted x86-64 PE sidecar matched SHA-256 `6bff9bbf005ea28f103da7a6508f2677bdd15bd344faf4b7f908872c83d76e3e`.
- The final `npm run tauri:build:windows` NSIS x64 installer was generated, installed per user, and registered an uninstall entry. After the console-window fix it was 12,858,947 bytes with SHA-256 `f8db9e206b07391c45bbadb125ca4ca85c16745a6de28877678fdfd7a21924fc`.
- The installed directory contained the main executable, `syncthing-sidecar.exe`, provenance metadata, and the MPL-2.0 notice.
- First launch created `Documents\\s-light-notes` and an independent application-data tree containing Syncthing config, data, logs, and runtime credentials.
- The installed sidecar returned `{"status":"OK"}` on loopback port 8385.
- A reported empty command window was traced to the main release executable using the Windows console subsystem. Release builds now use the Windows GUI subsystem while debug builds retain their console, and the installed executable was verified with PE subsystem value `2`.
- A normal main-window close stopped the app and both sidecar processes and released port 8385.
- Restart restored sidecar health and preserved the Syncthing certificate and private-key hashes.

Pending Windows acceptance:

- Run the create/edit/save/reopen, external-file edit, trash/restore/permanent-delete, and no-browser-permission-picker checks in the installed UI.
- Confirm the normal UI exposes no raw Syncthing API address, port, or API Key.
- Repeat packaging and smoke testing on native Windows x64 hardware or an approved native x64 runner; the current ARM64 VM proves x64 compatibility behavior, not native x64 hardware coverage.

## Bundled Sidecar Tests

macOS Apple Silicon packaged-app validation passed on 2026-07-15: the bundle contained the pinned arm64 binary, automatically started it beside an existing system Syncthing instance, used isolated ports and app data, created the default folder binding, preserved a private backend credential, and stopped the sidecar when the app closed.

Lifecycle validation passed on 2026-07-15: normal macOS Quit stopped both sidecar processes, released loopback port 8385, restarted successfully, and preserved the certificate/private-key hashes. The final exit callback also cleaned up an authenticated app-owned sidecar left without a tracked child handle by the earlier failing build.

- Clean machine without Syncthing installed: the packaged app starts its bundled engine.
- Existing system Syncthing: the bundled engine uses a separate home and port without modifying the system instance.
- First run: device identity, backend API Key, notes folder, and folder binding are created without raw configuration UI.
- Restart and upgrade: device identity and folder binding survive app restart and sidecar version update.
- Normal window close, macOS Quit, and Tauri restart requests use graceful authenticated shutdown before tracked-process fallback.
- The sync center states that quitting the alpha app stops synchronization; no hidden tray/background mode remains active.
- Port conflict, missing/wrong-architecture binary, corrupted config, and early process exit produce actionable messages.
- API Key does not appear in frontend state, synchronized Markdown files, logs, or user-visible diagnostics.
- macOS Apple Silicon/Intel, Windows x64, and Linux x64 packages contain the correct target-triple sidecar.
- The sidecar cannot expose its REST/GUI endpoint to the LAN through any frontend-provided value.

## Device Pairing Tests

- The standard desktop UI shows a local device code without exposing API addresses, ports, or API Keys.
- An incomplete, malformed, local, or already-configured device ID is rejected before configuration writes.
- Pairing preview shows the normalized remote device ID, device name, default notes sharing, token lifetime, and mutual-confirmation requirement.
- Confirmation adds exactly one remote device and patches only the device list of `s-light-notes`.
- Device and folder configuration are read back after writing; a failed share or verification triggers rollback.
- A configured but disconnected remote device is shown as waiting for confirmation; a live connection is shown as connected.
- Pairing Tauri invocations contain no API Key, arbitrary folder path, device address, or raw Syncthing configuration.
- Offline QR generation contains only the canonical local device ID and no API Key, folder path, note content, or network address.
- QR display expands and collapses without overflow at desktop and 390px mobile viewport widths; manual copy remains available.

### Desktop Sidecar Artifact Checkpoint - 2026-07-20

- Added the official Syncthing v2.1.2 macOS Intel and Linux x64 binaries using the release assets referenced in the signed checksum manifest.
- `syncthing-macos-amd64-v2.1.2.zip` matched SHA-256 `f04b3d7f1492457e929119b91561f0ddc6bada070f46b68bd2464cda04983424`; its x86-64 Mach-O binary matched `24cd4219041087bf67a2773fe0aa8ad976b8e579b4768c31df365a58058f1743` and reported v2.1.2 under Rosetta.
- `syncthing-linux-amd64-v2.1.2.tar.gz` matched SHA-256 `0cea24660ac7d8df19f01da979827b5c9463a8a60042e296829293cf80213ee4`; its x86-64 ELF binary matched `d5aa7b869042518ae62e35fd40a1ada84d3c7f970863c396da1db0d318509e89` and exposed the expected Linux amd64 Go build metadata.
- The signed checksum manifest is recorded with SHA-256 `fc79100eb44eef13c0a4954afb73422bdc9efea866535b7525d5882d5e037b1a`. PGP signature verification remains pending because GnuPG is not installed on the host.
- `npm run tauri:build:macos-intel` produced an x86-64 `.app`; it launched under Rosetta, bundled the expected sidecar hash, and returned `{"status":"OK"}` on the isolated loopback health endpoint.
- Native macOS Intel lifecycle/Markdown-loop acceptance and all native Linux package acceptance remain open and are not implied by the Rosetta or artifact checks.

## Sync Event Tests

- Initial polling requests only the latest matching event; subsequent calls continue after the last processed event ID.
- Event types, timeout, and result limit are fixed by Rust and cannot be expanded by frontend input.
- Device, folder, scan, completion, and error events refresh the existing sync-center state instead of creating a second state model.
- Opening the sync center starts event polling; closing it stops further requests after any in-flight call returns.
- Event requests use the backend-owned API Key without exposing it to frontend state.

## External Syncthing Manual Tests

- Syncthing not installed: app shows a clear unavailable state.
- Syncthing installed but stopped: app can attempt start or explain failure.
- Syncthing running: app detects health through `127.0.0.1:8384`.
- Wrong API key: app reports authentication failure.
- Port occupied: app reports connection or service mismatch.
- Existing matching folder: preview reports that no configuration write is needed.
- New folder: preview shows path, folder ID, selected devices, restart impact, and that writing has not occurred.
- New folder confirmation: a separate dialog repeats the exact path, folder ID, device count, and token lifetime.
- Configuration changed after preview: confirmation refuses to replace an ID or duplicate the notes path.
- Successful confirmation: Syncthing contains the new folder and the app refreshes to its live status.
- Verification failure: the app reports whether the newly created folder was rolled back or needs manual inspection.

## Multi-Device Tests

- Device A creates a note; Device B receives it.
- Device B edits a note; Device A receives it.
- Both devices edit the same note offline; conflict file appears after reconnect.
- Conflict file appears in the app as a conflict item.
- Local editing remains usable while remote devices are offline.

## Mobile Tests

### Android Native Engine Build Checkpoint - 2026-07-21

- Syncthing v2.1.2 source archive SHA-256, Go 1.25.11, NDK 28.2.13676358, build flags, ABI paths, and artifact hashes are recorded in `src-tauri/android-engine/SYNCTHING_ANDROID.json`.
- The arm64-v8a and x86_64 engines are verified as Android 64-bit PIE executables with 16 KB ELF load alignment.
- Separate arm64 and x86_64 debug builds passed and each APK contained only its selected Rust library and matching Syncthing engine, plus the MPL-2.0 notice.
- The merged manifest contains `dataSync` foreground-service permissions, an unexported service, no boot receiver, no all-files permission, and extracted native libraries.
- Kotlin storage and engine-policy tests passed for both ABIs; frontend tests, all 31 Rust tests, and macOS desktop packaging also passed at this checkpoint.
- Runtime launch, notification behavior, API 35+ timeout cleanup, device identity generation, and P2P transfer now have an API 36 arm64-emulator record. Physical-device validation remains required.

### Android Pairing Build Checkpoint - 2026-07-22

- arm64 and x86-64 debug APK builds pass with the Android sync center, constrained pairing commands, and ZXing scanner activity.
- Frontend bridge tests verify status, start, stop, pairing preview, confirmation, folder scan, and QR scan calls without API Keys or management ports.
- Kotlin policy tests reject incomplete device codes, control characters, oversized names, unsafe REST paths, and invalid private credentials.
- Pairing confirmation is held in memory for five minutes, consumed once, rechecks live device state, shares only `s-light-notes`, verifies both writes, and attempts rollback after failure.
- The sync center has no horizontal overflow at 320x640, 390x844, or 844x390; long device codes wrap and all tested controls retain at least 44px touch height.
- Camera denial, manual device-code confirmation, mutual desktop pairing, and real file transfer pass on an API 36 arm64 emulator. A physical API 36 arm64 phone also captured a QR code, parsed the canonical device ID, and rejected the already paired device without changing configuration.

### Android Background Policy Build Checkpoint - Current Branch

- Background policy controls cover opportunity sync, unmetered-only behavior, explicit continued-background sessions, notification permission, and the system battery-settings entry.
- Kotlin unit tests verify that continued-background sessions cannot become active without notification permission and that network settings map only to `UNMETERED` or `CONNECTED` WorkManager constraints.
- The unique periodic worker is constrained by battery-not-low and defaults to a one-hour interval with a 15-minute flex window. It does not start a second engine while the app or a visible background session already owns synchronization.
- WorkManager scheduler metadata may survive a reboot, but a boot-count gate prevents the worker from starting Syncthing until the app has been opened during the current boot.
- Process lifecycle handling keeps app-owned QR scanning from being treated as a true background transition. Leaving the application stops continuous synchronization unless the user enabled the notified session.
- API 35+ timeout, notification stop, app-background stop, policy stop, and opportunity-completion reasons are persisted for the sync-center status.
- Frontend tests and arm64/x86-64 Kotlin compilation and unit tests pass. API 36 emulator checks pass for notification denial, QR permission denial, notification stop, API timeout, force-stop, reboot gating, and foreground/background transitions. Physical foreground/background, notification, force-stop, identity recovery, and naturally timed bounded exchange behavior also pass. On 2026-07-29, JobScheduler recorded one successful worker; Syncthing logs show it connected to the paired desktop, transferred files, and stopped after the opportunity window.

### Android 16 Local Network Compatibility

- Install the API 36 build, enable local-network protection with `adb shell am compat enable RESTRICT_LOCAL_NETWORK com.slightnotes.v2`, and reboot the device or emulator.
- Before permission is granted, verify the app remains editable, reports that nearby-device access is required, and does not start the native engine from app lifecycle, manual start, or WorkManager.
- Tap **Start Sync**, deny nearby-device access, and verify local editing remains usable and the action can be retried.
- Tap **Start Sync** again, grant nearby-device access, and verify engine startup, Syncthing discovery, incoming connections, and direct LAN transfer.
- Revoke Nearby devices in system settings while the app is backgrounded; reopen the app and verify the managed engine stops and returns to the permission-required state.
- Confirm the merged manifest includes `NEARBY_WIFI_DEVICES` with `neverForLocation`, and does not include fine/coarse/background location permissions.
- Restore the default compatibility state after testing with `adb shell am compat disable RESTRICT_LOCAL_NETWORK com.slightnotes.v2`.

### Android Conflict Workflow Checkpoint - Current Branch

- The Android sync bridge filters Syncthing conflict IDs and returns only ID, source ID, and update time; note content is not included in the conflict-status result.
- The mobile note list marks conflicts separately. Opening one hides the ordinary delete and formatting actions, sets the editor to `contenteditable=false`, and exposes keep-copy, copy-content, and trash actions.
- Keeping a copy writes the same Markdown content through the normal native save path under a non-conflict unique name. Viewing and copying do not write the original conflict file.
- A 320x640 browser fixture confirmed no horizontal overflow, 44px conflict actions, a 44px sync-center conflict row, and a read-only editor attribute. The fixture was removed after validation.
- API 36 runtime acceptance passes for competing Android/desktop offline edits, Syncthing conflict-file creation on both peers, conflict-list refresh, and read-only opening. On the physical arm64 phone, a controlled conflict passed clipboard copy, keep-as-new, and trash checks. The source, conflict, kept copy, and trashed conflict each retained SHA-256 `4eaf4c4ea9883ea8f0c7dfe451557c51e2a363fd1d3c4e2f7962904684d74bca`; only the chosen conflict path moved into `.trash`. Synthetic copies were removed after verification.

### Android API 36 Runtime Acceptance - Current Branch

- Installed the arm64 debug APK on a clean API 36 emulator and verified native Markdown create/save/reopen plus system Files visibility through `DocumentsProvider`.
- Verified nearby-device denial leaves editing available and prevents engine startup; granting access starts the bundled engine with a fixed loopback-only management endpoint. Later revocation stops it safely.
- Verified foreground synchronization without notification permission, explicit notified background synchronization, the notification stop action, default background stop, force-stop non-resurrection, reboot gating, and stable Syncthing identity across reopen and reboot.
- Forced the API 35+ `dataSync` foreground-service timeout and verified the service and child engine stop cleanly with a recorded reason and no crash.
- Paired the Android runtime with an isolated packaged desktop Syncthing peer using the app's manual device-code confirmation. A note created on Android arrived on desktop, and a desktop-created note arrived in the Android private Markdown directory.
- Stopped synchronization, edited the same two notes independently on both peers, reconnected, and verified real `.sync-conflict-*` files appeared on both sides and in the app's conflict workflow.
- Verified camera denial keeps the pairing screen usable, and portrait plus low-height landscape screenshots retain status-bar separation and usable controls.
- Final regression passed `npm test`, all 31 Rust tests, arm64/x86-64 Kotlin unit tests, both split debug APK builds through the Tauri Android entry point, and macOS application packaging. Reinstalling the final arm64 APK over the tested app preserved notes, conflicts, and the existing Syncthing identity.
- Final debug artifacts: `app-arm64-debug.apk` SHA-256 `4cc901f48b9f1b66267ce09002b21b440f0099a3f836bd8ccbe82e45c6fd563c`; `app-x86_64-debug.apk` SHA-256 `6e3297ac39ed9ae21065205d0bf626e973311b74ee9312e88587250c5ffd1854`.
- Not yet passed: x86-64 emulator runtime, controlled long-duration physical-phone power characterization, fresh-install signed-release runtime, and store submission.

### Android 16 Physical Device Acceptance - 2026-07-22

- Installed the arm64 debug APK on a Xiaomi 2211133C running Android 16/API 36 and HyperOS 3.0. The device reported `arm64-v8a`, a 1080x2400 display, and the 2025-10-01 security patch.
- Created, saved, reopened, and synchronized real Markdown from the application-private notes directory. The system file picker showed the `s-light notes` provider and exposed only ordinary notes and conflict copies, not `.trash`, Syncthing identity, configuration, database, logs, or credentials.
- Verified the nearby-device permission gate before startup, successful grant, later revocation with immediate engine stop, continued local editing, and recovery after the permission was restored.
- Paired with an isolated desktop Syncthing peer through the app's preview and confirmation flow. Android-to-desktop and desktop-to-Android creation, modification, offline recovery, and direct LAN transfer passed.
- Produced a real conflict through independent offline edits. The app listed the conflict, opened it read-only, and preserved its content as a new ordinary note without deleting the original conflict file.
- Granted camera access only from the scan action and captured a QR code containing the isolated peer ID. Parsing succeeded and duplicate-device protection rejected the existing peer without applying another configuration change.
- Verified foreground synchronization without notification permission. With an explicit notified background session enabled, the engine remained active after Home and Android reported a persistent notification with a stop action; disabling the session restored default background stop behavior.
- Verified force-stop prevents process or engine resurrection. Reopening restored the same Syncthing certificate/key identity, fixed folder, paired peer, and scheduled WorkManager task.
- Portrait keyboard input kept the editor usable. Portrait and landscape layouts retained system-bar separation, stable headers, and usable controls; the landscape keyboard naturally leaves only a shallow editing area on this device.
- Security checks found the management API only on `127.0.0.1:8386`, while P2P used the expected LAN listener. Engine identity, configuration, database, logs, and API key remained inside application-private storage.
- Follow-up physical acceptance on 2026-07-29 observed a naturally scheduled WorkManager run while unplugged. The worker connected to paired device `5KRUWAE`, exchanged files, completed successfully, and stopped after its bounded window. Battery level moved from 30% to 29% during the broader unplugged inspection.
- Android's aggregate battery statistics since the last charge estimated 32.5 mAh for the app UID: 6.28 mAh foreground, 3.34 mAh background, 0.0405 mAh foreground service, and 0.431 mAh cached. Screen-off/doze attribution included 0.762 mAh CPU, 0.823 mAh camera, and 0.147 mAh Wi-Fi; the recorded WorkManager job used 479 ms and completed once. This is a mixed-use upper bound that includes earlier camera and foreground testing, not an isolated drain benchmark.
- The same follow-up completed the conflict clipboard, keep-as-new, trash, and SHA-256 preservation checks. A debug-package reinstall preserved the Syncthing certificate and private-key hashes exactly.

### Android Signed Release Checkpoint - 2026-07-29

- The release configuration refuses to run without ignored local signing properties. `npm run android:signing:setup` creates a 4096-bit RSA PKCS12 identity and local properties with owner-only permissions and refuses to replace an existing identity.
- `npm run tauri:android:build:release` targets only aarch64 and x86_64, producing two installable APKs and one universal AAB. The AAB contains both `arm64-v8a` and `x86_64` Rust and Syncthing libraries.
- Both APKs pass Android `apksigner` verification with v2 and v3 signature schemes. The AAB passes JAR signature verification. All three artifacts use certificate SHA-256 `bde886bebb20114c53661299f4d40bb679acbe433bb476eb4ab5bf7977efaddd`.
- Package metadata is `com.slightnotes.v2`, version code `2000000`, version name `2.0.0-alpha.0`, minimum API 26, and target API 36.
- Collected release artifacts:
  - arm64-v8a APK: 19,145,129 bytes; SHA-256 `de93522ffbe2962aa5d0166cea0c54140817d4f28211a6dc720d46b5776383a4`.
  - x86_64 APK: 19,924,144 bytes; SHA-256 `0a3c8feb827eaba71f44012f5c7f2b547e1905eea8c6e91e33f2ef277d3741ad`.
  - universal AAB: 37,363,533 bytes; SHA-256 `85eda2369427ec8b3afbef40ac30b55964987117360d96350613f86671661e88`.
- `npm test`, all 31 Rust tests after rebuilding the moved repository cache, arm64/x86_64 debug plus release Kotlin unit-test variants, and macOS desktop application packaging pass at this checkpoint.
- The signing identity is local and ignored but has not yet been backed up outside the development machine. Store upload validation remains pending.
- The installed acceptance build uses the Android debug certificate, while release artifacts use the local release certificate. Android rejects an in-place signature change, so the signed APK cannot replace the accepted debug package without uninstalling it and erasing application-private data. The phone's notes and identity were preserved; signed runtime smoke testing remains assigned to a fresh device or disposable test profile.

- Android build gate: target API 36, minimum API 26, NDK 28 or newer, and only the planned `arm64-v8a` and `x86_64` native artifacts.
- Android emulator gate: install and launch on an API 36 x86-64 image; verify 320px-430px layout, safe areas, keyboard, rotation, Android back handling, and no horizontal overflow.
- Android storage gate: create, save, reopen, trash, restore, permanently delete, and externally read/edit Markdown through the system `DocumentsProvider`.
- Android fallback gate: native-storage initialization failures are visible and do not silently move Tauri notes into IndexedDB; PWA continues to use IndexedDB normally.
- Android engine gate: verify pinned source metadata, ABI hashes, 16 KB page compatibility, isolated identity/config/data/log paths, fixed loopback API, and no desktop sidecar in the APK.
- Android lifecycle gate: verify foreground start, visible notification, notification stop action, graceful shutdown, early exit, API 35+ timeout handling, and no boot-started data-sync service.
- Android permission gate: camera denial preserves manual pairing; notification denial preserves foreground sync; battery restrictions and force-stop produce clear recoverable states.
- Android background gate: WorkManager performs bounded best-effort sync on an unmetered network and does not keep an undocumented daemon alive.
- Android P2P gate: pair a connected arm64 phone with a packaged desktop, exchange notes in both directions, edit while offline, reconnect, preserve identity, and retain Syncthing conflict copies.
- Android security gate: normal UI and JavaScript contain no API Key, raw config, arbitrary note path, management port, or LAN-exposed REST endpoint.
- Android regression gate: run `npm test`, all Rust tests, the macOS desktop build, and the Android build before the first user APK handoff.
- iOS validates foreground sync, opportunistic background tasks, suspended-state recovery, and clear last-sync status.
- Syncthing-Fork is used only as an optional behavior/build reference; the Android APK must not depend on or launch it.
- iOS keeps Möbius Sync or import/export as a fallback until the embedded engine is release-ready.
- Mobile UI does not depend on desktop-only Tauri commands.

### Mac 包资源签名补充

额外对 DMG 内应用执行严格校验时，旧的隐式链接器签名未通过资源封印验证。已在 Tauri 配置显式使用 ad-hoc 签名 `-`，同时签名主程序、sidecar 与整个应用包；本机 `codesign --verify --deep --strict`、版本号以及两份可执行文件的 arm64 架构检查通过。两个原生 Mac CI 目标均通过相同检查；签名后的本机应用也再次启动并完成空便签打开/关闭测试。此签名不代表 Apple Developer ID 或公证通过；本机无可用发行身份，正式发行签名仍为外部门槛。

### 最终产物与清理

- 五个原生安装包已下载到 `release/native-0.1.0/`，全部与 CI 的 SHA-256 清单匹配。
- CI 提供两个 Mac DMG、Windows x64 NSIS EXE、Linux x64 deb/AppImage，每个平台均有 SHA256SUMS；原生构建成功不等于安装后人工验收通过。
- 最终 Android arm64/x86-64 APK 和通用 AAB 已收集到 `release/android/0.1.0/` 并验证签名。最终 arm64 包在独立 API 36 模拟器同签名重装、冷启动通过，无 AndroidRuntime 崩溃。
- 临时 Android 模拟器 `slight-release-qa` 已关闭并删除；原有 AVD 保留。
- 所有临时真实笔记均移入回收站，原有 10 个笔记内容未改动；含原笔记内容的临时导出目录已删除。
- 最终代码之后的提交只更新验证记录；不修改已通过 CI 的产品代码，也不创建新的公开 GitHub Release。

### Windows 交互验收的补充尝试

恢复了本机既有 `Win10` 虚拟机，确认是 Windows 10 19044 / AMD64，已有 `0.0.1` 安装记录及设备证书。本次尝试未记为升级或交互验收通过：Guest Tools 无法读取本次只读安装包共享，随后界面控制工具返回“Mac is locked and automatic unlock could not unlock it”，必须由用户手动解锁才能继续界面检查。

已取消本次命令客户端，关闭仅绑定 VM 网络接口的安装包传输服务，撤销只为本次测试创建的 `slight-notes-qa` 共享，并确认虚拟机恢复为原来的 `suspended` 状态。原有共享保留。Windows 的升级数据保留、编辑及便签人工验收仍待完成；不能用原生 CI 成功替代这些检查。

### Windows 解锁后续验收 — 2026-10-25

- 解锁后确认虚拟机已运行。改用仅绑定 `10.211.55.2` 的临时 HTTP 服务传入安装包，客体计算的 SHA-256 为 `dae535c9765c208505a0fab6b576bee594386ebbc31f327d8ec6dc0fda791eab`，与 CI 清单一致；传输服务已关闭。
- `prlctl exec --current-user` 的启动请求未能可靠执行，取消了本次挂起客户端。通过一次性、使用已登录 Administrator 交互令牌的任务运行安装程序 `/S`，结果为 0；没有变更账户凭据或执行策略。
- 原安装目录 `C:\s-light-win-app` 保留，程序 `ProductVersion` 和原用户卸载项 `DisplayVersion` 均为 `0.1.0`。已对 `C:\Mac\Home\Documents\s-light-notes` 的 10 个原有 Markdown 逐文件比较升级前后 SHA-256，变化数为 0；原设备证书摘要一致。
- 新版本窗口及 WebView2 155.0.4283.45 进程已启动，同步引擎管理端口监听在 `127.0.0.1:8385`。画面停留在笔记列表尚未加载的状态；界面工具的鼠标/按键未能稳定传入客体，尚不能区分输入路由与应用初始化问题，也未取得有效的前端诊断日志。
- 因此本次只确认安装和文件完整性，不确认笔记可编辑、便签、退出保存、配对保留或完整升级迁移。诊断中重启过本次启动的空窗口，不能视为正常退出验收。
- 一次性安装、启动和诊断任务已移除，临时键盘优化设置已恢复为 `auto`；原有共享保留。为等待用户确认客体能否手动操作，虚拟机保留在运行状态。
