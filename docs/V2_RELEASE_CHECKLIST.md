# 发布与恢复检查清单

适用于 0.1.1 及后续版本。开发版本号不代表该版本已经公开发布。

## 自动化门槛

- 日常改动先按 [无界面测试](HEADLESS_TESTING.md) 选择少量相关容器测试；下列完整门槛在发布或相关原生代码改动时执行。使用 Parallels 或 Mac 真机前先询问用户。
- `npm ci && npm test`。
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`。
- `npm run test:p2p`：两个独立本地引擎的实际文件交换与冲突。
- 对应操作系统运行 `desktop-validation.yml`，保存安装包和 `SHA256SUMS`。
- Android：两种 ABI 单元测试、签名 APK/AAB 构建与签名校验。
- 收集 Android 产物时校验包内原生库与当前编译结果一致；按改动需要运行 `scripts/test-android-headless.py` 的两条笔记用例，身份检查通过 `--check-identity` 单独启用。

## Markdown 备份与恢复

桌面侧栏的“导出全部”在选择的位置创建独立文件夹，包含普通笔记、冲突副本和 `manifest.json`（文件 SHA-256）。不包含回收站、应用设置或 Syncthing 身份。

恢复时点击“导入”，选择该文件夹内的 `.md` 文件。同名笔记创建 `-2` 等新副本，不覆盖现有内容。冲突文件名转为普通副本名，正文保持不变。一次最多 2000 个文件，单文件最多 32 MB；非法文件或非 UTF-8 内容会明确报错。

升级前还需单独保存回收站及平台应用数据目录中的同步身份和配置。不要把含凭据的应用数据目录放入普通笔记同步文件夹。自动 Markdown 导出不等同于完整设备身份备份。

## 升级迁移验收

- 保存一条普通笔记、冲突副本和回收站笔记；记录文件摘要与设备 ID。
- 安装旧包，配对测试设备；退出所有窗口，确认引擎已停止。
- 使用同一应用 ID、相同签名安装新版本，不删除应用数据。
- 比较笔记正文、回收站、设备 ID、文件夹绑定和已有配对；检查便签和设置保留。
- 再次验证离线编辑、重启及双向同步。
- Android `versionCode` 每次对外分发递增；本版为 `2000003`。debug 签名与 release 签名不能互相覆盖安装，应使用独立模拟器或测试用户。
- 回滚先备份新版本数据，不在唯一数据副本上尝试降级；未验证回滚前，不提供自动降级按钮。

## 人工发布门槛

- 原生安装、首次运行、编辑与保存、回收站、配对、同步、冲突、离线、升级和卸载数据行为均有记录。
- Windows/Linux 便签、全局快捷键及置顶实测；Mac 跨应用物理快捷键与真实登录自启实测。
- Android 签名身份已备份到开发机之外并校验；签名版全新安装、升级和真机耗电测试通过。
- 签名/公证、商店账号、隐私声明和上传验证按分发渠道完成。
- 现有 `0.0.1` 发布保持不变；新版本仅在明确发布范围后创建。

## 本轮材料与后续发行

自动更新不作为开发目标。使用手动安装包升级，升级前保存并退出，单独备份笔记、回收站、设置与同步身份。

用户确认 P3 只准备材料；[0.1.1 发行材料包](RELEASE_MATERIALS_0.1.1.md) 和 [隐私草案](PRIVACY_DRAFT.md) 已列出文案、签名恢复操作、权限/网络说明、真机耗电方案和渠道待补项目。材料准备完成不表示机外备份、物理设备、正式签名或商店验证通过。

参考：[Tauri 平台前置依赖](https://v2.tauri.app/start/prerequisites/)、[GitHub 原生运行器](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

Mac 开发包显式使用 ad-hoc 签名，主程序、内置引擎与应用资源一并封印。`node scripts/verify-macos-bundle.mjs <应用包路径>` 校验资源签名、版本和架构。它不能替代 Developer ID 签名与公证。配置依据：[Tauri 官方签名说明](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/distribute/Sign/macos.mdx)。
