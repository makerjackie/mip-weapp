import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '../..')
const source = fs.readFileSync(path.join(root, 'admin-web/ACCEPTANCE.md'), 'utf8')
const requirements = fs.readFileSync(path.join(root, 'docs/mip/REQUIREMENTS.md'), 'utf8')
const cases = [], waits = new Map()
for (const row of requirements.split('\n')) {
  const fields = row.split('|').map(value => value.trim())
  if (!/^Q-ADMIN-\d{2}$/.test(fields[1] || '')) continue
  const ranges = fields[4].replace(/([A-Z])(\d{2})[–-](?:\1)?(\d{2})/g, (_all, prefix, start, end) => Array.from({ length: Number(end) - Number(start) + 1 }, (_, index) => `${prefix}${String(Number(start) + index).padStart(2, '0')}`).join('、'))
  for (const id of ranges.match(/[A-Z]\d{2}/g) || []) waits.set(id, [...(waits.get(id) || []), fields[1]])
}
let group = ''
for (const row of source.split('\n')) {
  if (row.startsWith('### ')) group = row.slice(4)
  const match = row.match(/^\| ([AUEOFTRCMBDX]\d{2}) \/ ([^|]+) \| ([^|]+) \|$/)
  if (match && !['G', 'K'].includes(match[1][0])) cases.push({ id: match[1], group, origin: match[2].trim(), text: match[3].trim(), waits: waits.get(match[1]) || [] })
}
if (cases.length !== 53 || new Set(cases.map(item => item.id)).size !== 53) throw new Error('Expected exactly the 53 unique product scenarios from ACCEPTANCE.md')
const hash = createHash('sha256').update(source).digest('hex')
const output = path.join(root, 'docs/mip/evidence/admin-execution-20260929/review.html')
const data = JSON.stringify({ hash, cases }).replaceAll('<', '\\u003c')
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MIP 后台逐项验收</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f6fb;color:#202a3c;font:16px/1.7 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:24px}header,.item{background:white;border:1px solid #dbe2ee;border-radius:12px;padding:20px;margin-bottom:16px}h1{margin:0;font-size:26px}h2{font-size:19px;margin:28px 0 12px}p{margin:8px 0}small,.meta{color:#5b677b}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:16px 0}button,select,input,textarea{font:inherit}button,select,input[type=search]{padding:8px 12px;border:1px solid #b6c4dd;border-radius:6px;background:white;color:#183862}button{cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #5079eb;outline-offset:3px}label.check{display:flex;gap:12px;align-items:flex-start;font-weight:650}input[type=checkbox]{width:21px;height:21px;margin-top:5px;flex-shrink:0}textarea{width:100%;min-height:76px;resize:vertical;border:1px solid #b6c4dd;border-radius:6px;padding:10px;margin-top:8px}.wait{color:#8b4900;background:#fff5de;border-radius:6px;padding:8px 12px}.done{border-left:5px solid #218465}.id{font-variant-numeric:tabular-nums;color:#194fa7}.criterion{white-space:pre-wrap}.meta{font-size:13px}.status{font-weight:600}details{margin-top:10px}@media(max-width:500px){main{padding:12px}header,.item{padding:14px}h1{font-size:23px}.toolbar>*{max-width:100%}}
</style><main><header><h1>MIP 管理后台 · 逐项验收</h1><p>标准只有一份：<a href="../../../../admin-web/ACCEPTANCE.md">admin-web/ACCEPTANCE.md</a>。本页自动提取其中 53 条产品场景，不另定义规则。</p><p>每条按“查找 → 查看 → 编辑 → 保存 → 刷新回读”体验；取消、失败、冲突、越权也要检查。满足该条全部行为及 G01–G08 后再勾选。支付、扫码、视频号另需真机。</p><p class="meta">反馈保存在本浏览器，可导出 JSON。勾选是你的验收记录，不代表工程自动测试或生产已通过。待业务确认项不能勾选为整体通过。</p><div class="toolbar"><input type="search" id="search" aria-label="搜索场景" placeholder="编号、模块或关键词"><select id="filter" aria-label="筛选验收状态"><option value="all">全部场景</option><option value="todo">待验收</option><option value="done">已勾选</option><option value="feedback">有反馈</option></select><button id="export">导出勾选与反馈</button></div><p class="status" id="stats" aria-live="polite"></p><details><summary>建议体验顺序</summary><p>活动 E01–E09 → 机会 O01–O04 → 用户 U01–U09 → 任务 T01–T05 / 成长 R01–R05 → 权限 A01–A05 / 订单 F01–F03 → 素材 C01–C03 / 消息 M01–M02 → 团队 B01–B02 / 统计 D01–D03 → 扩展 X01–X03。</p><p>反馈请记录：场景编号、页面/对象名称、操作步骤、预期、实际、是否每次出现。不要附密码、完整手机号、Cookie 或 OpenID。</p></details></header><section id="items"></section><p class="meta">标准指纹：${hash}</p></main>
<script type="application/json" id="data">${data}</script><script>
const data=JSON.parse(document.getElementById('data').textContent),key='mip-admin-acceptance-'+data.hash;
let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')}catch{}
const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function persist(){localStorage.setItem(key,JSON.stringify(saved));stats()}
function stats(){const count=data.cases.filter(item=>saved[item.id]?.done&&!item.waits.length).length;document.getElementById('stats').textContent='已勾选 '+count+' / 53 · 待业务确认 '+data.cases.filter(item=>item.waits.length).length+' 条'}
function render(){const q=document.getElementById('search').value.toLowerCase(),filter=document.getElementById('filter').value;let group='';document.getElementById('items').innerHTML=data.cases.filter(item=>{const value=saved[item.id]||{};return (item.id+item.group+item.text).toLowerCase().includes(q)&&(filter==='all'||filter==='todo'&&!value.done||filter==='done'&&value.done&&!item.waits.length||filter==='feedback'&&value.feedback)}).map(item=>{const value=saved[item.id]||{},heading=group!==item.group?'<h2>'+escape(item.group)+'</h2>':'';group=item.group;return heading+'<article class="item '+(value.done&&!item.waits.length?'done':'')+'" data-id="'+item.id+'"><label class="check"><input type="checkbox" aria-label="'+item.id+' 验收通过" '+(value.done&&!item.waits.length?'checked ':'')+(item.waits.length?'disabled ':'')+'><span><span class="id">'+item.id+'</span> · 验收通过</span></label><p class="criterion">'+escape(item.text)+'</p><p class="meta">来源：'+escape(item.origin)+'</p>'+(item.waits.length?'<p class="wait">待确认：'+escape(item.waits.join('、'))+'。可先体验并记录反馈；决定收口后重新生成本页。</p>':'')+'<label>体验反馈<textarea aria-label="'+item.id+' 反馈" placeholder="步骤、预期、实际结果">'+escape(value.feedback||'')+'</textarea></label></article>'}).join('');stats()}
document.getElementById('items').addEventListener('change',event=>{const item=event.target.closest('article');if(!item)return;const value=saved[item.dataset.id]||{};saved[item.dataset.id]={...value,...(event.target.type==='checkbox'?{done:event.target.checked}:{feedback:event.target.value}),updatedAt:new Date().toISOString()};persist();item.classList.toggle('done',!!saved[item.dataset.id].done)});
document.getElementById('items').addEventListener('input',event=>{if(event.target.tagName!=='TEXTAREA')return;const item=event.target.closest('article');saved[item.dataset.id]={...saved[item.dataset.id],feedback:event.target.value,updatedAt:new Date().toISOString()};persist()});
document.getElementById('search').addEventListener('input',render);document.getElementById('filter').addEventListener('change',render);
document.getElementById('export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({standard:'admin-web/ACCEPTANCE.md',standardSha256:data.hash,exportedAt:new Date().toISOString(),cases:data.cases.map(item=>({id:item.id,waits:item.waits,...saved[item.id]}))},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mip-admin-acceptance-feedback.json';a.click();URL.revokeObjectURL(a.href)});render();
</script></html>`
fs.writeFileSync(output, html)
console.log(JSON.stringify({ output: path.relative(root, output), scenarios: cases.length, standardSha256: hash }))
