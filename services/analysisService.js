import Airtable from 'airtable';
import { OpenAI } from 'openai';

// Config
const AIRTABLE_DAMAGED_TABLE = "Hasarlı";
const AIRTABLE_REFERENCE_TABLE = "Hasarsız";
const AIRTABLE_ACCIDENT_ANALYSIS_TABLE = "Kaza Analiz Tablosu";
const AIRTABLE_PART_ANALYSIS_TABLE = "parca analiz";

// Basitleştirilmiş log fonksiyonları
const log = (...args) => console.log('[LOG]', ...args.map(arg => 
  typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
));

const logError = (...args) => console.error('[ERROR]', ...args.map(arg => 
  typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
));

// Airtable'dan tablo verilerini çek (dinamik base ile)
async function fetchAirtableRecordsWithBase(base, tableName) {
  const records = [];
  await base(tableName).select().eachPage((pageRecords, fetchNextPage) => {
    records.push(...pageRecords);
    fetchNextPage();
  });
  log(`Fetched ${records.length} records from ${tableName}`);
  return records;
}

// OpenAI ile karşılaştırmalı analiz
async function analyzePairWithOpenAI(openai, damagedUrl, referenceUrl) {
  log('OpenAI karşılaştırmalı analiz başlatılıyor', { damagedUrl, referenceUrl });
  const prompt = `You are an expert vehicle damage assessment assistant.\n\nYou will be given two image URLs:\n\n- Damaged vehicle image: [damaged]\n- Undamaged reference vehicle image: [reference]\n\nYour task is to:\n1. Compare the damaged vehicle to the undamaged reference.\n2. Identify only the parts that are visibly damaged and clearly need to be replaced or repaired.\n3. Include both external parts (e.g., bumper, fender, hood, doors, windshield, mirrors, lights, trunk, etc.) and interior parts (e.g., airbag, dashboard, steering wheel, seats, gear console, etc.) only if visible.\n4. Do not include undamaged, hidden, or unclear parts.\n5. Be precise and objective – avoid vague terms like "some damage" or "possible issues".\n6. For each part, provide a clear reason why it needs to be replaced or repaired (e.g., "cracked", "heavily dented", "torn off", "shattered").\n\nYour response must be in the following JSON format:\n{\n  "content": "Damaged / must-be-replaced parts:\\n\\n- [Part name] – [Reason]\\n- [Part name] – [Reason]",\n  "confidence": [a whole number between 0 and 100 indicating how confident you are in the damage list]\n}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are an expert vehicle damage assessment assistant." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: damagedUrl } },
          { type: "image_url", image_url: { url: referenceUrl } }
        ]
      }
    ],
    max_tokens: 800
  });
  
  const text = response.choices[0].message.content;
  try {
    return JSON.parse(text);
  } catch (parseError) {
    logError("analyzePairWithOpenAI - OpenAI response JSON parse error:", parseError.message, "Raw text:", text);
    const match = text.match(/\{[\s\S]*\}/);
    if (match && match[0]) {
      try {
        return JSON.parse(match[0]);
      } catch (regexParseError) {
        logError("analyzePairWithOpenAI - OpenAI response JSON parse error after regex:", regexParseError.message, "Matched text:", match[0]);
        return { error: "OpenAI response not in JSON format after regex", raw: text, matched: match[0] };
      }
    }
    return { error: "OpenAI response not in JSON format", raw: text };
  }
}

// OpenAI ile tekil hasarlı parça analizi
async function analyzeSingleWithOpenAI(openai, damagedUrl) {
  log('OpenAI tekil parça analizi başlatılıyor', { damagedUrl });
  const prompt = `You are a certified vehicle damage assessment expert.\n\nYou will receive a photo showing part(s) of a damaged vehicle. This could be a zoomed-in photo of a single part or a wide view (e.g., hood open) showing multiple parts.\n\nYour tasks:\n1. Identify all visible vehicle parts that appear damaged in the image.\n2. For each damaged part, provide:\n   - "part_name": The name of the damaged part (e.g., "Coolant reservoir", "Radiator support").\n   - "visible_damage": A short description of the damage (e.g., "Cracked and leaking").\n   - "recommendation": One of "Replace", "Repair", or "No damage".\n   - "confidence": A whole number between 0 and 100 representing how confident you are that this specific part is damaged as described.\n\nYour output must be a valid JSON object in the following format:\n{\n  "damage_summary": [\n    {\n      "part_name": "Coolant reservoir",\n      "visible_damage": "Cracked and leaking around the cap",\n      "recommendation": "Replace",\n      "confidence": 92\n    },\n    {\n      "part_name": "Radiator support bracket",\n      "visible_damage": "Bent mounting plate with rust",\n      "recommendation": "Repair",\n      "confidence": 85\n    }\n  ]\n}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a certified vehicle damage assessment expert." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: damagedUrl } }
        ]
      }
    ],
    max_tokens: 800
  });
  
  const text = response.choices[0].message.content;
  try {
    return JSON.parse(text);
  } catch (parseError) {
    logError("analyzeSingleWithOpenAI - OpenAI response JSON parse error:", parseError.message, "Raw text:", text);
    const match = text.match(/\{[\s\S]*\}/);
    if (match && match[0]) {
      try {
        return JSON.parse(match[0]);
      } catch (regexParseError) {
        logError("analyzeSingleWithOpenAI - OpenAI response JSON parse error after regex:", regexParseError.message, "Matched text:", match[0]);
        return { error: "OpenAI single response not in JSON format after regex", raw: text, matched: match[0] };
      }
    }
    return { error: "OpenAI single response not in JSON format", raw: text };
  }
}

// Airtable'da mevcut en yüksek id'yi bul
async function getNextId(base, tableName, idField, prefix) {
  const records = await base(tableName).select({ fields: [idField] }).all();
  let max = 0;
  for (const rec of records) {
    const val = rec.fields[idField];
    if (typeof val === 'string' && val.startsWith(prefix)) {
      const num = parseInt(val.replace(prefix, ''), 10);
      if (!isNaN(num) && num > max) {
        max = num;
      }
    }
  }
  return `${prefix}${max + 1}`;
}

// Airtable'da id ile kayıt var mı kontrol et, varsa güncelle yoksa ekle
async function upsertAirtableWithId(base, tableName, idField, idValue, fields) {
  try {
    const records = await base(tableName).select({ filterByFormula: `{${idField}} = '${idValue}'` }).all();
    if (records.length > 0) {
      await base(tableName).update(records[0].id, fields);
      log(`Airtable'da güncellendi: [${tableName}] id=${idValue}`);
    } else {
      await base(tableName).create([{ fields: { ...fields, [idField]: idValue } }]);
      log(`Airtable'a eklendi: [${tableName}] id=${idValue}`);
    }
  } catch (error) {
    logError("upsertAirtableWithId hata:", `tableName=${tableName}, idField=${idField}, idValue=${idValue}`, error.message);
    throw error;
  }
}

// Parça analizi kaydı (tekil analiz)
async function savePartAnalysis(base, damage_summary) {
  if (!Array.isArray(damage_summary) || damage_summary.length === 0) {
    log("savePartAnalysis: Boş veya geçersiz damage_summary, kayıt atlanıyor.");
    return;
  }
  
  let nextIdNum;
  try {
    const nextIdStr = await getNextId(base, AIRTABLE_PART_ANALYSIS_TABLE, 'parca_analiz_id', 'parca_analiz_');
    nextIdNum = parseInt(nextIdStr.replace('parca_analiz_', ''), 10);
    if (isNaN(nextIdNum)) {
        logError("savePartAnalysis: getNextId'den geçersiz numara alındı:", nextIdStr, "Varsayılan 1 kullanılacak.");
        nextIdNum = 1; 
    }
  } catch (error) {
      logError("savePartAnalysis: getNextId hatası:", error.message, "Varsayılan 1 kullanılacak.");
      nextIdNum = 1; 
  }

  for (const part of damage_summary) {
    if (!part || typeof part !== 'object' || !part.part_name) {
        logError("savePartAnalysis: Geçersiz part objesi veya eksik part_name:", part, "Kayıt atlanıyor.");
        continue;
    }
    const idValue = `parca_analiz_${nextIdNum++}`;
    try {
      await upsertAirtableWithId(base, AIRTABLE_PART_ANALYSIS_TABLE, 'parca_analiz_id', idValue, {
        part_name: part.part_name,
        visible_damage: part.visible_damage,
        recommendation: part.recommendation,
        confidence: String(part.confidence ?? '') 
      });
    } catch (error) {
        logError("savePartAnalysis: upsert sırasında hata oluştu, part:", part, "idValue:", idValue, "error:", error.message);
    }
  }
}

// Kaza analizi kaydı (karşılaştırmalı analiz)
async function saveAccidentAnalysis(base, content, confidence) {
  if (typeof content !== 'string' || content.trim() === '') {
    log("saveAccidentAnalysis: Geçersiz veya boş content, kayıt atlanıyor.");
    return;
  }
  try {
    const idValue = await getNextId(base, AIRTABLE_ACCIDENT_ANALYSIS_TABLE, 'kaza_analiz_id', 'kaza_analiz_');
    await upsertAirtableWithId(base, AIRTABLE_ACCIDENT_ANALYSIS_TABLE, 'kaza_analiz_id', idValue, {
      content,
      confidence: String(confidence ?? '') 
    });
  } catch (error) {
      logError("saveAccidentAnalysis: upsert sırasında hata oluştu, content:", content, "error:", error.message);
  }
}

// Tabloları temizle
async function clearAnalysisTables(base) {
  log('Analiz tabloları temizleniyor...');
  const tablesToClear = [
    { name: AIRTABLE_PART_ANALYSIS_TABLE, label: "Parça Analiz Tablosu" },
    { name: AIRTABLE_ACCIDENT_ANALYSIS_TABLE, label: "Kaza Analiz Tablosu" }
  ];

  for (const table of tablesToClear) {
    try {
      const records = await base(table.name).select().all();
      if (records.length > 0) {
        const recordIds = records.map(record => record.id);
        for (let i = 0; i < recordIds.length; i += 10) {
            const batch = recordIds.slice(i, i + 10);
            await base(table.name).destroy(batch);
        }
        log(`${table.label} (${table.name}) tablosundan ${recordIds.length} kayıt silindi.`);
      } else {
        log(`${table.label} (${table.name}) tablosunda silinecek kayıt bulunamadı.`);
      }
    } catch (error) {
        logError(`${table.label} (${table.name}) temizlenirken hata oluştu:`, error.message);
    }
  }
}

// Ana analiz fonksiyonu
export async function analyzeImages(airtableApiKey, baseId) {
  if (!airtableApiKey || !baseId) {
    const errorMsg = 'Missing required parameters: airtableApiKey and baseId';
    logError(errorMsg);
    throw new Error(errorMsg);
  }

  const base = new Airtable({ apiKey: airtableApiKey }).base(baseId);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    await clearAnalysisTables(base);
    log('Starting analysis for base:', baseId);

    const [damaged, reference] = await Promise.all([
      fetchAirtableRecordsWithBase(base, AIRTABLE_DAMAGED_TABLE),
      fetchAirtableRecordsWithBase(base, AIRTABLE_REFERENCE_TABLE)
    ]);
    
    const referenceByAngle = reference.reduce((acc, rec) => {
      if (rec.fields.angle && rec.fields.hasarsiz_image_url) {
        acc[rec.fields.angle] = rec.fields.hasarsiz_image_url;
      }
      return acc;
    }, {});

    const results = [];
    for (const d of damaged) {
      const { angle, hasarli_image_url: damagedUrl } = d.fields;
      
      if (!damagedUrl) {
        logError('Skipping record without damaged image URL:', d.id);
        continue;
      }

      try {
        let analysisResult;
        if (angle?.toLowerCase() === 'car part') {
          log('Starting single part analysis:', damagedUrl);
          analysisResult = await analyzeSingleWithOpenAI(openai, damagedUrl);
          if (analysisResult?.damage_summary) {
            await savePartAnalysis(base, analysisResult.damage_summary);
          }
        } else {
          const referenceUrl = referenceByAngle[angle];
          if (referenceUrl) {
            log('Starting comparative analysis:', { damagedUrl, referenceUrl });
            analysisResult = await analyzePairWithOpenAI(openai, damagedUrl, referenceUrl);
            if (analysisResult?.content) {
              await saveAccidentAnalysis(base, analysisResult.content, analysisResult.confidence);
            }
          } else {
            log('No reference image found, performing single analysis:', damagedUrl);
            analysisResult = await analyzeSingleWithOpenAI(openai, damagedUrl);
            if (analysisResult?.damage_summary) {
              await savePartAnalysis(base, analysisResult.damage_summary);
            }
          }
        }
        results.push({ id: d.id, type: angle?.toLowerCase() === 'car part' ? 'single' : 'pair', angle, result: analysisResult });
      } catch (error) {
        logError('Analysis failed for record:', d.id, error.message);
      }
    }

    log('Analysis completed:', { 
      totalRecords: damaged.length, 
      successfulAnalyses: results.length 
    });
    return { success: true, results_count: results.length, results };
  } catch (error) {
    logError('Analysis failed:', error.message);
    throw error;
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