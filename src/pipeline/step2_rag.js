import { anthropic } from '../services/anthropic.js';
import { fetchWeatherForLocation, assessEnvironmentalRisk } from '../services/weather.js';

// RAG context is simplified for hackathon: we use a curated knowledge base
// embedded directly, avoiding ChromaDB runtime dependency for the demo
const TOMATO_KNOWLEDGE = `
# Conocimiento agronómico del tomate

## Semana 0 — Siembra/germinación (BBCH 00-09)
- Semilla de 3mm, color marrón. Sin estructura aérea. Radícula blanca emergiendo.
- Temperatura óptima germinación: 20-25°C. Por debajo de 10°C no germina.
- Escala BBCH 00: semilla seca. BBCH 05: radícula visible. BBCH 09: germinación completa.
- Altura: 0 cm. Color dominante: marrón tierra húmeda.

## Semana 1 — Plántula con cotiledones (BBCH 10-11)
- Hipocótilo verde claro/amarillento de 3-5cm, delgado 1-2mm de diámetro.
- Dos cotiledones ovales de 1-2cm, verde pálido, opuestos. Sin hojas verdaderas.
- Temperatura ideal: 18-22°C día, 15-18°C noche.
- Altura aérea: 4-6 cm. Color: verde muy pálido, casi amarillento.

## Semana 2 — Hojas verdaderas (BBCH 12-14)
- Tallo principal de 8-12 cm, verde claro firme.
- 2-4 hojas verdaderas pinnadas con folíolos serrados. Cotiledones aún presentes.
- Pelos glandulares visibles. Inicio de fotosíntesis activa.
- Altura: 10-15 cm. Color dominante: verde medio brillante.

## Semana 3 — Crecimiento vegetativo activo (BBCH 15-19)
- Tallo principal 18-25 cm, 5-7 hojas verdaderas bien desarrolladas, pinnadas, verde intenso.
- Primer brote axilar puede aparecer. Sin botones florales en variedades tempranas.
- Alto consumo de N, P, K. Riego frecuente necesario.
- Altura: 20-30 cm. Color dominante: verde intenso oscuro.

## QTL fw2.2 — Peso del fruto
- Localización: cromosoma 2, posición ~24.5 Mb
- Efecto: aumento del peso del fruto en +30%
- Variedad beef/Heinz asociada: fruto grande, carnoso, pocas semillas.
- Morfología planta: porte indeterminado, entrenudos largos.

## QTL lcy-b — Licopeno
- Localización: cromosoma 6, posición ~36.8 Mb
- Efecto: aumento del contenido en licopeno (color rojo intenso)
- Fruto de color rojo muy vivo en madurez. Variedad cherry o industrial.

## QTL Mi-1.2 — Resistencia nematodos
- Gen de resistencia a nematodos de la raíz. No afecta morfología aérea.

## QTL Tm-2a — Resistencia ToMV
- Resistencia al virus del mosaico del tomate. No afecta morfología.

## Descripción visual optimizada para imagen IA
- Semana 0: dark moist soil in a small terracotta pot, tiny brown tomato seed visible on surface, no plant structure above soil, macro photography, neutral white background
- Semana 1: very small tomato seedling, 5cm tall, two pale yellow-green oval cotyledons on thin translucent stem, in dark moist soil pot, studio white background, soft diffuse light
- Semana 2: tomato seedling 12cm tall, bright green stem, 3 pinnate true leaves with serrated edges, two smaller cotyledons below, in terracotta pot with dark soil, white studio background
- Semana 3: young tomato plant 25cm tall, robust green stem with visible fine hairs, 6 well-developed dark green pinnate leaves, bushy appearance, possible first axillary bud, terracotta pot, white background
`;

const SYSTEM_PROMPT = `Eres un agrónomo experto en tomate (Solanum lycopersicum). Basándote en el genoma de la variedad, las condiciones ambientales y el conocimiento agronómico proporcionado, predice cómo se verá la planta semana a semana.

Devuelve EXCLUSIVAMENTE un JSON válido con esta estructura exacta:

{
  "cultivar_descripcion": "string",
  "weeks": [
    {
      "week": 0,
      "bbch_stage": "string",
      "title": "string",
      "visual_prompt": "string en INGLÉS de 60-100 palabras describiendo cómo se ve la planta, optimizado para generador de imágenes. Incluir: altura, color, número de hojas, morfología, contexto (pot/soil), iluminación. Solo descripción visual concreta.",
      "biological_summary": "string en castellano de 1-2 frases",
      "estimated_height_cm": number,
      "scale_factor": number
    }
  ]
}

El visual_prompt debe ser en inglés, descriptivo y visual. scale_factor entre 0.1 y 1.0.`;

export async function generatePhenologyJson({ genomeSummary, location, sowingDate, weeks }, logger) {
  const env = await fetchWeatherForLocation(location, sowingDate, weeks);
  logger.debug('Condiciones ambientales calculadas');
  const environmentalAnalysis = assessEnvironmentalRisk(env, location);

  const userPrompt = `# Genoma analizado
${JSON.stringify(genomeSummary, null, 2)}

# Ubicación y condiciones
- Lugar: ${location.label} (lat ${location.lat}, lon ${location.lon})
- Fecha de siembra: ${sowingDate}
- Semanas a simular: ${weeks}
- Condiciones por semana: ${JSON.stringify(env, null, 2)}

# Conocimiento agronómico de referencia
${TOMATO_KNOWLEDGE}

# Tarea
Genera el JSON de fenología para las ${weeks} semanas (week 0 a week ${weeks - 1}).
Adapta los visual_prompts al cultivar detectado: ${genomeSummary.inferredCultivar}.
SOLO JSON, sin markdown, sin texto adicional.`;

  // Fallback: if API key is placeholder, return pre-built demo phenology
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key || key.includes('REPLACE_ME') || key.trim() === '') {
    logger.info('  · [DEMO MODE] ANTHROPIC_API_KEY no configurada — usando fenología pre-generada');
    return attachAnalysisBlocks(buildDemoPhenology(genomeSummary, weeks), genomeSummary, environmentalAnalysis);
  }

  logger.info('  · Llamando a Claude Sonnet...');
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text.trim();
    const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();

    try {
      const parsed = JSON.parse(cleanJson);
      logger.info(`  · Claude devolvió ${parsed.weeks.length} semanas`);
      return attachAnalysisBlocks(parsed, genomeSummary, environmentalAnalysis);
    } catch (e) {
      logger.error('JSON parse error, extrayendo JSON del response');
      const match = cleanJson.match(/\{[\s\S]*\}/);
      if (match) return attachAnalysisBlocks(JSON.parse(match[0]), genomeSummary, environmentalAnalysis);
      throw new Error('Claude no devolvió JSON válido');
    }
  } catch (err) {
    logger.error(`  · Claude API error (${err.status || err.message}) — usando fenología pre-generada`);
    return attachAnalysisBlocks(buildDemoPhenology(genomeSummary, weeks), genomeSummary, environmentalAnalysis);
  }
}

// Bloque "interacción genotipo × ambiente": el riesgo de plaga final combina
// la resistencia genética detectada con la presión climática real de la zona/fecha.
function buildCombinedPestRisk(genomeSummary, environmentalAnalysis) {
  const resistenceTraits = new Set(
    (genomeSummary.geneticAnalysis?.resistencia_genetica?.qtls || []).map(q => q.trait)
  );
  const hasResistance = resistenceTraits.size > 0;

  return environmentalAnalysis.weeks.map(w => {
    const climatePressure = w.climate_risk_reasons.some(r => r.includes('hongos')) ? 'media' : 'baja';
    let final_risk = 'bajo';
    if (climatePressure === 'media' && !hasResistance) final_risk = 'alto';
    else if (climatePressure === 'media' && hasResistance) final_risk = 'medio';
    else if (climatePressure === 'baja' && !hasResistance) final_risk = 'medio';

    return {
      week: w.week,
      final_risk,
      genetic_resistance_applied: hasResistance ? Array.from(resistenceTraits) : [],
      climate_pressure: climatePressure
    };
  });
}

function attachAnalysisBlocks(phenologyJson, genomeSummary, environmentalAnalysis) {
  return {
    ...phenologyJson,
    environmentalAnalysis,
    combinedAnalysis: {
      pest_risk: buildCombinedPestRisk(genomeSummary, environmentalAnalysis)
    }
  };
}

function buildDemoPhenology(genomeSummary, weeks) {
  const cultivar = genomeSummary.inferredCultivar || 'Variedad comercial estándar';
  const allWeeks = [
    {
      week: 0, bbch_stage: '05-09', title: 'Germinación',
      visual_prompt: 'dark moist potting soil in small terracotta pot, tiny brown tomato seed with white radicle emerging, no plant structure above soil, macro photography, neutral white studio background, soft diffuse lighting, botanical scientific illustration style',
      biological_summary: 'La semilla absorbe agua e inicia la germinación. La radícula emerge hacia el suelo.',
      estimated_height_cm: 0, scale_factor: 0.05
    },
    {
      week: 1, bbch_stage: '10-11', title: 'Plántula con cotiledones',
      visual_prompt: 'tiny tomato seedling 5cm tall with two small pale yellow-green oval cotyledons on thin translucent pale green stem, emerging from dark moist soil in small terracotta pot, white studio background, soft top lighting, botanical scientific illustration style, single plant centered',
      biological_summary: 'Los cotiledones se despliegan y capturan luz solar. Inicio de fotosíntesis activa.',
      estimated_height_cm: 5, scale_factor: 0.15
    },
    {
      week: 2, bbch_stage: '12-14', title: 'Primeras hojas verdaderas',
      visual_prompt: 'young tomato plant 12cm tall with bright green main stem, three pinnate true leaves with serrated leaflets and fine glandular hairs, two smaller yellow cotyledons at base, planted in terracotta pot with dark moist soil, white neutral studio background, soft diffuse lighting, botanical scientific illustration style',
      biological_summary: 'Emergen las primeras hojas verdaderas pinnadas. La fotosíntesis se vuelve plenamente activa.',
      estimated_height_cm: 12, scale_factor: 0.40
    },
    {
      week: 3, bbch_stage: '15-19', title: 'Crecimiento vegetativo activo',
      visual_prompt: 'young tomato plant 25cm tall with robust dark green hairy main stem, six well-developed dark green pinnate leaves with serrated edges, small axillary bud visible, bushy healthy vigorous appearance, terracotta pot with moist dark soil, white neutral studio background, professional botanical photography style, single plant centered',
      biological_summary: `Crecimiento vegetativo intenso con 5-7 hojas. Genotipo ${cultivar} manifiesta vigor característico.`,
      estimated_height_cm: 25, scale_factor: 0.80
    }
  ];
  return { cultivar_descripcion: cultivar, weeks: allWeeks.slice(0, weeks) };
}
