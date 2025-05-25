import Airtable from 'airtable';
import { OpenAI } from 'openai'; // OpenAI client is initialized per call or as needed now
import config from '../config.js';
// Import callOpenAI from imageAnalyzerService to centralize OpenAI API calls - Removed as it's not used
// import { callOpenAI as callOpenAIGeneric } from './imageAnalyzer.js'; 

// Configuration constants from config.js
const {
    damagedTable: AIRTABLE_DAMAGED_TABLE,
    referenceTable: AIRTABLE_REFERENCE_TABLE,
    accidentAnalysisTable: AIRTABLE_ACCIDENT_ANALYSIS_TABLE,
    partAnalysisTable: AIRTABLE_PART_ANALYSIS_TABLE
} = config.airtable;

const {
    visionModel,
    imageDetail,
    maxTokens
} = config.openai;

const {
    damageAssessment: damageAssessmentPrompt,
    singlePartAssessment: singlePartAssessmentPrompt
} = config.airtable.prompts;


/**
 * Fetches all records from a specified Airtable table.
 * @param {Airtable.Base} base - The Airtable base instance.
 * @param {string} tableName - The name of the table to fetch records from.
 * @returns {Promise<Airtable.Record[]>} A promise that resolves to an array of records.
 */
async function fetchAirtableRecordsWithBase(base, tableName) {
  const records = [];
  await base(tableName).select().eachPage((pageRecords, fetchNextPage) => {
    records.push(...pageRecords);
    fetchNextPage();
  });
  console.log(`[INFO] Fetched ${records.length} records from ${tableName}`);
  return records;
}

/**
 * Performs comparative analysis of a damaged and a reference image using OpenAI.
 * Uses the generic callOpenAIGeneric function from imageAnalyzer.js for the API call.
 * @param {string} damagedUrl - URL of the damaged image.
 * @param {string} referenceUrl - URL of the reference (undamaged) image.
 * @returns {Promise<object>} A promise that resolves to the parsed JSON response from OpenAI.
 */
async function analyzePairWithOpenAI(damagedUrl, referenceUrl) {
  console.log('[INFO] OpenAI comparative analysis starting:', { damagedUrl, referenceUrl });
  
  // Construct the messages array for the OpenAI API call
  const messages = [
    { role: "system", content: "You are an expert vehicle damage assessment assistant." },
    {
      role: "user",
      content: [
        { type: "text", text: damageAssessmentPrompt },
        { type: "image_url", image_url: { url: damagedUrl, detail: imageDetail } },
        { type: "image_url", image_url: { url: referenceUrl, detail: imageDetail } }
      ]
    }
  ];

  try {
    // Direct OpenAI client usage for multi-image prompts or specific payload structures.
    const openai = new OpenAI({ apiKey: config.openai.apiKey });
    const response = await openai.chat.completions.create({
        model: visionModel,
        messages: messages,
        max_tokens: maxTokens,
        // response_format: { type: "json_object" }, // Ensure this is supported or handled if not.
        // temperature: config.openai.temperature, // Add if needed for this specific call
    });

    const text = response.choices[0].message.content;
    return JSON.parse(text);
  } catch (parseError) {
    // response değişkeni burada yok, sadece parseError üzerinden logla
    console.error("[ERROR] analyzePairWithOpenAI - OpenAI response JSON parse error:", parseError.message);
    return { error: "OpenAI response not in JSON format or missing content" };
  }
}

/**
 * Performs analysis of a single image, typically a 'car part', using OpenAI.
 * Uses the generic callOpenAIGeneric function from imageAnalyzer.js for the API call.
 * @param {string} damagedUrl - URL of the damaged image.
 * @returns {Promise<object>} A promise that resolves to the parsed JSON response from OpenAI.
 */
async function analyzeCarPartWithOpenAI(damagedUrl) {
  console.log('[INFO] OpenAI single car part analysis starting:', { damagedUrl });
  
  // Direct OpenAI client usage for specific payload structures.
  const openai = new OpenAI({ apiKey: config.openai.apiKey });
   const messages = [
      { role: "system", content: "You are a certified vehicle damage assessment expert." },
      {
        role: "user",
        content: [
          { type: "text", text: singlePartAssessmentPrompt },
          { type: "image_url", image_url: { url: damagedUrl, detail: imageDetail } }
        ]
      }
    ];

  try {
    const response = await openai.chat.completions.create({
        model: visionModel,
        messages: messages,
        max_tokens: maxTokens,
        // response_format: { type: "json_object" }, // Ensure this is supported
        // temperature: config.openai.temperature,
    });
    const text = response.choices[0].message.content;
    return JSON.parse(text);
  } catch (parseError) {
    console.error("[ERROR] analyzeCarPartWithOpenAI - OpenAI response JSON parse error:", parseError.message);
    return { error: "OpenAI response not in JSON format or missing content" };
  }
}


/**
 * Gets the next available ID for a record in an Airtable table.
 * @param {Airtable.Base} base - The Airtable base instance.
 * @param {string} tableName - The name of the table.
 * @param {string} idField - The name of the ID field.
 * @param {string} prefix - The prefix for the ID.
 * @returns {Promise<string>} The next ID string.
 */
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

/**
 * Upserts a record in Airtable based on a specific ID field.
 * If a record with the ID value exists, it's updated; otherwise, a new record is created.
 * @param {Airtable.Base} base - The Airtable base instance.
 * @param {string} tableName - The name of the table.
 * @param {string} idField - The name of the ID field to check for existing records.
 * @param {string} idValue - The value of the ID to search for.
 * @param {object} fields - The fields to create or update.
 */
async function upsertAirtableWithId(base, tableName, idField, idValue, fields) {
  try {
    const records = await base(tableName).select({ filterByFormula: `{${idField}} = '${idValue}'` }).all();
    if (records.length > 0) {
      await base(tableName).update(records[0].id, fields);
      console.log(`[INFO] Airtable record updated in [${tableName}]: id=${idValue}`);
    } else {
      await base(tableName).create([{ fields: { ...fields, [idField]: idValue } }]);
      console.log(`[INFO] Airtable record created in [${tableName}]: id=${idValue}`);
    }
  } catch (error) {
    console.error(`[ERROR] upsertAirtableWithId failed for table ${tableName}, id ${idValue}:`, error.message);
    throw error;
  }
}

/**
 * Saves part analysis data to Airtable.
 * @param {Airtable.Base} base - The Airtable base instance.
 * @param {Array<object>} damage_summary - An array of damage summary objects.
 */
async function savePartAnalysis(base, damage_summary) {
  if (!Array.isArray(damage_summary) || damage_summary.length === 0) {
    console.log("[INFO] savePartAnalysis: Empty or invalid damage_summary, skipping save.");
    return;
  }
  
  let nextIdNum;
  try {
    const nextIdStr = await getNextId(base, AIRTABLE_PART_ANALYSIS_TABLE, 'parca_analiz_id', 'parca_analiz_');
    nextIdNum = parseInt(nextIdStr.replace('parca_analiz_', ''), 10);
    if (isNaN(nextIdNum)) {
        console.error("[ERROR] savePartAnalysis: Invalid number from getNextId:", nextIdStr, "Defaulting to 1.");
        nextIdNum = 1; 
    }
  } catch (error) {
      console.error("[ERROR] savePartAnalysis: Error in getNextId:", error.message, "Defaulting to 1.");
      nextIdNum = 1; 
  }

  for (const part of damage_summary) {
    if (!part || typeof part !== 'object' || !part.part_name) {
        console.error("[ERROR] savePartAnalysis: Invalid part object or missing part_name:", part, "Skipping record.");
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
        console.error("[ERROR] savePartAnalysis: Error during upsert for part:", part, "idValue:", idValue, "error:", error.message);
    }
  }
}

/**
 * Saves accident analysis data to Airtable.
 * @param {Airtable.Base} base - The Airtable base instance.
 * @param {string} content - The content of the accident analysis.
 * @param {number|string} confidence - The confidence score of the analysis.
 */
async function saveAccidentAnalysis(base, content, confidence) {
  if (typeof content !== 'string' || content.trim() === '') {
    console.log("[INFO] saveAccidentAnalysis: Invalid or empty content, skipping save.");
    return;
  }
  try {
    const idValue = await getNextId(base, AIRTABLE_ACCIDENT_ANALYSIS_TABLE, 'kaza_analiz_id', 'kaza_analiz_');
    await upsertAirtableWithId(base, AIRTABLE_ACCIDENT_ANALYSIS_TABLE, 'kaza_analiz_id', idValue, {
      content,
      confidence: String(confidence ?? '') 
    });
  } catch (error) {
      console.error("[ERROR] saveAccidentAnalysis: Error during upsert for content:", content, "error:", error.message);
  }
}

/**
 * Clears records from the analysis-related tables in Airtable.
 * @param {Airtable.Base} base - The Airtable base instance.
 */
async function clearAnalysisTables(base) {
  console.log('[INFO] Clearing analysis tables...');
  const tablesToClear = [
    { name: AIRTABLE_PART_ANALYSIS_TABLE, label: "Parça Analiz Tablosu" },
    { name: AIRTABLE_ACCIDENT_ANALYSIS_TABLE, label: "Kaza Analiz Tablosu" }
  ];

  for (const table of tablesToClear) {
    try {
      const records = await base(table.name).select().all();
      if (records.length > 0) {
        const recordIds = records.map(record => record.id);
        for (let i = 0; i < recordIds.length; i += 10) { // Process in batches of 10
            const batch = recordIds.slice(i, i + 10);
            await base(table.name).destroy(batch);
        }
        console.log(`[INFO] ${table.label} (${table.name}): ${recordIds.length} records deleted.`);
      } else {
        console.log(`[INFO] ${table.label} (${table.name}): No records found to delete.`);
      }
    } catch (error) {
        console.error(`[ERROR] Error clearing ${table.label} (${table.name}):`, error.message);
    }
  }
}


/**
 * Initializes Airtable and OpenAI clients and clears previous analysis tables.
 * @returns {Promise<{base: Airtable.Base}>} Airtable base instance.
 * @throws Will throw an error if API key or base ID is missing.
 */
async function initializeAnalysis() {
    const apiKey = config.airtable.apiKey;
    const baseId = config.airtable.baseId;
    if (!apiKey || !baseId) {
        const errorMsg = 'Airtable API anahtarı veya Base ID eksik!';
        console.error('[ERROR]', errorMsg);
        throw new Error(errorMsg);
    }
    const base = new Airtable({ apiKey }).base(baseId);
    await clearAnalysisTables(base);
    console.log('[INFO] Analysis initialized and tables cleared for base:', baseId);
    return { base };
}

/**
 * Fetches damaged and reference data from Airtable and prepares it for analysis.
 * @param {Airtable.Base} base - The Airtable base instance.
 * @returns {Promise<{damagedRecords: Airtable.Record[], referenceByAngle: object}>}
 */
async function fetchAndPrepareData(base) {
    const [damagedRecords, referenceRecords] = await Promise.all([
        fetchAirtableRecordsWithBase(base, AIRTABLE_DAMAGED_TABLE),
        fetchAirtableRecordsWithBase(base, AIRTABLE_REFERENCE_TABLE)
    ]);

    const referenceByAngle = referenceRecords.reduce((acc, rec) => {
        if (rec.fields.angle && rec.fields.hasarsiz_image_url) {
            acc[rec.fields.angle] = rec.fields.hasarsiz_image_url;
        }
        return acc;
    }, {});
    console.log('[INFO] Data fetched and prepared.');
    return { damagedRecords, referenceByAngle };
}

/**
 * Processes a single damaged record: performs AI analysis and saves results.
 * @param {Airtable.Record} damagedRecord - The damaged record from Airtable.
 * @param {Airtable.Base} base - The Airtable base instance.
 * @param {object} referenceByAngle - Object mapping angles to reference image URLs.
 * @returns {Promise<object|null>} Analysis result or null if skipped.
 */
async function processDamagedRecord(damagedRecord, base, referenceByAngle) {
    const { angle, hasarli_image_url: damagedUrl, id: recordId } = damagedRecord.fields;

    if (!damagedUrl) {
        console.error('[ERROR] Skipping record without damaged image URL:', recordId || 'Unknown ID');
        return null;
    }

    let analysisResult;
    try {
        if (angle?.toLowerCase() === 'car part') {
            console.log('[INFO] Starting single car part analysis for URL:', damagedUrl);
            analysisResult = await analyzeCarPartWithOpenAI(damagedUrl); // Renamed from analyzeSingleWithOpenAI
            if (analysisResult?.damage_summary) {
                await savePartAnalysis(base, analysisResult.damage_summary);
            }
        } else {
            const referenceUrl = referenceByAngle[angle];
            if (referenceUrl) {
                console.log('[INFO] Starting comparative analysis for URL:', damagedUrl, 'with reference:', referenceUrl);
                analysisResult = await analyzePairWithOpenAI(damagedUrl, referenceUrl);
                if (analysisResult?.content) {
                    await saveAccidentAnalysis(base, analysisResult.content, analysisResult.confidence);
                }
            } else {
                // If no reference URL, fallback to single car part analysis logic for the damaged image.
                console.log('[INFO] No reference image found for angle', angle, '- performing single analysis on:', damagedUrl);
                analysisResult = await analyzeCarPartWithOpenAI(damagedUrl); // Fallback to car part style analysis
                 if (analysisResult?.damage_summary) { // Check for damage_summary as per analyzeCarPartWithOpenAI's expected output
                    await savePartAnalysis(base, analysisResult.damage_summary);
                }
            }
        }
        return { id: recordId, type: angle?.toLowerCase() === 'car part' || !referenceByAngle[angle] ? 'single_part_or_fallback' : 'pair', angle, result: analysisResult };
    } catch (error) {
        console.error('[ERROR] Analysis failed for record:', recordId || 'Unknown ID', error.message, error.stack);
        return { id: recordId, type: 'error', angle, error: error.message };
    }
}


/**
 * Orchestrates the analysis of images from Airtable, including fetching data,
 * performing AI analysis, and saving results back to Airtable.
 * @returns {Promise<object>} An object indicating success, count of results, and the results themselves.
 */
export async function analyzeImages() {
  try {
    const { base } = await initializeAnalysis();
    const { damagedRecords, referenceByAngle } = await fetchAndPrepareData(base);

    const analysisPromises = damagedRecords.map(record =>
        processDamagedRecord(record, base, referenceByAngle)
    );
    
    const results = (await Promise.all(analysisPromises)).filter(r => r !== null);

    console.log('[INFO] All image analyses completed.', {
      totalRecordsProcessed: damagedRecords.length,
      successfulAnalyses: results.filter(r => !r.error).length,
      failedAnalyses: results.filter(r => r.error).length,
    });
    return { success: true, results_count: results.length, results };
  } catch (error) {
    console.error('[ERROR] Overall analysis process failed:', error.message, error.stack);
    throw error; // Re-throw to be caught by the route handler
  }
}

/**
 * Public function to clear analysis tables in Airtable.
 */
export async function clearTables() {
  const apiKey = config.airtable.apiKey;
  const baseId = config.airtable.baseId;
  if (!apiKey || !baseId) {
    throw new Error('Airtable API key and Base ID are required to clear tables.');
  }
  const base = new Airtable({ apiKey }).base(baseId);
  try {
    const result = await clearAnalysisTables(base);
    return result;
  } catch (e) {
    console.error('[ERROR] Tablo temizleme hatası:', e.message);
    throw e;
  }
}