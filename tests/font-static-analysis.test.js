'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectFontCharacters, subsetFonts } = require('../lib/font-subsetter');
const { validateFontRuntimeConfig } = require('../lib/font-runtime-config');

function scan(body, script = '', options = {}) {
  const risks = new Set();
  const result = collectFontCharacters({
    htmlContents: ['<main class="a">' + body + '</main>'],
    htmlPaths: ['sample.html'],
    cssFiles: [{ content: '.a{font-family:A}.b{font-family:B}' }],
    fontFamilies: new Set(['A', 'B']), scriptContents: [script], risks, ...options,
  });
  return { ...result, risks: [...risks] };
}
function chars(actual, expected) { assert.deepEqual(new Set(actual), new Set(expected)); }

for (const [name, body, script, expected] of [
  ['nested loops', '<div v-for="group in groups"><span v-for="item in group.items">{{item}}</span></div>', 'const groups=[{items:["充值","积分"]},{items:["奖励"]}];', '充值积分奖励'],
  ['loop shadowing', '<div v-for="item in groups"><b v-for="item in item.items">{{item}}</b><i>{{item.name}}</i></div>', 'const groups=[{name:"外层",items:["内层"]}];', '外层内层'],
  ['array and object lookup', '{{items[0].name}}{{dict["label"].name}}', 'const items=[{name:"首项"},{name:"不要"}];const dict={label:{name:"字典"}};', '首项字典'],
  ['known computed key', '{{dict[key]}}', 'const key="first";const dict={first:"正确",second:"不要"};', '正确'],
  ['array loop index', '<b v-for="(item,index) in items">{{index}}-{{item}}</b>', 'const items=["甲","乙"];', '01-甲乙'],
  ['object loop aliases', '<b v-for="(value,key,index) in items">{{key}}{{value}}{{index}}</b>', 'const items={甲:"一",乙:"二"};', '甲一0乙二1'],
  ['numeric loop', '<b v-for="n in 3">{{n}}</b>', '', '123'],
  ['full bindings', '<b v-bind:title="title" v-bind:aria-label="label"/>', 'const title="充值";const label="导航";', '充值导航'],
  ['numeric addition and multiplication', '{{count + 2}}/{{count * 2}}', 'const count=3;', '5/6'],
  ['unary and optional access', '{{-count}}/{{user?.name}}', 'const count=3;const user={name:"用户"};', '-3/用户'],
  ['null optional access', '{{user?.name}}', 'const user=null;', ''],
  ['simple function', '{{label("充值")}}', 'function label(value){const prefix="立即";return prefix+value;}', '立即充值'],
  ['arrow function', '{{label("充值")}}', 'const label=value=>"立即"+value;', '立即充值'],
  ['function local scope', '{{label()}}{{text}}', 'const text="外部";function label(){const text="内部";return text;}', '内部外部'],
  ['computed and methods', '{{label}}{{format("礼")}}', 'new Vue({data:{name:"充值"},computed:{label(){return this.name+"积分";}},methods:{format(value){return this.name+value;}}});', '充值积分礼'],
  ['simple function branches', '{{label()}}', 'function label(){if(remoteFlag)return "售罄";return "有货";}', '售罄有货'],
  ['top level assignment', '{{label}}', 'let label="初始";label="更新";', '更新'],
  ['block scoping', '{{label}}', 'const label="外部";{const label="内部";}', '外部'],
  ['snapshot initializer', '{{copy}}{{label}}', 'let label="初始";const copy=label;label="更新";', '初始更新'],
  ['Vue quoted data keys', '{{label}}', 'new Vue({data:{"label":"文案"}});', '文案'],
  ['data factory local variables', '{{label}}', 'new Vue({data(){const label="局部";return {label};}});', '局部'],
]) {
  test('static analysis: ' + name, () => { chars(scan(body, script).A, expected); });
}

test('unknown computed keys expand candidates and report risk', () => {
  const result = scan('{{dict[key]}}', 'const dict={a:"甲",b:"乙"};');
  chars(result.A, '甲乙'); assert.ok(result.risks.length);
});

test('v-html parses child font classes and inline font styles', () => {
  const result = scan('<div v-html="markup"></div>', 'const markup=\'甲<span class="b">乙</span><i style="font-family:B">丙</i>丁\';');
  chars(result.A, '甲丁'); chars(result.B, '乙丙');
});

test('v-html is rendered markup, not a second Vue template', () => {
  const result = scan('<div v-html="markup"></div>', 'const markup="{{secret}}";const secret="不应执行";');
  chars(result.A, '{{secret}}');
});

for (const [label, markup, script] of [
  ['object class', '<b :class="{b:active}">文字</b>', 'const active=true;'],
  ['array class', '<b v-bind:class="[name]">文字</b>', 'const name="b";'],
  ['object style', '<b :style="{fontFamily:family}">文字</b>', 'const family="B";'],
  ['string style', '<b v-bind:style="style">文字</b>', 'const style="font-family:B";'],
]) {
  test('dynamic font: ' + label, () => { const r=scan(markup,script);chars(r.B,'文字');chars(r.A,''); });
}

test('dynamic class branches retain their descendant selector context', () => {
  const r=scan('<section :class="flag ? \'left\' : \'right\'"><b>文字</b></section>', '', {
    cssFiles:[{content:'.left b{font-family:A}.right b{font-family:B}'}],
  });
  chars(r.A,'文字');chars(r.B,'文字');
});

for (const [label, markup, script] of [
  ['Vue filter', '{{label | format}}', 'const label="充值";'],
  ['unknown function', '{{label()}}', ''],
  ['dynamic attribute name', '<b v-bind:[name]="label"></b>', 'const name="title";const label="充值";'],
  ['unknown class', '<b :class="remoteClass">文字</b>', ''],
  ['unknown style', '<b :style="remoteStyle">文字</b>', ''],
  ['async mutation', '{{label}}', 'let label="初始";setTimeout(()=>{label="更新";},0);'],
  ['Vue lifecycle mutation', '{{label}}', 'new Vue({data:{label:"初始"},mounted(){this.label="更新";}});'],
  ['unsupported function effects', '{{label()}}', 'function label(){fetch("/api");return "文字";}'],
]) {
  test('reports contextual risk: ' + label, () => {
    const r=scan(markup,script);
    assert.ok(r.risks.length, label);
    assert.match(r.risks.join('\n'), /sample\.html/);
    assert.match(r.risks.join('\n'), /字体/);
  });
}

test('known empty text is not a risk', () => {
  const r=scan('{{label}}','const label="";'); chars(r.A,'');assert.deepEqual(r.risks,[]);
});

test('candidate truncation is reported', () => {
  const items=Array.from({length:110},(_,n)=>String(n));
  const r=scan('<b v-for="x in items">{{`标签${x}`}}</b>','const items='+JSON.stringify(items)+';');
  assert.ok(r.risks.length); assert.match(r.risks.join(''),/上限|截断/);
});

test('inline script scopes are isolated across pages', () => {
  const r=scan('', '', {htmlContents:[
    '<b class="a">{{label}}</b><script>const label="甲";</script>',
    '<b class="b">{{label}}</b><script>const label="乙";</script>',
  ]});
  chars(r.A,'甲');chars(r.B,'乙');
});

function fixture(t, files) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mikit-static-analysis-'));
  t.after(()=>{
    const resolved=path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  const base={
    'dist/font/a.ttf':'source-a','dist/font/b.ttf':'source-b',
    'wwwroot/font/a.ttf':'source-a','wwwroot/font/b.ttf':'source-b',
    'dist/base.css':'@font-face{font-family:A;src:url(font/a.ttf)}@font-face{font-family:B;src:url(font/b.ttf)}.a{font-family:A}.b{font-family:B}',
    ...files,
  };
  for(const [file,content] of Object.entries(base)){
    const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);
  }
  return root;
}
function subset(root, config) {
  return subsetFonts({projectDir:root,runtimeConfig:validateFontRuntimeConfig(config||{}),commandRunner(_command,args){
    fs.writeFileSync(args.find(a=>a.startsWith('--output-file=')).slice(14),'subset');return {status:0};
  }});
}
function manifest(root,name){return fs.readFileSync(path.join(root,'font',name+'.txt'),'utf8');}

test('isolates linked scripts and CSS for each page', t=>{
  const root=fixture(t,{
    'dist/one.html':'<link rel="stylesheet" href="one.css"><b class="text">{{label}}</b><script src="one.js"></script>',
    'dist/two.html':'<link rel="stylesheet" href="two.css"><b class="text">{{label}}</b><script src="two.js"></script>',
    'dist/one.css':'@import "base.css";.text{font-family:A}',
    'dist/two.css':'@import "base.css";.text{font-family:B}',
    'dist/one.js':'const label="甲";','dist/two.js':'const label="乙";',
  });
  subset(root);chars(manifest(root,'a'),'甲');chars(manifest(root,'b'),'乙');
});

for(const kind of ['esm','cjs']){
  test('resolves local '+kind+' modules without executing them',t=>{
    const root=fixture(t,{
      'dist/index.html':'<link rel="stylesheet" href="base.css"><b class="a">{{label}}</b><script '+(kind==='esm'?'type="module" ':'')+'src="main.js"></script>',
      'dist/main.js':kind==='esm'?'import {label} from "./labels.js";':'const {label}=require("./labels.js");',
      'dist/labels.js':kind==='esm'?'export const label="模块文案";':'module.exports={label:"模块文案"};',
    });
    const result=subset(root);chars(manifest(root,'a'),'模块文案');assert.deepEqual(result.risks,[]);
  });
}

test('module internals cannot overwrite page globals',t=>{
  const root=fixture(t,{
    'dist/index.html':'<b class="a">{{label}}{{other}}</b><script src="main.js"></script>',
    'dist/main.js':'const label="页面";const {other}=require("./labels.js");',
    'dist/labels.js':'const label="隐藏";module.exports={other:"导出"};',
  });
  subset(root);chars(manifest(root,'a'),'页面导出');
});

for(const [label,script,extra] of [
  ['missing','import {label} from "./missing.js";',{}],
  ['outside','import {label} from "../outside.js";',{'outside.js':'export const label="越界";'}],
  ['cycle','import {label} from "./cycle.js";',{'dist/cycle.js':'export {label} from "./main.js";'}],
  ['bare package','import {label} from "some-package";',{}],
]){
  test('strict mode prevents publication on '+label+' module risk',t=>{
    const root=fixture(t,{'dist/index.html':'<b class="a">{{label}}</b><script src="main.js"></script>', 'dist/main.js':script,...extra});
    assert.throws(()=>subset(root,{dynamicTextPolicy:'error'}),/动态展示文字/);
    assert.equal(fs.readFileSync(path.join(root,'dist/font/a.ttf'),'utf8'),'source-a');
    assert.equal(fs.existsSync(path.join(root,'font')),false);
  });
}

for (const [name, body, script, expected] of [
  ['optional chain continuation', '{{user?.profile.name ?? "访客"}}', 'const user=null;', '访客'],
  ['known missing optional field', '{{user?.name ?? "访客"}}', 'const user={};', '访客'],
  ['function block scope', '{{label()}}', 'function label(){const value="外";if(true){const value="内";}return value;}', '外'],
  ['unknown sibling in data factory', '{{label}}', 'new Vue({data(){return {label:"已知",other:remoteValue};}});', '已知'],
  ['basic pure string operations', '{{format(label)}}', 'const label=" a ";function format(value){return value.trim().toUpperCase()+String(2+3);}', 'A5'],
  ['bounded array mapping', '{{items.map(item=>item.name).join("、")}}', 'const items=[{name:"甲"},{name:"乙"}];', '甲、乙'],
  ['synchronous block assignment', '{{label}}', 'let label="旧";{label="新";}', '新'],
]) {
  test('additional static analysis: ' + name, () => { chars(scan(body, script).A, expected); });
}

for (const [name, script] of [
  ['callback array mutation', 'const items=["旧"];setTimeout(()=>items.push("新"),0);const label=items[0];'],
  ['called function mutation', 'let label="旧";function update(){label="新";}update();'],
  ['recursive function', 'function label(){return label();}'],
]) {
  test('additional uncertainty: ' + name, () => {
    const r=scan(name==='recursive function'?'{{label()}}':'{{label}}',script);
    assert.ok(r.risks.length,name);
  });
}

test('style arrays respect the last property assignment', () => {
  const r=scan('<b :style="[{fontFamily:\'A\'},{fontFamily:\'B\'}]">文字</b>');
  chars(r.B,'文字');chars(r.A,'');
});

test('v-text displays literal markup and replaces original children', () => {
  const r=scan('<b v-text="markup">不要</b>','const markup="<i>&amp;</i>";');
  chars(r.A,'<i>&amp;</i>');
});

test('literal require cycles report a dependency risk without executing modules',t=>{
  const root=fixture(t,{
    'dist/index.html':'<b class="a">{{label}}</b><script src="main.js"></script>',
    'dist/main.js':'const {label}=require("./a.js");',
    'dist/a.js':'const {label}=require("./b.js");module.exports={label};',
    'dist/b.js':'const {label}=require("./a.js");module.exports={label};',
  });
  assert.throws(()=>subset(root,{dynamicTextPolicy:'error'}),/动态展示文字/);
  assert.equal(fs.readFileSync(path.join(root,'dist/font/a.ttf'),'utf8'),'source-a');
});

test('local module analysis never executes effects',t=>{
  const marker=path.join(os.tmpdir(),'mikit-must-not-execute-'+Date.now());
  const root=fixture(t,{
    'dist/index.html':'<b class="a">{{label}}</b><script src="main.js"></script>',
    'dist/main.js':'const {label}=require("./labels.js");',
    'dist/labels.js':'require("node:fs").writeFileSync('+JSON.stringify(marker)+',"unsafe");module.exports={label:"安全"};',
  });
  subset(root);assert.equal(fs.existsSync(marker),false);chars(manifest(root,'a'),'安全');
});

for (const [name, code, main] of [
  ['default function','export default function(value){return value+"函数";}','import format from "./labels.js";const label=format("默认");'],
  ['named function','export function format(value){return value+"函数";}','import {format} from "./labels.js";const label=format("命名");'],
  ['namespace','export const label="命名空间";','import * as labels from "./labels.js";const label=labels.label;'],
  ['CJS member export','module.exports.label="成员导出";','const {label}=require("./labels.js");'],
  ['CJS named export','exports.label="成员导出";','const {label}=require("./labels.js");'],
  ['CJS default import','module.exports={label:"默认导入"};','import labels from "./labels.js";const label=labels.label;'],
]) {
  test('module export: '+name,t=>{
    const root=fixture(t,{'dist/index.html':'<b class="a">{{label}}</b><script src="main.js"></script>',
      'dist/main.js':main,'dist/labels.js':code});
    const result=subset(root);assert.ok(manifest(root,'a').length);assert.deepEqual(result.risks,[]);
  });
}

test('unknown object class flag expands both font possibilities with a risk',()=>{
  const r=scan('<b :class="{b:active}">文字</b>');
  chars(r.A,'文字');chars(r.B,'文字');assert.ok(r.risks.length);
});

test('strict mode rejects a symlink dependency outside output without publishing',t=>{
  const root=fixture(t,{'dist/index.html':'<b class="a">{{label}}</b><script src="main.js"></script>',
    'dist/main.js':'import {label} from "./escape/labels.js";','outside/labels.js':'export const label="越界";'});
  fs.symlinkSync(path.join(root,'outside'),path.join(root,'dist/escape'),'junction');
  assert.throws(()=>subset(root,{dynamicTextPolicy:'error'}),/动态展示文字/);
  assert.equal(fs.readFileSync(path.join(root,'dist/font/a.ttf'),'utf8'),'source-a');
  assert.equal(fs.existsSync(path.join(root,'font')),false);
});

test('parenthesized expressions remain valid and known-empty stays risk-free',()=>{
  const r=scan('{{(label)}}/{{(1+2)}}/{{user?.missing}}','const label="括号";const user={};');
  chars(r.A,'括号/3');assert.deepEqual(r.risks,[]);
});

test('candidate and recursion limits cannot publish in strict mode',t=>{
  const root=fixture(t,{'dist/index.html':'<b class="a">{{label()}}</b><script>function label(){return label();}</script>'});
  assert.throws(()=>subset(root,{dynamicTextPolicy:'error'}),/动态展示文字/);
  assert.equal(fs.readFileSync(path.join(root,'dist/font/a.ttf'),'utf8'),'source-a');
  assert.equal(fs.existsSync(path.join(root,'font')),false);
});

test('CSS url imports and inline cascade remain scoped to their page',t=>{
  const root=fixture(t,{
    'dist/index.html':'<link rel="stylesheet" href="site.css"><style>.text{font-family:B}</style><b class="text">乙</b>',
    'dist/site.css':'@import url(base.css);.text{font-family:A}',
    'dist/other.html':'<link rel="stylesheet" href="site.css"><b class="text">甲</b>',
  });
  subset(root);chars(manifest(root,'a'),'甲');chars(manifest(root,'b'),'乙');
});

test('complete documents do not inherit unrelated unlinked stylesheets',t=>{
  const root=fixture(t,{'dist/index.html':'<!doctype html><html><body><b class="a">未引用</b></body></html>'});
  const result=subset(root);assert.equal(result.processed.length,0);
  assert.equal(fs.existsSync(path.join(root,'font/a.txt')),false);
});

test('dynamic CSS variables warn instead of silently guessing a font',()=>{
  const r=scan('<b :style="style">文字</b>','const style="font-family:var(--remote-font)";');
  assert.ok(r.risks.length);
});

test('Vue method parameters do not shadow this data properties',()=>{
  const r=scan('{{format("参数")}}','new Vue({data:{name:"数据"},methods:{format(name){return this.name+name;}}});');
  chars(r.A,'数据参数');assert.deepEqual(r.risks,[]);
});

test('hoisted mutating calls cannot leave a stale initializer unnoticed',()=>{
  const r=scan('{{copy}}','function update(){label="新";}let label="旧";update();const copy=label;');
  assert.ok(r.risks.length);
});

test('destructured block locals do not leak into the page',()=>{
  const r=scan('{{label}}','const label="外";{const {label}={label:"内"};}');
  chars(r.A,'外');assert.deepEqual(r.risks,[]);
});

for (const [name,script] of [
  ['named factory','function data(){return {label:"文案"};}new Vue({data});'],
  ['referenced object','const data={label:"文案"};new Vue({data});'],
]) {
  test('Vue data supports '+name,()=>{
    const r=scan('{{label}}',script);chars(r.A,'文案');assert.deepEqual(r.risks,[]);
  });
}

test('repeated linked styles keep document cascade order',t=>{
  const root=fixture(t,{'dist/index.html':'<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css"><link rel="stylesheet" href="a.css"><b class="text">甲</b>',
    'dist/a.css':'@import "base.css";.text{font-family:A}','dist/b.css':'.text{font-family:B}'});
  subset(root);chars(manifest(root,'a'),'甲');assert.equal(fs.existsSync(path.join(root,'font/b.txt')),false);
});

test('inline style imports use the page as dependency base',t=>{
  const root=fixture(t,{'dist/index.html':'<style>@import "base.css";</style><b class="a">甲</b>'});
  subset(root);chars(manifest(root,'a'),'甲');
});

test('CLI strict-mode diagnostics identify page expression and font without a stack',t=>{
  const root=fixture(t,{'dist/index.html':'<link rel="stylesheet" href="base.css"><b class="a">{{remoteLabel}}</b>',
    'package.json':JSON.stringify({mikit:{font:{dynamicTextPolicy:'error'}}})});
  const {spawnSync}=require('node:child_process');
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../bin/mikit.js'),'font'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/\[mikit font\]/);
  assert.match(result.stderr,/index\.html/);assert.match(result.stderr,/remoteLabel/);assert.match(result.stderr,/字体 A/);
  assert.doesNotMatch(result.stderr,/\n\s+at /);
  assert.equal(fs.readFileSync(path.join(root,'dist/font/a.ttf'),'utf8'),'source-a');
  assert.equal(fs.existsSync(path.join(root,'font')),false);
});
