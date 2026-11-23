<!-- purge:layer route.build -->
## 编译 / 构建开工单（route.build）

任务落在「把源码变成能跑的东西」时，第一步是定工具链，不是敲 make。

### 1 判载体与工具链

```bash
file SRC_OR_BIN                     # 以 file 为准，不信扩展名
uname -m; clang --version | head -1; go version 2>/dev/null
ls Makefile CMakeLists.txt meson.build Cargo.toml go.mod package.json 2>/dev/null
```

- `configure` 存在 → `./configure --prefix=/tmp/out && make -j$(sysctl -n hw.ncpu)`
- `CMakeLists.txt` → `cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug && cmake --build build -j`
- `Cargo.toml` → `cargo build --release`；`go.mod` → `go build -o out ./...`
- 都没有 → 直接 `clang SRC.c -o SRC`

### 2 flag 速查（按目的选，不堆）

| 目的 | flag |
|---|---|
| 带调试符号 | `-g -O0` |
| 复现崩溃 | `-g -O0 -fsanitize=address,undefined` |
| 静态单文件 | `-static` |
| 关保护（实验用） | `-fno-stack-protector -z execstack -no-pie` |
| 优化后复看 | `-O2 -fno-omit-frame-pointer` |

### 3 交叉编译

```bash
clang --target=aarch64-linux-gnu -c a.c          # 只编译
zig cc -target aarch64-linux-gnu a.c -o a.out     # 带 libc 的完整链接，首选
```

### 4 失败诊断（按报错形态分，不猜）

- `fatal error: 'X.h' file not found` → 缺头文件：`pkg-config --cflags X`，或 `-I` 指路
- `undefined reference to Y` → 缺库或链接顺序错：把 `-l` 放到源文件**之后**
- `cannot find -lZ` → 库不在搜索路径：`-L` 补路径
- `ld: warning: ignoring duplicate libraries` → 无害
- 版本不匹配（protobuf / openssl / qt）→ 先 `pkg-config --modversion` 核对，别靠猜

### 5 产物验证（四步，缺一步不算完成）

```bash
file OUT; ldd OUT | head; nm -D OUT | head; OUT --version 2>&1 | head -3
```

能跑就用同一输入再跑一次确认可复现。macOS 没有 ldconfig，装完库用 `otool -L OUT` 看依赖；改过字节的 Mach-O 签名必失效，需 `codesign --force --sign - OUT`。

<!-- /purge:layer -->
