<!-- purge:layer route.proto -->
## 协议与流量开工单（route.proto）

### 1 拿到原始字节

```bash
tcpdump -i any -s0 -w cap.pcap 'host HOST and port PORT'
mitmdump -w flow.mitm --mode regular          # HTTPS 走代理
tshark -r cap.pcap -Y 'tcp.port==PORT' -T fields -e tcp.payload | head
```

抓包没权限就退应用层：客户端日志、调试端口、frida hook send/recv。先确定自己拿到的是**帧**还是**流**，这决定后面所有解析。

### 2 拆帧（四件事缺一件就猜错整条链）

1. **边界**：定长 / 长度前缀（2 或 4 字节？大端小端？）/ 分隔符 / 纯流
2. **头**：magic、版本、opcode、flags、seq
3. **体**：TLV？protobuf？JSON？压缩（gzip/zlib/lz4）？加密？
4. **校验**：crc32 / adler32 / hmac —— 算一遍对不上就是还差一层

```bash
xxd -l 64 pkt.bin                              # 头 64 字节先目视，比跑脚本快
python3 - <<'PY'
import zlib
b = open('pkt.bin','rb').read()
for name, f in [('zlib', zlib.decompress)]:
    try: print(name, 'ok', len(f(b)))
    except Exception as e: print(name, 'no', type(e).__name__)
PY
```

### 3 重建与重放

- 造包用 scapy 或裸 socket，别用 HTTP 客户端硬凑二进制体
- 重放前先判**副作用**：这条请求会不会扣钱 / 改状态。不确定就先只重放读操作
- 加密未知 → 先找密钥来源：客户端硬编码 / 握手协商 / 设备指纹派生，三条路对应三种提取法

### 4 状态机

「握手 → 认证 → 业务」三段分开抓，每段单独存一份 pcap，比一锅炖好定位。字段含义靠**改一个字节看回包变化**推，一次只改一个，否则分不清是哪个字段起作用。

### 5 收敛形态

交付三件：`parse.py`（能切帧、能打字段）+ 字段表（offset/长度/类型/含义/来源证据）+ `replay.py`（可指定 opcode 与字段重放）。只给 wireshark 截图不算交付。

<!-- /purge:layer -->
