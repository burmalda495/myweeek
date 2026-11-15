// Cloudflare Pages Function: POST /api/food (положи файл в functions/api/food.js).
// Секреты: GEMINI_API_KEY (обязательно), GEMINI_MODEL (по умолчанию gemini-3.1-flash-lite), ALLOWED_ORIGIN (адрес сайта).
// Нейросеть возвращает только наблюдения (что за еда, уровень в посуде, штуки). Граммы считает клиент.
const reply = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json' } });

const PROMPT = (c) => `Ты помогаешь посчитать еду по фото. Граммы не называй: вес посчитает программа по твоим наблюдениям.
Для каждой позиции верни:
- id из списка; если подходящего нет, id=other, name по-русски и kcal,p,f,c на 100 г и density (г/мл).
- mode: "volume" (суп, каша, пюре, напитки, всё, что лежит внутри посуды с бортами; укажи level), "plate" (еда выложена на плоскую тарелку; укажи coverage и thickness), "pieces" (штучные продукты; укажи count).
- level: на какой высоте от дна уровень еды относительно глубины посуды, в процентах (остатки на дне 5–15, до половины 50, до краёв 100).
- coverage: какую часть площади тарелки занимает эта позиция, в процентах. thickness: средняя толщина слоя в см.
- confidence: "low", если уровень или толщину плохо видно (непрозрачная миска, всё в соусе, съёмка сбоку), иначе "high".
Посуда: ${c}. Для масштаба опирайся на ложку или вилку (около 18–19 см), если они в кадре. Оценивай ровно то, что видно, не завышай и не занижай. Остатки на тарелке это маленькие значения. Не больше 8 позиций. Если еды нет, items пустой.`;

const schema = (ids) => ({
  type: 'OBJECT',
  properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    id: { type: 'STRING', enum: ids }, name: { type: 'STRING' },
    mode: { type: 'STRING', enum: ['volume', 'plate', 'pieces'] },
    level: { type: 'NUMBER' }, coverage: { type: 'NUMBER' }, thickness: { type: 'NUMBER' }, count: { type: 'NUMBER' },
    confidence: { type: 'STRING', enum: ['high', 'low'] },
    kcal: { type: 'NUMBER' }, p: { type: 'NUMBER' }, f: { type: 'NUMBER' }, c: { type: 'NUMBER' }, density: { type: 'NUMBER' }
  }, required: ['id', 'mode', 'confidence'] } } },
  required: ['items']
});

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) return reply(500, { error: 'no_key' });
  const origin = request.headers.get('Origin');
  if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return reply(403, { error: 'origin' });
  let body;
  try { body = await request.json(); } catch (e) { return reply(400, { error: 'bad_json' }); }
  const image = body.image;
  if (!image || typeof image !== 'string' || image.length > 4500000) return reply(400, { error: 'bad_image' });
  const ids = Array.isArray(body.ids) ? body.ids.filter(s => typeof s === 'string' && s.length <= 40).slice(0, 150) : [];
  if (!ids.includes('other')) ids.push('other');
  const container = String(body.container || '').slice(0, 200);
  const model = env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT(container) }, { inline_data: { mime_type: 'image/jpeg', data: image } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema(ids) }
      })
    });
    if (!r.ok) return reply(502, { error: 'ai_' + r.status });
    const j = await r.json();
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts;
    const t = ((parts && parts[0] && parts[0].text) || '').replace(/```json|```/g, '').trim();
    const out = JSON.parse(t);
    return reply(200, { items: Array.isArray(out.items) ? out.items.slice(0, 8) : [] });
  } catch (e) { return reply(502, { error: 'ai_fail' }); }
}

export const onRequest = () => reply(405, { error: 'post_only' });
