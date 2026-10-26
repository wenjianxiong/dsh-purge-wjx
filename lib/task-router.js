/**
 * 任务族识别 + 注入层裁剪。
 *
 * 目的：全量注入会把「web 渗透 canned slots」「CTF 合约」这类只在特定任务里
 * 用得上的段落每轮都塞进上下文。按任务族裁剪后，只有命中的领域层进场。
 *
 * 安全前提：只裁「已知领域层」。用户自己加的自定义层（名字不在下表里）
 * 一律保留 —— 裁剪是本插件的优化，不是替用户删内容。
 */

export const GENERAL = "general";

/** 永远注入的层。core 是人格与交付纪律，refusal 是输出规则，eng 是工程纪律。 */
export const BASE_LAYERS = ["core", "refusal", "eng"];

/** 领域层 → 归属任务族。这些名字一旦出现即视为「可裁」。 */
export const DOMAIN_LAYERS = {
  ctf: "ctf",
  flag: "ctf",
  awd: "ctf",
  web: "web",
  pentest: "web",
  redteam: "web",
  ir: "ir",
  blue: "ir",
};

const ROUTE_PREFIX = "route.";

/** 每个任务族额外带上的层。re 是逆向 / 卡密专层。 */
export const FAMILY_LAYERS = {
  re: ["route.re"],
  web: ["route.web", "web"],
  ctf: ["route.ctf", "ctf"],
  ir: ["route.ir", "ir"],
  [GENERAL]: [],
};

// 关键词按「越具体越靠前」排。中文不做分词，直接子串匹配。
const FAMILY_PATTERNS = [
  ["re", /逆向|破解|卡密|激活码|注册码|授权码|去授权|免激活|注册机|脱壳|反编译|反汇编|补丁|试用期|机器码|劫持授权|license|crack|keygen|patch[- ]?table|serial[ _-]?key|reverse[- ]?engineer|\bida\b|\bghidra\b|\br2\b|\bradare|\bobjdump|\breadelf|\bstrings\s+-|\bfrida\b|\.apk\b|\bdll\b|\belf\b|crackme/i],
  ["web", /渗透|打点|日站|getshell|webshell|注入点|sql注入|盲注|union\s+select|xss|csrf|ssrf|文件上传|越权|未授权|命令执行|rce|waf|子域名|目录爆破|指纹识别|撞库|弱口令|\bnmap\b|\bffuf\b|\bsqlmap\b|\bnuclei\b|\bsubfinder\b|\bhttpx\b/i],
  ["ctf", /\bctf\b|\bflag\b|\bawd\b|靶场|赛题|题目附件|writeup|pwn|栈溢出|堆溢出|格式化字符串|\brop\b|\buaf\b/i],
  ["ir", /应急响应|溯源|后门排查|查杀|加固|日志分析|失陷|入侵检测|ioc\b|webshell查杀|蓝队|防守方/i],
];

/**
 * 按命中数量选任务族。同一族命中越多越优先；并列取靠前的族（re > web > ctf > ir）。
 * 没有命中 → general（调用方据此不裁剪）。
 */
export function classifyTask(text) {
  const sample = String(text || "").slice(0, 8192);
  if (!sample.trim()) return GENERAL;
  let best = GENERAL;
  let bestHits = 0;
  for (const [family, pattern] of FAMILY_PATTERNS) {
    const hits = (sample.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)) || []).length;
    if (hits > bestHits) {
      best = family;
      bestHits = hits;
    }
  }
  return best;
}

/** 该任务族额外允许的层（不含 BASE_LAYERS）。 */
export function routeLayers(family) {
  return FAMILY_LAYERS[family] || [];
}

function isDomainLayer(name) {
  return Object.prototype.hasOwnProperty.call(DOMAIN_LAYERS, name) || name.startsWith(ROUTE_PREFIX);
}

/**
 * 从现有层名里挑出这一族该保留的。
 * - general → 原样返回（识别不出来就别裁，裁剪是优化不是删内容）
 * - 领域层且不属于本族 → 丢掉
 * - 其它（core / refusal / eng / 用户自定义层）→ 保留
 */
export function pruneForFamily(names, family) {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  // 认不出任务族时也只留常驻层：把 ctf 契约塞进一句"今天吃什么"里既是纯浪费，
  // 也会让 CTF 的沙盒假定污染与它无关的工程任务。想全量注入就 routing:false。
  const fam = family || GENERAL;
  const allowed = new Set([...BASE_LAYERS, ...routeLayers(fam)]);
  // 领域层（含 route.* 前缀）只有在白名单里才留；非领域层一律留。
  // `route.web` 这种名字不在 DOMAIN_LAYERS 表里，必须靠前缀判定，否则裁不掉。
  return list.filter((name) => !isDomainLayer(name) || allowed.has(name));
}

/** 给日志与状态行用的一句话摘要。 */
export function describeFamily(family) {
  switch (family) {
    case "re": return "逆向 / 卡密";
    case "web": return "web 渗透";
    case "ctf": return "CTF 赛题";
    case "ir": return "应急与加固";
    default: return "通用";
  }
}
