<!-- purge:layer route.ir -->
## 应急响应开工单（route.ir）

### 1 现场保全先于一切

```bash
mkdir -p /evidence && cp -a /var/www "/evidence/www_$(date +%F_%H%M)"
ps auxf > /evidence/ps.txt; ss -antp > /evidence/net.txt
cp /var/log/nginx/access.log /evidence/ 2>/dev/null
```

先存证再清理。删完再想复盘，整条链就断了。

### 2 时间线（三条线对齐才算交叉证据）

```bash
find / -xdev -newermt '-6 hours' -type f -not -path '/proc/*' 2>/dev/null | head -50
last -20; journalctl --since '-6 hours' --no-pager | tail -100
```

**文件改动时间** + **登录时间** + **访问日志时间**：同一时间点出现两样以上才立得住，只有一条就是推断。

### 3 持久化点（逐项查，不抽样）

- `crontab -l`、`/etc/cron*`、`/var/spool/cron`、launchd（`/Library/Launch{Agents,Daemons}`）
- `~/.ssh/authorized_keys`、`/etc/sudoers.d`
- `systemctl list-unit-files --state=enabled`
- shell 启动文件：`.bashrc` `.zshrc` `.profile`

### 4 webshell / 后门查杀

```bash
grep -rEl 'eval\(|assert\(|base64_decode\(|system\(|passthru\(|shell_exec\(' /var/www --include='*.php'
find /var/www -type f -mmin -1440 -ls
find /var/www -type f \( -name '*.php5' -o -name '.*.php' -o -name '*.phtml' \) -ls
```

命中后顺序固定：`cp` 到 `/evidence` → 停掉进程与定时任务 → 删文件 → 从基线恢复。顺序颠倒就无法证明删了什么。

### 5 收敛与验证

加固动作必须有回滚路径，且**回放原始症状**确认消失——不是「看着改对了」。改完立刻 `curl` 验一次服务可用，别把服务修挂了。

<!-- /purge:layer -->
