// 無字模式的回歸測試：**使用者的短語一個字都不准出現在 prompt 裡**。
//
// 2026-08-03 事故：無字模式下 prompt 把短語用引號塞了兩次，模型九格全部把字印上去。
// 根因是「字串出現在 prompt 裡」，不是「否定句寫得不夠用力」，所以測的是來源不是措辭。
//
//   node worker/test-prompt.mjs
//
// ponytail: 不引框架也不起 worker，直接把 buildPrompt 從原始碼挖出來跑。
// 唯一的耦合是那兩行 import 的剝除，index.js 改 import 形式時這裡會壞、壞了照樣修。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'src/index.js'), 'utf8');
const body = src
  .slice(0, src.indexOf('export default'))
  // 剝掉外部相依：buildPrompt 只需要 CAMPAIGNS（給 campaignById 查），其餘用不到。
  .replace('import CAMPAIGNS from "./campaigns.json";', 'const CAMPAIGNS = [];')
  .replace(/^import [^;]*?;$/gms, '');
const mod = await import(
  'data:text/javascript;base64,'
  + Buffer.from(`${body}\nexport { buildPrompt, DEFAULT_PHRASES, ACTION_FOR_PHRASE };`).toString('base64')
);

const PHRASES = [
  '欸？搞錯了嗎？', '今天也超開心！', '大家加油喵！',
  '這個太難了吧…', '我沒有卡住！', '要吃好吃的喔',
  '先去睡個覺…', '這樣也可以！？', '謝謝大家的禮物！',
];
const ACTIONS = [
  'slumped at desk, weary look', 'jumping in air, wide smile', 'cheering with cat paws',
  'panicked face, sweat drop', 'pouting face, crossed arms', 'holding oversized spoon',
  'drooping eyes, curled up', 'shocked wide eyes, hands up', 'holding glowing gift box',
];
const nine = PHRASES.map((phrase, i) => ({ phrase, action: ACTIONS[i] }));

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed += 1;
};

for (const styleHint of ['match', 'chibi']) {
  const noText = mod.buildPrompt({ nine, styleHint, withText: false, chromaKey: 'green' });
  const leaked = PHRASES.filter((p) => noText.includes(p));
  check(`無字模式（${styleHint}）：短語不進 prompt`, leaked.length === 0,
    leaked.length ? `外洩 ${leaked.length} 句：${leaked.join('／')}` : `${noText.length} 字`);
  check(`無字模式（${styleHint}）：動作有進 prompt`,
    ACTIONS.every((a) => noText.includes(a)));
  check(`無字模式（${styleHint}）：最高優先段有 TEXT-FREE 規則`,
    noText.split('\n').slice(0, 6).join('\n').includes('TEXT-FREE'));
  // prompt 本文自己有兩處中文（LINE 審核規則、新式樣專利），那是給模型讀的說明、
  // 不是要畫的字，白名單掉。除此之外出現任何中日韓文字，就代表又有使用者輸入漏進來了。
  const ALLOWED_CJK = ['新式樣專利', '審核'];
  let stripped = noText;
  for (const a of ALLOWED_CJK) stripped = stripped.split(a).join('');
  const strays = stripped.match(/[　-〿぀-ヿ一-鿿가-힯]+/g) || [];
  check(`無字模式（${styleHint}）：沒有其他中日韓文字漏進來`,
    strays.length === 0, strays.slice(0, 3).join('／'));
}

// 預設短語（隨機模式抽的就是這 50 句）每一句都要有英文動作可查，
// 否則無字模式下那一格會掉進通用敘述、姿勢跟著糊掉。
{
  const missing = mod.DEFAULT_PHRASES.filter((p) => !mod.ACTION_FOR_PHRASE[p]);
  check('隨機模式：50 句預設短語都查得到英文動作',
    missing.length === 0, missing.length ? `查不到 ${missing.length} 句：${missing.slice(0,5).join('／')}` : `${mod.DEFAULT_PHRASES.length} 句`);
}

// 動作留空（前端沒真的擋）時，九格不能拿到同一句通用敘述
{
  const bare = PHRASES.map((phrase) => ({ phrase }));
  const p = mod.buildPrompt({ nine: bare, styleHint: 'match', withText: false, chromaKey: 'green' });
  const poses = [...p.matchAll(/ACTION\/POSE: (.+)/g)].map((m) => m[1].trim());
  check('無字模式：動作留空時九格姿勢仍各自不同',
    poses.length === 9 && new Set(poses).size === 9,
    `${new Set(poses).size} 種`);
  check('無字模式：動作留空時短語仍不進 prompt', !PHRASES.some((x) => p.includes(x)));
}

// 負控制：印字模式一定要把九句原封不動帶進去，否則就是把功能改壞了
const withText = mod.buildPrompt({ nine, styleHint: 'match', withText: true, chromaKey: 'green' });
const missing = PHRASES.filter((p) => !withText.includes(p));
check('印字模式：九句都還在 prompt 裡（負控制）', missing.length === 0,
  missing.length ? `少了：${missing.join('／')}` : '');

console.log(failed ? `\n${failed} 項未過` : '\n全部通過');
process.exit(failed ? 1 : 0);
