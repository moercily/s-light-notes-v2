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
