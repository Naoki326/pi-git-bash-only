# pi-git-bash-only

![pi package](https://img.shields.io/badge/pi-package-blue) ![platform](https://img.shields.io/badge/platform-Windows-lightgrey) ![license](https://img.shields.io/badge/license-MIT-green)

> **Your Windows pi agent gets exactly one shell: Git Bash.**

You standardized on Git Bash — and then the model "helpfully" emits:

```bash
powershell -Command "Get-Process | Select Name"    # sneaks in PowerShell
cmd /c "dir /s"                                    # …or cmd
```

That escapes your shell policy, breaks your quoting/encoding assumptions, and reintroduces everything you moved to Git Bash to avoid. Telling the model not to do it helps — until context gets long and it forgets.

**pi-git-bash-only** enforces it instead of asking nicely:

| Layer | What it does |
|---|---|
| 🔒 **Hard block** | A `tool_call` hook blocks `powershell` / `pwsh` / `cmd` calls — including `.exe`, full-path, backtick, and `cmd //c` forms. The block reason tells the model exactly which bash-friendly exe to use instead. |
| 🧠 **Soft policy** | Injects a concise shell policy into the system prompt every turn (block-list + standalone-exe alternatives), so the model rarely tries in the first place. |
| 🔍 **Shell audit** | On startup, statically verifies which bash pi will actually use (`shellPath` setting → default Git Bash location → PATH scan). If it's not Git Bash, you get a warning with the exact settings fix. |
| 📦 **`wmicu` included** | Idempotently installs `wmicu` — a GBK→UTF-8 wrapper for `wmic` — to `~/bin`. It's the missing piece for *"show me the command line before I kill that PID"* when your terminal is UTF-8 and wmic isn't. |
| 🩺 **`/gitbash`** | One command shows shell audit + wmicu + PATH status at a glance. |

No-op on non-Windows platforms. No configuration required.

## Install

```bash
# from GitHub
pi install git:github.com/Naoki326/pi-git-bash-only

# from npm
pi install npm:pi-git-bash-only
```

Try it without installing:

```bash
pi -e git:github.com/Naoki326/pi-git-bash-only
```

## See it work

Ask the agent to use PowerShell. Watch it bounce off the block and land on bash:

```
> run this: powershell -Command "echo e2e-test"

✗ tool bash: powershell -Command "echo e2e-test"
  BLOCKED — 已拦截 Windows 原生 shell 调用（powershell）。
  本环境已禁用 Windows 原生 shell（Git Bash only，pi-git-bash-only 包）。
  请改用 bash 语法重新实现；需要 Windows 特定功能时直接调用独立 exe：
  注册表用 reg.exe、进程用 tasklist/taskkill、进程 CommandLine 核验用
  wmicu、服务用 sc.exe、文件 ACL 用 icacls.exe。

✓ tool bash: echo e2e-test
  e2e-test

The powershell call was hard-blocked by pi-git-bash-only; re-implemented
with native bash — same output.
```

One retry, then it stays in bash for the rest of the session — the soft policy means most sessions never hit the block at all.

## The one (maybe) manual step

Packages can carry extensions but not your `settings.json`. pi resolves its shell as `shellPath` setting → `C:\Program Files\Git\bin\bash.exe` → PATH scan, so **if Git Bash is in the default location you're done — no action needed**.

Otherwise, pin it in `~/.pi/agent/settings.json`:

```json
{ "shellPath": "C:/Program Files/Git/bin/bash.exe" }
```

The startup audit warns you (with this exact fix) if pi would pick anything else.

## `wmicu`

`wmic.exe` emits GBK; a UTF-8 Git Bash renders its Chinese output as mojibake — which silently defeats "verify the command line before killing that PID". `wmicu` pipes wmic through Node's built-in `TextDecoder('gbk')` (no `iconv` needed — minimal Git Bash installs don't ship one):

```bash
$ wmicu process where processid=999999 get commandline
没有可用实例。                    # was mojibake

$ wmicu process where "name='node.exe'" get processid,commandline
```

- Same usage as `wmic`. Requires `node` and `wmic` on PATH.
- PIDs are Windows PIDs (`tasklist`/`wmic` ones), not Git Bash's internal `$$`.
- Install is idempotent: the file is marked `# pi-git-bash-only: managed` and only managed copies are ever replaced — **your own `~/bin/wmicu` is never touched**.

## Complements `pi-ast-guard`

[`pi-ast-guard`](https://www.npmjs.com/package/pi-ast-guard) blocks *destructive* commands via AST parsing. `pi-git-bash-only` locks *which shell* your agent may reach. Different axes, zero overlap — use both for defense in depth.

## Design notes

- The block regex is battle-tested against **33 cases**: all 18 invocation forms blocked (`powershell -Command`, `pwsh -c`, `cmd //c`, full paths, `$(cmd /c …)`, backticks, mixed case…); 15 benign patterns pass untouched (`$cmd`, `--cmd`, `foo.cmd`, `cmdlet`, `cmdkey`, `npm run cmd:x`, `git commit -m "…cmd…"`-shaped text, …).
- **Fail-closed by intent**: a plain-text mention (`echo "powershell"`) may cost one blocked retry — the reason always explains the fix. Silence-by-default would leak the very thing you installed this to prevent.
- Covers pi's `bash` tool, including sub-agent calls. User-typed `!`/`!!` commands and processes spawned by other extensions are outside its jurisdiction — pi's own tool surface and common execution layers already run Git Bash.
- `session_start` audit is fully static (no command execution).

## Uninstall

```bash
pi remove npm:pi-git-bash-only        # or your git source
rm ~/bin/wmicu                        # the only file written outside pi
```

## License

MIT
