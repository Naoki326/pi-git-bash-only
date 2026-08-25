/**
 * test.ts — pi-git-bash-only 单元测试
 * 运行：node --experimental-strip-types test.ts
 * （.test-stub/ 提供 @earendil-works/pi-coding-agent 桩；NODE_PATH 指向它）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installBins, checkShell, homeBinOnPath } from "./extensions/index.ts";

const pkgRoot = path.resolve(import.meta.dirname, ".");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pkgtest-"));
const fakeHome = path.join(tmp, "home");
fs.mkdirSync(fakeHome, { recursive: true });

let failed = 0;
const ok = (name: string, cond: boolean) => {
	console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}`);
	if (!cond) failed++;
};

console.log("installBins (wmicu + gbk):");
const dest = (tool: string) => path.join(fakeHome, "bin", tool);
const pkgCopy = (tool: string) => fs.readFileSync(path.join(pkgRoot, "bin", tool), "utf8");
for (const tool of ["wmicu", "gbk"]) {
	if (fs.existsSync(dest(tool))) fs.rmSync(dest(tool));	// 每工具独立从干净状态开始（installBins 是批量安装）
	let r0 = installBins(pkgRoot, fakeHome).find((x) => x.tool === tool)!;
	ok(`${tool} fresh install`, r0.status === "installed" && fs.readFileSync(dest(tool), "utf8").includes("pi-git-bash-only: managed"));
	ok(`${tool} kept when identical`, installBins(pkgRoot, fakeHome).find((x) => x.tool === tool)!.status === "kept");
	fs.writeFileSync(dest(tool), pkgCopy(tool).replace('wmic "$@"', "# old\nwmic \"$@\""));
	let r1 = installBins(pkgRoot, fakeHome).find((x) => x.tool === tool)!;
	ok(`${tool} update managed old version`, r1.status !== "conflict" && fs.readFileSync(dest(tool), "utf8") === pkgCopy(tool));
	fs.writeFileSync(dest(tool), "#!/bin/bash\n# my own tool\nexit 1\n");
	let r2 = installBins(pkgRoot, fakeHome).find((x) => x.tool === tool)!;
	ok(`${tool} user file conflict untouched`, r2.status === "conflict" && fs.readFileSync(dest(tool), "utf8").includes("my own tool"));
}

console.log("checkShell:");
const gdir = path.join(tmp, "agent");
fs.mkdirSync(gdir, { recursive: true });
const set = (v: unknown) => fs.writeFileSync(path.join(gdir, "settings.json"), JSON.stringify(v ?? {}));
set({ shellPath: "C:/Program Files/Git/bin/bash.exe" });
ok("Git shellPath → ok+fixed", checkShell(gdir).level === "ok" && checkShell(gdir).fixed === true);
set({ shellPath: "C:/cygwin64/bin/bash.exe" });
ok("Cygwin shellPath → warn", checkShell(gdir).level === "warn");
set({ shellPath: "C:\\Program Files\\Git\\bin\\bash.exe" });
ok("backslash Git shellPath → ok", checkShell(gdir).level === "ok");
set({});
ok("no shellPath + default exists → ok unfixed", checkShell(gdir).level === "ok" && checkShell(gdir).fixed === false);
set({ shellPath: "C:/Program Files/Git/bin/bash.exe" });
const proj = path.join(tmp, "proj");
fs.mkdirSync(path.join(proj, ".pi"), { recursive: true });
fs.writeFileSync(path.join(proj, ".pi", "settings.json"), JSON.stringify({ shellPath: "C:/cygwin64/bin/bash.exe" }));
ok("project overrides global → warn", checkShell(gdir, proj).level === "warn");

console.log("homeBinOnPath:");
const withBin = { ...process.env, PATH: `${fakeHome}\\bin;${process.env.PATH}` };
const savedPath = process.env.PATH;
process.env.PATH = withBin.PATH;
ok("detects home/bin on Windows PATH", homeBinOnPath(fakeHome) === true);
process.env.PATH = savedPath;
ok("absent home/bin → false", homeBinOnPath(path.join(tmp, "elsewhere")) === false);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
