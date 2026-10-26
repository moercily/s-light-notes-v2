# 无界面测试

2026-10-26 起，默认在 Docker 与无界面 QEMU 中运行少量相关测试。Parallels Desktop 或 Mac 真机验收必须先询问用户；不启动宿主机应用、浏览器或模拟器窗口。

## 一次性准备

需要 Docker CLI、QEMU 和 Colima。通过 [Colima 配置](https://colima.run/docs/configuration/)建立独立 ARM64 Linux 环境，在 Apple Silicon 上使用硬件虚拟化，避免日常运行 x64 全系统模拟：

```sh
colima start slight-qa --vm-type qemu --arch aarch64 --cpu-type host \
  --cpus 2 --memory 2 --disk 12 --runtime docker \
  --mount none --mount-type 9p --activate=false --ssh-config=false --binfmt=false
```

不设置登录自启，不挂载宿主机目录，不改变当前 Docker context。初次运行需下载虚拟机与 Node 镜像，后续复用缓存。QEMU 内存上限 2 GiB，容器上限 512 MiB、2 CPU；结束后停止虚拟机释放内存。

若首次拉取镜像需要本机代理，在命令前设置已有的 `HTTPS_PROXY` / `HTTP_PROXY`，不要修改系统代理或 Docker Desktop 设置。Node 基础镜像固定到已验证的摘要，依赖使用 lockfile 安装；缓存命中后不重装依赖。

## 日常检查

```sh
npm run test:container
# 只检查相关模块；一次顺序执行，避免占满机器
npm run test:container -- native-shell
npm run test:container -- editor desktop-storage
# 完成后停止；缓存保留，下次用同一 start 命令恢复
colima stop slight-qa
```

默认只运行原生壳缓存恢复、桌面编辑切换与移动端保存/外观三组测试。每组限时 30 秒；只有修改涉及其他模块时才添加对应测试。测试源码不足 1 MB，通过 Docker 专用忽略清单只复制前端、测试、缓存恢复脚本和版本元数据，不包含用户笔记、构建产物、Android 签名文件或同步身份。容器不访问网络、不挂载宿主机目录，退出即删除。

本机首次验证：三组执行 0.34 秒；随后单组 `native-shell` 执行 0.02 秒，包含缓存构建和容器启动的整条命令约 0.94 秒。耗时不包含首次环境下载，不代表原生应用启动或真机输入速度。

其他已启动的 Docker 环境可通过 `SLIGHT_DOCKER_CONTEXT` 显式指定。脚本不会自动启动 Docker Desktop，也不会切换全局 context。

## 验证范围

- DOM 和 JavaScript 检查验证编辑、保存屏障与界面逻辑，不能代替原生 IPC、WebView2、全局快捷键、置顶或安装迁移验收。
- 完整仓库结构、Rust、双同步引擎和安装包构建继续按改动需要交给原生 CI，不因修改文档或测试入口而重复四平台构建。
- Windows 原生问题优先使用远端 Windows 运行器。确需本机 Parallels 或 Mac 真机时，先说明待验证内容并询问用户。
- 后续 QEMU Android 使用 `-no-window -no-audio -no-snapshot`，独立 AVD 和少量数据；没有必要时不启动 Android 模拟器。
- Linux 图形验收如有必要，使用容器内 Xvfb；画面与输入留在测试环境，不能弹出宿主机窗口。当前入口尚不执行原生图形验收。

## Android 签名版的小规模原生检查

已有 Android SDK、API 36 Google APIs ARM64 镜像、JDK 和签名 APK 时，可直接运行：

```sh
python3 scripts/test-android-headless.py
# 已保留旧的同签名开发包时，检查旧版笔记与回收站升级
python3 scripts/test-android-headless.py --previous-apk /path/to/older-signed-arm64.apk
# 按需增加当前版本的引擎启动/停止、Activity 重建与身份重装检查
python3 scripts/test-android-headless.py --check-identity --previous-apk /path/to/older-signed-arm64.apk
```

脚本创建自己的临时 AVD，固定 `-no-window -no-audio -no-snapshot`，2 CPU、480×960 分辨率，关闭客体 Wi-Fi 和移动数据。模拟器虚拟以太网仍可用，因此还在该临时客体中设置 IPv4/IPv6 出站规则，只允许 loopback 和模拟器宿主别名 `10.0.2.2`。不在传输中途启用 Wi-Fi，避免网卡地址切换造成连接重置及引擎重试等待。保持客体屏幕唤醒以免后台策略干扰前台用例；不打开宿主机窗口。API 36 模拟器会把请求的 1536 MB 内存提高到最低 2560 MB，因此不同时运行其他模拟器。宿主机不接管键盘或剪贴板。SDK 通过 `ANDROID_HOME` 指定。

只使用两条 ASCII 测试笔记，通过 Android UI Automator 的真实控件位置点击和 Android 输入事件验证本机保存、重开、移入回收站、安装新包、修改、恢复和冷启动。`--check-identity` 在独立的零笔记用例中先验证当前版本同签名重装后的界面设备码，再重置这一用例，开始旧版笔记升级用例；不将其记作旧版身份迁移通过。权限弹窗只存在于临时客体中，启动引擎时仅允许该客体的附近设备权限，不申请相机或通知权限。

成功或失败写入 `release/qa/android-headless.json`，结束后关闭并删除本轮 AVD；不使用既有 AVD，不覆盖真实设备上的 debug 安装。最终签名包的含身份组合检查约 209 秒。它不替代中文输入法、相机、真实 P2P 交换、通知后台或耗电验收。

`npm run android:release:collect` 现在先使用 Python 3 比较两份 APK 和 AAB 中的 Rust/Syncthing 库与当前编译结果，共 8 份载荷；发现旧库时停止收集，保留此前收集目录。Windows 可通过 `SLIGHT_PYTHON` 指定 Python 3 可执行文件。Gradle 在读取共享 JNI 目录前完成所有已配置 ABI，并声明 Cargo 输出，避免缓存打入旧库。

## 签名 Android 真实 P2P 与编辑器用例

先准备当前版本的签名 ARM64 APK。默认路径跟随 `package.json` 的版本；本轮 0.1.1 使用已校验并保存的 `release/android/0.1.1/s-light-notes-0.1.1-arm64-v8a.apk`。

```sh
# 固定 v2.1.2 官方 Linux ARM64 归档；脚本会验证 SHA-256，拒绝其他文件。
python3 scripts/test-android-headless.py \
  --previous-apk release/android/0.1.0/s-light-notes-0.1.0-arm64-v8a.apk \
  --p2p-peer-archive /path/to/syncthing-linux-arm64-v2.1.2.tar.gz
# 独立测试包不进入产品 APK；只安装到本轮创建的临时 AVD。
python3 scripts/build-android-qa-ime.py
python3 scripts/test-android-headless.py --editor-qa-ime release/qa/slight-qa-ime.apk
```

归档来源为 [固定的官方发行](https://github.com/syncthing/syncthing/releases/tag/v2.1.2)，SHA-256 `2fcee9688f37df46337b0b78e7d2badc44549481e29eccaa8cdb1e698d79c8c5`，已与官方摘要清单匹配。构建对端镜像时只复制该二进制和测试启动器，不复制项目目录。Docker 对端上限 1 CPU/256 MiB，无宿主机挂载，数据放在 tmpfs，API 与传输端口仅映射宿主机 loopback。测试通过 Android 模拟器的宿主别名连接这些端口，不使用公共发现、中继、NAT 或报告服务。临时 AVD 使用可 root 的 Google APIs 镜像，仅从自己的临时安装中读取 API Key 和公开证书进行迁移核对；不访问已有设备或身份，报告不打印 API Key。

P2P 用例只创建两条初始笔记，使用 Android UI 配对、编辑和停止引擎；控制 API 只用于设置隔离地址、触发扫描和验证配置。报告 `android-p2p-upgrade.json` 区分文件传输、设备码、证书、文件夹与配对迁移。它不代表两台桌面安装包 UI 验收。

编辑器用例通过测试输入法的真实 Android InputConnection 发送组合与提交事件，确认半成品未落盘；再使用 200 个生成的原生 Markdown 文件和约 24.7 KB 长笔记，检查搜索和编辑后内容一致。耗时包括 ADB/UI Automator 开销，不是渲染帧时间，也不能替代厂商输入法、物理键盘或低端手机性能。报告为 `android-editor.json`。两类用例顺序执行，结束后移除自己的容器并删除 AVD。

## 远端安装版的定向重跑

`desktop-validation.yml` push/PR 和手动运行默认只选择 Windows/Linux，手动还可只选择 Windows 或 Linux，Mac 环境仍须按测试约束事先征求同意。Linux 图形会话在远端虚拟机内的 Xvfb/Openbox 中运行；Windows 输入、剪贴板与测试窗口仅存在于一次性远端 VM。

构建完成即收集并保留安装包，即使后续 UI 检查失败也保留摘要。只改测试脚本时可指定 `package_run` 复用原安装包；流程先核对原运行提交与当前 `app`、`src-tauri`、npm 元数据没有差异，再逐文件验证 SHA256SUMS。产品代码变化不得复用这一路径。原生编辑、便签、真正的窗口置顶、从另一客体应用触发全局快捷键及正常退出均分别记录。

Windows 缓存恢复检查仅在该一次性 VM 中，通过临时 loopback 调试端口设置真实的旧 Service Worker、CacheStorage、localStorage/IndexedDB 哨兵，再重载验证原生初始化和数据保留。不会写入发行配置；环境变量用法依据 [Microsoft WebView2 调试文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code)。
