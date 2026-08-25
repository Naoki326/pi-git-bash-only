# pi-git-bash-only

在 Windows 上强制 pi 只用 Git Bash 的包。装上即生效，无需手动改任何文件（一项除外：见下「唯一的手动建议」）。

## 功能

| # | 功能 | 机制 |
|---|------|------|
| 1 | **硬拦截** powershell / pwsh / cmd 调用（含 `.exe`、全路径、`` `反引号` ``、`cmd //c` 形式） | `tool_call` hook，命中即 block，reason 引导模型改用 bash 语法 |
| 2 | **软规则注入**：每轮向 system prompt 追加 shell 政策（禁令 + 独立 exe 替代方案清单） | `before_agent_start` 修改 system prompt |
| 3 | **shell 归属检测**：启动时静态检查 `shellPath` 设置 / Git Bash 默认路径归属，非 Git Bash 时警告并给出修复命令 | `session_start` |
| 4 | **自动安装 `wmicu`**（wmic 的 GBK→UTF-8 输出包装）到 `~/bin`，幂等更新；只管理带本包标记的文件，用户自建同名脚本不覆盖 | `session_start` |
| 5 | `/gitbash` 命令：查看检测与安装状态 | `registerCommand` |

非 Windows 平台：包不注册任何 hook，零副作用。

## 安装

```bash
# npm
pi install npm:pi-git-bash-only

# git（GitHub/GitLab 均可）
pi install git:github.com/<user>/pi-git-bash-only
pi install https://gitlab.com/<user>/pi-git-bash-only

# 本地路径（开发/试用）
pi install /absolute/path/to/pi-git-bash-only

# 不安装、仅本次会话试用
pi -e /absolute/path/to/pi-git-bash-only
```

## 唯一的手动建议：固定 shellPath

包无法替你写 `settings.json`（包只携带 extensions/skills/prompts/themes）。
若你的机器 Git Bash 不在 `C:\Program Files\Git\bin\bash.exe`，或 PATH 上有
Cygwin/MSYS2/WSL 的 `bash.exe`，建议在 `~/.pi/agent/settings.json` 显式固定：

```json
{
  "shellPath": "C:/Program Files/Git/bin/bash.exe"
}
```

不设也能工作——pi 的查找顺序是 `shellPath` → Git Bash 默认路径 → PATH 扫描；
默认路径存在时 pi 一定选它。包启动时会检测并在需要时提示你。

## wmicu 说明

- 用途：`wmic` 输出（含错误消息）是 GBK 编码，Git Bash（UTF-8）下中文乱码；
  `wmicu` 经 node `TextDecoder('gbk')` 转码。依赖 `wmic.exe` 与 `node` 在 PATH。
- 用法同 wmic：`wmicu process where processid=<PID> get processid,commandline`
- PID 是 Windows pid（`tasklist`/`wmic` 查到的），不是 Git Bash 内部 `$$`。
- 前提：`~/bin` 在 PATH（安装时若不在会提示）。Windows 上 Git Bash 会按
  shebang 执行无扩展名脚本，cmd/PowerShell 不会误触它。

## 卸载

```bash
pi remove npm:pi-git-bash-only   # 或对应 source
rm ~/bin/wmicu                   # wmicu 是唯一写到包外的文件
```

## 设计说明

- 拦截正则经 33 个用例验证：18 种调用形式全拦；`$cmd`、`--cmd`、`foo.cmd`、
  `cmdlet`、`cmdkey`、`npm run cmd:x` 等 15 种正常命令不误伤。
- 宁严勿漏：纯文本提及（如 `echo "powershell"`）也可能被拦，代价只是一次
  重试，block reason 中已写明改法。
- 拦截覆盖 pi 的 bash 工具（含子代理调用）；用户手动 `!`/`!!` 命令与
  其他扩展自行 spawn 的进程（如 context-mode）不在管辖内——但 pi 的
  bash 工具与常见执行面本身就走 Git Bash。
