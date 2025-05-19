import Airtable from 'airtable';
import axios from 'axios';
import { OpenAI } from 'openai';

// Config
const AIRTABLE_DAMAGED_TABLE = "Hasarlı";
const AIRTABLE_REFERENCE_TABLE = "Hasarsız";
const AIRTABLE_ACCIDENT_ANALYSIS_TABLE = "Kaza Analiz Tablosu";
const AIRTABLE_PART_ANALYSIS_TABLE = "parca analiz";

// Log helper
function log(...args) {
  console.log('[LOG]', ...args);
}
function logError(...args) {
  console.error('[ERROR]', ...args);
}

// Airtable'dan tablo verilerini çek (dinamik base ile)
async function fetchAirtableRecordsWithBase(base, tableName) {
  const records = [];
  await base(tableName).select().eachPage((pageRecords, fetchNextPage) => {
    records.push(...pageRecords);
    fetchNextPage();
  });
  log(`${tableName} tablosundan ${records.length} kayıt çekildi.`);
  return records;
}

// Görseli base64'e çevir
async function imageToBase64(url) {
  log('Görsel indiriliyor:', url);
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data, 'binary').toString('base64');
}

// OpenAI ile karşılaştırmalı analiz
async function analyzePairWithOpenAI(openai, damagedUrl, referenceUrl) {
  log('OpenAI karşılaştırmalı analiz başlatılıyor');
  const damagedBase64 = await imageToBase64(damagedUrl);
  const referenceBase64 = await imageToBase64(referenceUrl);
  const prompt = `You are an expert vehicle damage assessment assistant.\n\nYou will be given two image URLs:\n\n- Damaged vehicle image: [damaged]\n- Undamaged reference vehicle image: [reference]\n\nYour task is to:\n1. Compare the damaged vehicle to the undamaged reference.\n2. Identify only the parts that are visibly damaged and clearly need to be replaced or repaired.\n3. Include both external parts (e.g., bumper, fender, hood, doors, windshield, mirrors, lights, trunk, etc.) and interior parts (e.g., airbag, dashboard, steering wheel, seats, gear console, etc.) only if visible.\n4. Do not include undamaged, hidden, or unclear parts.\n5. Be precise and objective – avoid vague terms like "some damage" or "possible issues".\n6. For each part, provide a clear reason why it needs to be replaced or repaired (e.g., "cracked", "heavily dented", "torn off", "shattered").\n\nYour response must be in the following JSON format:\n{\n  "content": "Damaged / must-be-replaced parts:\\n\\n- [Part name] – [Reason]\\n- [Part name] – [Reason]",\n  "confidence": [a whole number between 0 and 100 indicating how confident you are in the damage list]\n}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are an expert vehicle damage assessment assistant." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${damagedBase64}` } },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${referenceBase64}` } }
        ]
      }
    ],
    max_tokens: 800
  });
  
  const text = response.choices[0].message.content;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { error: "OpenAI response not in JSON format", raw: text };
  }
}

// OpenAI ile tekil hasarlı parça analizi
async function analyzeSingleWithOpenAI(openai, damagedUrl) {
  log('OpenAI tekil parça analizi başlatılıyor');
  const damagedBase64 = await imageToBase64(damagedUrl);
  const prompt = `You are a certified vehicle damage assessment expert.\n\nYou will receive a photo showing part(s) of a damaged vehicle. This could be a zoomed-in photo of a single part or a wide view (e.g., hood open) showing multiple parts.\n\nYour tasks:\n1. Identify all visible vehicle parts that appear damaged in the image.\n2. For each damaged part, provide:\n   - "part_name": The name of the damaged part (e.g., "Coolant reservoir", "Radiator support").\n   - "visible_damage": A short description of the damage (e.g., "Cracked and leaking").\n   - "recommendation": One of "Replace", "Repair", or "No damage".\n   - "confidence": A whole number between 0 and 100 representing how confident you are that this specific part is damaged as described.\n\nYour output must be a valid JSON object in the following format:\n{\n  "damage_summary": [\n    {\n      "part_name": "Coolant reservoir",\n      "visible_damage": "Cracked and leaking around the cap",\n      "recommendation": "Replace",\n      "confidence": 92\n    },\n    {\n      "part_name": "Radiator support bracket",\n      "visible_damage": "Bent mounting plate with rust",\n      "recommendation": "Repair",\n      "confidence": 85\n    }\n  ]\n}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a certified vehicle damage assessment expert." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${damagedBase64}` } }
        ]
      }
    ],
    max_tokens: 800
  });
  
  const text = response.choices[0].message.content;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { error: "OpenAI response not in JSON format", raw: text };
  }
}

// Airtable'da mevcut en yüksek id'yi bul
async function getNextId(base, tableName, idField, prefix) {
  const records = await base(tableName).select({ fields: [idField] }).all();
  let max = 0;
  for (const rec of records) {
    const val = rec.fields[idField];
    if (typeof val === 'string' && val.startsWith(prefix)) {
      const num = parseInt(val.replace(prefix, ''));
      if (!isNaN(num) && num > max) max = num;
    }
  }
  return `${prefix}${max + 1}`;
}

// Airtable'da id ile kayıt var mı kontrol et, varsa güncelle yoksa ekle
async function upsertAirtableWithId(base, tableName, idField, idValue, fields) {
  const records = await base(tableName).select({ filterByFormula: `{${idField}} = '${idValue}'` }).all();
  if (records.length > 0) {
    await base(tableName).update(records[0].id, fields);
    log(`Airtable'da güncellendi: [${tableName}] id=${idValue}`);
  } else {
    await base(tableName).create([{ fields: { ...fields, [idField]: idValue } }]);
    log(`Airtable'a eklendi: [${tableName}] id=${idValue}`);
  }
}

// Parça analizi kaydı (tekil analiz)
async function savePartAnalysis(base, damage_summary) {
  if (!Array.isArray(damage_summary)) return;
  let nextId = await getNextId(base, AIRTABLE_PART_ANALYSIS_TABLE, 'parca_analiz_id', 'parca_analiz_');
  let idNum = parseInt(nextId.replace('parca_analiz_', ''));
  for (const part of damage_summary) {
    const idValue = `parca_analiz_${idNum++}`;
    await upsertAirtableWithId(base, AIRTABLE_PART_ANALYSIS_TABLE, 'parca_analiz_id', idValue, {
      part_name: part.part_name,
      visible_damage: part.visible_damage,
      recommendation: part.recommendation,
      confidence: String(part.confidence)
    });
  }
}

// Kaza analizi kaydı (karşılaştırmalı analiz)
async function saveAccidentAnalysis(base, content, confidence) {
  const idValue = await getNextId(base, AIRTABLE_ACCIDENT_ANALYSIS_TABLE, 'kaza_analiz_id', 'kaza_analiz_');
  await upsertAirtableWithId(base, AIRTABLE_ACCIDENT_ANALYSIS_TABLE, 'kaza_analiz_id', idValue, {
    content,
    confidence: String(confidence)
  });
}

// Tabloları temizle
async function clearAnalysisTables(base) {
  log('Analiz tabloları temizleniyor...');
  
  // Parça analiz tablosunu temizle
  const partRecords = await base(AIRTABLE_PART_ANALYSIS_TABLE).select().all();
  if (partRecords.length > 0) {
    const partIds = partRecords.map(record => record.id);
    await base(AIRTABLE_PART_ANALYSIS_TABLE).destroy(partIds);
    log(`${AIRTABLE_PART_ANALYSIS_TABLE} tablosundan ${partIds.length} kayıt silindi.`);
  }

  // Kaza analiz tablosunu temizle
  const accidentRecords = await base(AIRTABLE_ACCIDENT_ANALYSIS_TABLE).select().all();
  if (accidentRecords.length > 0) {
    const accidentIds = accidentRecords.map(record => record.id);
    await base(AIRTABLE_ACCIDENT_ANALYSIS_TABLE).destroy(accidentIds);
    log(`${AIRTABLE_ACCIDENT_ANALYSIS_TABLE} tablosundan ${accidentIds.length} kayıt silindi.`);
  }

  return {
    success: true,
    cleared: {
      [AIRTABLE_PART_ANALYSIS_TABLE]: partRecords.length,
      [AIRTABLE_ACCIDENT_ANALYSIS_TABLE]: accidentRecords.length
    }
  };
}

// Ana analiz fonksiyonu
export async function analyzeImages(airtableApiKey, baseId) {
  if (!airtableApiKey || !baseId) {
    throw new Error('airtableApiKey ve baseId zorunlu.');
  }

  const base = new Airtable({ apiKey: airtableApiKey }).base(baseId);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // Sadece analiz tablolarını temizle (Hasarlı ve Hasarsız tablolarına dokunma)
    log('Analiz tabloları temizleniyor...');
    
    // Parça analiz tablosunu temizle
    const partRecords = await base(AIRTABLE_PART_ANALYSIS_TABLE).select().all();
    if (partRecords.length > 0) {
      const partIds = partRecords.map(record => record.id);
      await base(AIRTABLE_PART_ANALYSIS_TABLE).destroy(partIds);
      log(`Analiz tablosu temizlendi: ${AIRTABLE_PART_ANALYSIS_TABLE} (${partIds.length} kayıt silindi)`);
    }

    // Kaza analiz tablosunu temizle
    const accidentRecords = await base(AIRTABLE_ACCIDENT_ANALYSIS_TABLE).select().all();
    if (accidentRecords.length > 0) {
      const accidentIds = accidentRecords.map(record => record.id);
      await base(AIRTABLE_ACCIDENT_ANALYSIS_TABLE).destroy(accidentIds);
      log(`Analiz tablosu temizlendi: ${AIRTABLE_ACCIDENT_ANALYSIS_TABLE} (${accidentIds.length} kayıt silindi)`);
    }

    log('Analiz başlatıldı. Airtable base:', baseId);
    // Hasarlı ve Hasarsız tablolarından veri çek (bu tablolara dokunma)
    const damaged = await fetchAirtableRecordsWithBase(base, AIRTABLE_DAMAGED_TABLE);
    const reference = await fetchAirtableRecordsWithBase(base, AIRTABLE_REFERENCE_TABLE);
    
    const referenceByAngle = {};
    for (const rec of reference) {
      const angle = rec.fields.angle;
      if (angle) referenceByAngle[angle] = rec.fields.hasarsiz_image_url;
    }

    const results = [];
    for (const d of damaged) {
      const angle = d.fields.angle;
      const damagedUrl = d.fields.hasarli_image_url;
      
      if (!damagedUrl) {
        logError('Hasarlı görsel URL yok, kayıt atlandı:', d.id);
        continue;
      }

      if (angle && angle.toLowerCase() === 'car part') {
        log(`Tekil parça analizi başlatılıyor: ${damagedUrl}`);
        const singleResult = await analyzeSingleWithOpenAI(openai, damagedUrl);
        results.push({ id: d.id, type: 'single', result: singleResult });
        await savePartAnalysis(base, singleResult.damage_summary);
        continue;
      }

      const referenceUrl = referenceByAngle[angle];
      if (referenceUrl) {
        log(`Karşılaştırmalı analiz başlatılıyor: ${damagedUrl} <-> ${referenceUrl}`);
        const pairResult = await analyzePairWithOpenAI(openai, damagedUrl, referenceUrl);
        results.push({ id: d.id, type: 'pair', angle, result: pairResult });
        await saveAccidentAnalysis(base, pairResult.content, pairResult.confidence);
      } else {
        log(`Referans görsel bulunamadı, tekil analiz: ${damagedUrl}`);
        const singleResult = await analyzeSingleWithOpenAI(openai, damagedUrl);
        results.push({ id: d.id, type: 'single', angle, result: singleResult });
        await savePartAnalysis(base, singleResult.damage_summary);
      }
    }

    log('Analiz tamamlandı. Sonuçlar:', results.length);
    return { success: true, results };
  } catch (e) {
    logError('Analiz hatası:', e.message);
    throw e;
  }
}

// Tabloları temizleme fonksiyonu
export async function clearTables(airtableApiKey, baseId) {
  if (!airtableApiKey || !baseId) {
    throw new Error('airtableApiKey ve baseId zorunlu.');
  }

  const base = new Airtable({ apiKey: airtableApiKey }).base(baseId);
  
  try {
    const result = await clearAnalysisTables(base);
    return result;
  } catch (e) {
    logError('Tablo temizleme hatası:', e.message);
    throw e;
  }
} 