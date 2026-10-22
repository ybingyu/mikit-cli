'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { collectFontCharacters } = require('../lib/font-subsetter');

function scan(body, scripts) {
  const risks = new Set();
  const result = collectFontCharacters({
    htmlContents: ['<main class="a">' + body + '</main>'],
    cssFiles: [{ content: '.a{font-family:A}.b{font-family:B}' }],
    fontFamilies: new Set(['A', 'B']), scriptContents: scripts, risks,
  });
  return { ...result, risks: [...risks] };
}
function chars(actual, expected) { assert.deepEqual(new Set(actual), new Set(expected)); }

test('Vue mixins: separate source scripts, object v-for and v-html preserve font attribution', () => {
  const result = scan('<b v-for="(item,key) in pet"><i v-html="item.name"></i>{{key}}分</b>', [
    'const dataMixin={data:{pet:{3000:{name:"云裳<br>玄镜仙"},1500:{name:"<span class=\\"b\\">水镜麟</span>"}},unused:"废弃"}};',
    'new Vue({mixins:[dataMixin],data:{local:"未显示"}});',
  ]);
  chars(result.A, '云裳玄镜仙30001500分'); chars(result.B, '水镜麟');
  assert.deepEqual(result.risks, []);
});

for (const [name, script, expected] of [
  ['inline mixin only', 'new Vue({mixins:[{data:{label:"内联"}}]});', '内联'],
  ['nested mixins and factory', 'const base={data(){return {label:"初始",other:remote};}};const child={mixins:[base],data(){return {label:"嵌套"};}};new Vue({mixins:[child]});', '嵌套'],
  ['later mixin wins', 'const a={data:{label:"旧"}},b={data:{label:"新"}};new Vue({mixins:[a,b]});', '新'],
  ['component wins', 'const mixin={data:{label:"旧"}};new Vue({mixins:[mixin],data:{label:"页面"}});', '页面'],
  ['computed uses final component data', 'const mixin={data:{name:"旧"},computed:{label(){return this.name+"名";}}};new Vue({mixins:[mixin],data:{name:"新"}});', '新名'],
  ['method uses lexical scope and instance', 'const prefix="前";const mixin={methods:{format(){return prefix+this.name;}}};new Vue({mixins:[mixin],data:{name:"后"},computed:{label(){return this.format();}}});', '前后'],
  ['computed getter', 'const mixin={computed:{label:{get(){return this.name;}}}};new Vue({mixins:[mixin],data:{name:"读取"}});', '读取'],
  ['component method wins', 'const mixin={methods:{label(){return "旧";}}};new Vue({mixins:[mixin],methods:{label(){return "新";}}});', '新'],
  ['conditional candidates', 'const a={data:{label:"甲"}},b={data:{label:"乙"}};new Vue({mixins:[remote?a:b]});', '甲乙'],
  ['unresolved sibling keeps known data', 'const mixin={data:{label:"保留"}};new Vue({mixins:[unknownMixin,mixin]});', '保留'],
]) {
  test('Vue mixins: ' + name, () => {
    const body = name==='component method wins' ? '{{label()}}' : '{{label}}';
    chars(scan(body,[script]).A, expected);
  });
}

test('Vue mixins: data objects merge recursively and arrays are replaced', () => {
  const result=scan('{{info.name}}{{info.extra}}<b v-for="x in items">{{x}}</b>', [
    'const mixin={data:{info:{name:"旧",extra:"继承"},items:["旧数组"]}};new Vue({mixins:[mixin],data:{info:{name:"新"},items:["新数组"]}});',
  ]);
  chars(result.A,'新继承新数组');
});

test('Vue mixins: lifecycle mutation remains an uncertainty', () => {
  const result=scan('{{label}}',['const mixin={data:{label:"初始"},created(){this.label=remote;}};new Vue({mixins:[mixin]});']);
  chars(result.A,'初始'); assert.ok(result.risks.some(r=>r.includes('label')));
});

test('Vue mixins: excessively nested options terminate with a diagnostic', () => {
  let mixin='{data:{label:"深层"}}';
  for(let index=0;index<40;index++) mixin='{mixins:['+mixin+']}';
  const result=scan('{{label}}',['new Vue({mixins:['+mixin+'],data:{label:"页面"}});']);
  chars(result.A,'页面'); assert.ok(result.risks.length);
});

test('Vue mixins: source callbacks are never executed', () => {
  delete global.__mikitMixinExecuted;
  const result=scan('{{label}}',['const mixin={data(){global.__mikitMixinExecuted=true;return {label:"危险"};}};new Vue({mixins:[mixin]});']);
  assert.equal(global.__mikitMixinExecuted,undefined); assert.ok(result.risks.length);
});
