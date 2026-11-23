<!-- purge:layer route.unpack -->
## 解包与脱壳开工单（route.unpack）

### 1 判壳（先定量，再动手）

```bash
file SAMPLE
strings -n 8 SAMPLE | grep -m5 -iE 'UPX!|ASPack|Themida|VMProtect|Enigma|Obsidium'
readelf -SW SAMPLE | head -20            # 看节名与大小
```

判定信号：节名 `UPX0/UPX1`、`.text` 熵接近 8、导入表只剩个位数、入口落在非常规节。

### 2 常见容器的直接解法

- **UPX**：`upx -d SAMPLE -o SAMPLE.unpacked`；标记被改过的，按字节还原 `UPX!` 魔数再试
- **Electron**：`npx asar extract app.asar out/`；有 `app.asar.unpacked/` 就一起看
- **APK**：`unzip -o a.apk -d a/`；反编译 `jadx -d out a.apk`；资源 `apktool d a.apk`
- **IPA**：`unzip -o a.ipa -d a/`，二进制在 `Payload/*.app/`
- **固件**：`binwalk -eM fw.bin`，或 `unblob fw.bin -o out/`；squashfs 用 `unsquashfs`，JFFS2 用 `jefferson`，UBI 用 `ubireader`

### 3 通用脱壳（OEP + dump）

1. **找 OEP**：对 `.text` 下内存写断点，或对 `VirtualProtect`/`mprotect` 下断。ESP 定律：壳解压完最后一次 `popad` 后跳的地址就是 OEP。
2. **dump**：`gdb -p PID -ex 'dump memory dump.bin 0xBASE 0xEND'`；或按 `/proc/PID/maps` 逐段读。
3. **修 IAT**：dump 回灌 r2/IDA 比对导入表，缺的用 Scylla 重建。
4. **验证**：`file dump.bin` 认 PE/ELF、`r2 -A dump.bin -c 'afl~main'` 出正常函数名。验不出函数名就是还没脱干净。

### 4 反调试对抗（遇到再上，不预演）

- `ptrace(PTRACE_TRACEME,0,0,0)` → hook 成返回 0
- `sysctl` / `IsDebuggerPresent` / 时间差检测 → frida 直接改返回值
- 完整性校验失败 → 先分清是**文件 hash** 还是**内存 hash**：前者 patch 校验点，后者 patch 结果

### 5 交付形态

解出的东西分两层放：`orig/` 原件不动，`work/` 放派生物，每层标 sha256 与来源。脱壳产物不是「差不多能看」，得能跑、或能被静态工具重新分析出完整函数表。

<!-- /purge:layer -->
