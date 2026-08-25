/**
 * pi-git-bash-only — 在 Windows 上强制 pi 只用 Git Bash
 *
 * 职责：
 * 1. tool_call 硬拦截：bash 命令中调用 powershell/pwsh/cmd（含 .exe、
 *    全路径、反引号、cmd //c 形式）一律 block，reason 引导改用 bash 语法。
 * 2. before_agent_start：向 system prompt 追加 shell 政策（软规则），
 *    每轮重建、每轮追加，幂等。政策含「原生 exe 铁律」：MSYS 路径转换
 *    （/X 参数被改写）与 GBK 输出乱码的对策。
 * 3. session_start：静态检测 shell 归属（shellPath 设置 → Git Bash 默认
 *    路径 → PATH 扫描），非 Git Bash 时 notify 警告并给出修复建议。
 * 4. session_start：幂等安装 bin/ 工具到 ~/bin：
 *    - wmicu：wmic 的 GBK→UTF-8 包装
 *    - gbk：任意原生 exe 的包装（自动禁用 MSYS 路径转换 + GBK→UTF-8），
 *      兼管道模式（stdin 转码）
 *    仅管理带本包标记的文件，用户自建同名脚本不覆盖。
 *
 * 非 Windows 平台：不注册任何 hook，零副作用。
 * 拦截正则经 33 个用例验证（18 种调用形式全拦；$cmd/--cmd/foo.cmd/
 * cmdlet/cmdkey/npm run cmd:x 等 15 种正常命令不误伤）。
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const MANAGED_MARK = "# pi-git-bash-only: managed";

// bin/ 下随包分发、安装到 ~/bin 的工具
const BIN_TOOLS = ["wmicu", "gbk"] as const;

// —— 拦截正则（33 用例验证，见文件头注释）——
const WIN_SHELL_RE = /(?<![@\w.$-])(?:powershell|pwsh|cmd)(?:\.exe)?(?=$|[\s;&|)><"'/\\`])/gi;

const ADVICE =
	"本环境已禁用 Windows 原生 shell（Git Bash only，pi-git-bash-only 包）。" +
	"请改用 bash 语法重新实现；需要 Windows 特定功能时直接调用独立 exe：" +
	"注册表用 reg.exe、进程用 tasklist/taskkill、进程 CommandLine 核验用 wmicu、" +
	"服务用 sc.exe、文件 ACL 用 icacls.exe。" +
	"调原生 exe 优先用 gbk 包装（如 gbk taskkill /PID 123 /F：免 /参数 转义 + GBK 转码）。";

// —— system prompt 软规则（每轮追加，等价于全局 AGENTS.md 的规则条目）——
const SHELL_POLICY = `

## Shell 政策：只用 Git Bash（Windows，pi-git-bash-only）

- 禁止调用 powershell/pwsh/cmd（含 .exe 与全路径形式，如 powershell -Command ...、cmd /c ...）——有 tool_call hook 硬拦截，重试同形式只会再被拦一次。
- bash 工具命令一律用 bash 语法；需要 Windows 特定功能时直接调用独立 exe：注册表 reg.exe、进程 tasklist/taskkill、进程 CommandLine 核验 wmicu、服务 sc.exe、文件 ACL icacls.exe。
- Git Bash 调原生 exe 两铁律：
  1) MSYS 路径转换：/PID、/FI 等 /X 风格参数会被改写成 C:/Program Files/Git/X 而报错。优先用 gbk 包装（gbk taskkill /PID 123 /F，自动禁用转换），或把参数写成 //X 形式（taskkill //PID 123 //F）。
  2) 中文输出乱码≠执行失败：原生 exe 输出是 GBK。要读输出就转码——gbk 包装，或管道 | gbk。
- wmicu 是 wmic 的 GBK→UTF-8 输出包装：wmicu process where processid=<PID> get processid,commandline。
- tasklist/wmicu 查到的 PID 是 Windows pid，不是 Git Bash 内部 $$。`;

// —— shell 归属检测（纯静态，不执行命令）——

interface ShellCheck {
	ok: boolean;
	level: "ok" | "warn";
	detail: string;
	fixed: boolean; // 是否通过 shellPath 显式固定
}

export function readSetting(files: string[], key: string): unknown {
	for (const f of files) {
		try {
			const v = JSON.parse(fs.readFileSync(f, "utf8"))[key];
			if (v !== undefined) return v;
		} catch {
			/* 文件不存在或非法 → 试下一个 */
		}
	}
	return undefined;
}

export function checkShell(globalDir: string, projectDir: string | undefined): ShellCheck {
	const files = [
		...(projectDir ? [path.join(projectDir, ".pi", "settings.json")] : []),
		path.join(globalDir, "settings.json"),
	]; // 项目覆盖全局
	const shellPath = readSetting(files, "shellPath") as string | undefined;

	if (typeof shellPath === "string" && shellPath.length > 0) {
		const norm = shellPath.replace(/\//g, "\\").toLowerCase();
		if (/\\git\\/.test(norm)) {
			return { ok: true, level: "ok", detail: `shellPath → ${shellPath}（Git Bash，显式固定）`, fixed: true };
		}
		return {
			ok: false,
			level: "warn",
			detail: `shellPath → ${shellPath}（非 Git Bash）`,
			fixed: true,
		};
	}

	// 无 shellPath：pi 优先用 Git Bash 默认路径，仅当它不存在时才扫 PATH
	const defaultGitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
	if (fs.existsSync(defaultGitBash)) {
		return {
			ok: true,
			level: "ok",
			detail: `未设 shellPath，但 Git Bash 默认路径存在（${defaultGitBash}），pi 会优先使用它`,
			fixed: false,
		};
	}
	return {
		ok: false,
		level: "warn",
		detail: "未设 shellPath 且 Git Bash 默认路径不存在，pi 将扫描 PATH（可能是 Cygwin/MSYS2/WSL）",
		fixed: false,
	};
}

// —— bin 工具幂等安装到 ~/bin ——
// 只管理带 MANAGED_MARK 的文件；用户自建同名脚本不覆盖。

interface InstallResult {
	tool: string;
	status: "installed" | "updated" | "kept" | "conflict" | "skipped";
	detail: string;
}

export function homeBinOnPath(homeDir?: string): boolean {
	const home = homeDir ?? os.homedir();
	const homeBin = path.join(home, "bin");
	const sep = process.platform === "win32" ? ";" : ":";
	return (process.env.PATH ?? "")
		.split(sep)
		.some((p) => p.trim() && p.replace(/[/\\]+$/, "").toLowerCase() === homeBin.toLowerCase());
}

export function installBins(pkgRoot: string, homeDir?: string): InstallResult[] {
	const home = homeDir ?? os.homedir();
	const srcDir = path.join(pkgRoot, "bin");
	const destDir = path.join(home, "bin");
	const results: InstallResult[] = [];

	for (const tool of BIN_TOOLS) {
		const src = path.join(srcDir, tool);
		const dest = path.join(destDir, tool);

		let srcContent: string;
		try {
			srcContent = fs.readFileSync(src, "utf8");
		} catch {
			results.push({ tool, status: "skipped", detail: `包内缺少 ${src}` });
			continue;
		}

		if (fs.existsSync(dest)) {
			let existing = "";
			try {
				existing = fs.readFileSync(dest, "utf8");
			} catch {
				results.push({ tool, status: "conflict", detail: `~/bin/${tool} 存在但不可读，跳过` });
				continue;
			}
			if (!existing.includes(MANAGED_MARK)) {
				results.push({ tool, status: "conflict", detail: `~/bin/${tool} 已存在且非本包管理，未覆盖` });
				continue;
			}
			if (existing === srcContent) {
				results.push({ tool, status: "kept", detail: `~/bin/${tool} 已是最新` });
				continue;
			}
		}
		const isUpdate = fs.existsSync(dest);

		try {
			fs.mkdirSync(destDir, { recursive: true });
			fs.writeFileSync(dest, srcContent, "utf8");
		} catch (e) {
			results.push({ tool, status: "skipped", detail: `写入失败：${e instanceof Error ? e.message : String(e)}` });
			continue;
		}
		results.push({ tool, status: isUpdate ? "updated" : "installed", detail: `已${isUpdate ? "更新" : "安装"}到 ${dest}` });
	}
	return results;
}

// —— 入口 ——

export default function (pi: ExtensionAPI) {
	if (process.platform !== "win32") {
		// 非 Windows：包不激活（Git Bash 政策仅对 Windows 有意义）
		return;
	}

	const pkgRootNorm = path.normalize(path.dirname(fileURLToPath(import.meta.url)) + path.sep + "..");

	let lastShellCheck: ShellCheck | undefined;
	let lastBins: InstallResult[] | undefined;

	// 1. 硬拦截
	pi.on("tool_call", async (event, _ctx) => {
		if (!isToolCallEventType("bash", event)) return undefined;
		const command = event.input?.command ?? "";
		const matches = command.match(WIN_SHELL_RE);
		if (matches && matches.length > 0) {
			const hit = [...new Set(matches.map((m) => m.toLowerCase()))].join(", ");
			return {
				block: true,
				reason: `已拦截 Windows 原生 shell 调用（${hit}）。${ADVICE}`,
			};
		}
		return undefined;
	});

	// 2. 软规则注入（system prompt 每轮重建，这里每轮追加一次，幂等）
	pi.on("before_agent_start", async (event, _ctx) => {
		return { systemPrompt: event.systemPrompt + SHELL_POLICY };
	});

	// 3+4. 启动检测 + bin 工具安装
	pi.on("session_start", async (_event, ctx) => {
		const globalDir = path.join(os.homedir(), ".pi", "agent");
		const cwd = (ctx as { cwd?: string }).cwd;
		lastShellCheck = checkShell(globalDir, typeof cwd === "string" ? cwd : undefined);
		lastBins = installBins(pkgRootNorm);

		if (ctx.hasUI) {
			try {
				if (lastShellCheck.level === "warn") {
					ctx.ui.notify(
						`⚠ pi-git-bash-only：${lastShellCheck.detail}。建议在 ~/.pi/agent/settings.json 设置 "shellPath": "C:/Program Files/Git/bin/bash.exe"`,
						"error",
					);
				}
				const bad = lastBins.filter((r) => r.status === "conflict" || r.status === "skipped");
				const fresh = lastBins.filter((r) => r.status === "installed" || r.status === "updated");
				if (bad.length > 0) {
					ctx.ui.notify(`⚠ pi-git-bash-only：${bad.map((r) => `${r.tool}（${r.detail}）`).join("、")} 未就绪`, "error");
				} else if (fresh.length > 0) {
					const pathHint = homeBinOnPath() ? "" : "（注意：~/bin 不在 PATH 中，请自行加入）";
					ctx.ui.notify(`pi-git-bash-only：${fresh.map((r) => r.tool).join("、")} ${pathHint}`.trim(), "info");
				}
			} catch {
				/* RPC/print 模式下 notify 可能不可用，忽略 */
			}
		}
	});

	// 状态查询命令
	pi.registerCommand("gitbash", {
		description: "显示 pi-git-bash-only 的 shell 检测与 bin 工具（wmicu/gbk）状态",
		handler: async (_args, ctx) => {
			const sc = lastShellCheck ? `${lastShellCheck.level === "ok" ? "✅" : "⚠"} ${lastShellCheck.detail}` : "（尚未检测，重启会话后生效）";
			const bins = lastBins
				? lastBins.map((r) => `${r.tool}: ${r.status}`).join("、")
				: "（尚未安装）";
			const onPath = homeBinOnPath() ? "✅ ~/bin 在 PATH" : "⚠ ~/bin 不在 PATH";
			ctx.ui.notify(
				`shell: ${sc}\nbin 工具: ${bins}\n${onPath}\n硬拦截: powershell/pwsh/cmd → block；软规则: 每轮注入 system prompt（含 MSYS 转换/GBK 转码铁律）`,
				"info",
			);
		},
	});
}
