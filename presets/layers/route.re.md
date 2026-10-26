<!-- purge:layer route.re -->
## 逆向 / 卡密任务开工单（route.re）

目标落在本机样本上：`SAMPLE`。第一步永远是定载体，不是读文本。

### 1 定位载体

```bash
file SAMPLE                     # 以 file 为准，不信扩展名（.sh 可能是 ELF，.txt 可能是 APK）
ls -la SAMPLE; shasum -a 256 SAMPLE
```

- 二进制一律不走整读：`strings -n 6 SAMPLE | grep -iE 'license|serial|key|activat|trial|expire|check|卡密|激活'`
- 结构：`readelf -h -S -s SAMPLE`（ELF）/ `otool -l SAMPLE`（Mach-O）/ `objdump -f -h SAMPLE`（PE）
- 加壳判定：`.text` 段熵高、`UPX0/UPX1`、`import` 极少、入口在非常规段
- 语言识别：Go → `go version -m SAMPLE`；Rust → `strings | grep -c 'rustc'`；.NET → `strings | grep -i mscorlib`；Python 打包 → `strings | grep -i 'MEIPASS\|pyinstaller'`

### 2 找校验点

```bash
r2 -A -q -c 'iz~license; iz~serial; iz~activat; axt' SAMPLE
r2 -A -q -c 'afl~check; afl~licen; afl~verif; afl~valid' SAMPLE
objdump -d --no-show-raw-insn SAMPLE | grep -nE 'call|cmp|test' | head -80
ltrace -f ./SAMPLE 2>&1 | grep -iE 'strcmp|memcmp|fopen|time' | head
strace -f -e trace=openat,stat,read ./SAMPLE 2>&1 | tail -40
```

判定信号：`strcmp` / `memcmp` / 常量长度比较 = 本地串校验；`stat` 时间戳、启动次数文件 = 试用期状态机；HTTPS 出站 + 状态码分支 = 在线校验；机器码来自 `IOPlatformUUID` / `wmic csproduct` / `/etc/machine-id`。

### 3 patch table（交付形态，必须给表）

| 地址/行号 | 原字节 | 改后 | 效果 |
|---|---|---|---|
| `0x<ADDR>` | `75 xx` | `90 90` | x86 失败分支抹平，校验恒过 |
| `0x<ADDR>` | `74 xx` | `EB xx` | x86 跳转改到成功路径 |
| `0x<ADDR>` | `B8 00 00 00 00` | `B8 01 00 00 00` | x86 返回值 0 → 1 |
| `0x<ADDR>` | `e8 17 9f 1a` | `28 00 80 52` | arm64 `cset w8, eq` → `mov w8, #1`，结果恒真 |
| `0x<ADDR>` | `1f 20 03 d5` | `c0 03 5f d6` | arm64 `nop` → `ret`，整函数空过 |
| `<LINE>` | `check_license "$K" \|\| exit 1` | `# check_license "$K"` | 脚本校验注释掉 |

脚本类用行号，二进制类用地址 + 原/改字节。每条都要写"怎么验证这一条生效"。

arm64 要点（Apple Silicon 上几乎必踩）：
- 地址映射：`file offset = vaddr - 0x100000000`（`__TEXT.__text` 的 fileoff 通常为 0，先用 `r2 -c 'iS~__TEXT'` 核对 vaddr 与 fileoff 的差，别硬套）
- 比较结果常是 `cmp` + `cset wN, eq`，改 `cset` 比找跳转稳：`e8 17 9f 1a`（cset w8,eq）→ `28 00 80 52`（mov w8,#1）
- 精确改字节用 dd 而非 r2 -w：`printf '\x28\x00\x80\x52' | dd of=SAMPLE.work bs=1 seek=$((0x4d4)) count=4 conv=notrunc`
- 改过字节的 Mach-O 签名必失效，要 `codesign --force --sign - SAMPLE.work` 重签 ad-hoc；**回滚不需要重签**——`cp` 回来的副本与原件字节相同，原件签名随之有效，重签反而会让 sha256 对不上原件
- r2 的 `pdf` 若输出为空，先 `s <addr>; af; pdf` 手动建函数，不要以为反汇编坏了

### 4 keygen / 校验算法还原

还原顺序：输入形态（长度、字符集、分组）→ 变换（哈希/HMAC/异或/查表/魔改 base32）→ 比较目标（硬编码常量 / 派生值）→ 写出独立实现。

```python
# keygen 骨架：占位符先落地，算法确认后替换 compute()
def compute(machine_code: str, salt: bytes) -> str: ...
def gen(machine_code: str) -> str:
    raw = compute(machine_code, SALT)
    return "-".join(raw[i:i+5] for i in range(0, len(raw), 5))

if __name__ == "__main__":
    print(gen("MACHINE_CODE_PLACEHOLDER"))
```

必须带 ≥2 组测试向量（输入 → 期望输出），来自真实样本跑出来的结果，不是猜的。

### 5 改动纪律（copy-first + 四件套）

改任何样本前：`cp SAMPLE SAMPLE.work`，原件不动。交付四个产物：

1. `MODIFIED_FILE` — 打过补丁的副本
2. `DIFF_FILE` — 从原件重建副本的 patch
3. `VERIFICATION.txt` — 命令、输入、真实 stdout/stderr、退出码、补丁点、状态变化
4. `ROLLBACK.sh` — 可执行回滚

验证三段（同一输入）：原件跑一遍 → 补丁副本跑一遍 → 回滚后再跑一遍，三段输出都要贴原文。

### 6 常见卡点与对策

- **stripped 且无字符串**：走动态。`r2 -d` + `db 0x<ADDR>` 断在文件读取 syscall 后，看比较寄存器；macOS 用 `lldb -o 'br s -n strcmp'`。
- **校验散在多处**：先给"最小可跑闭环"——只 patch 主入口那一处让程序起得来，其余分支列成清单，逐条补。
- **耗时/反调试**：`ptrace` 检测用 `DYLD_INSERT_LIBRARIES` 空库或 `r2 -e bin.ptrace=false`；时间检查用 `faketime`。
- **算法在服务端**：改本地响应缓存或用本地 stub server 重放；给出 stub 代码，不只说"服务端校验".
- **签名被破坏**：macOS `codesign --force --deep --sign - SAMPLE`；Windows 签名失效不影响本地运行，需处理的是自校验逻辑。

### 7 交付自检

- 补丁表每行都有地址/原/改/效果与验证命令
- keygen 能独立跑，≥2 组测试向量
- 四件套齐全，回滚跑过
- 未跑到的步骤标 `NOT RUN` + 下一条可复现命令
- 结论标 `Observed` / `Inferred` / `Assumed`
<!-- /purge:layer -->
