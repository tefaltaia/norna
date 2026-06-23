import { v4 as uuidv4 } from 'uuid';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseVcf } from './step1_vcf.js';
import { generatePhenologyJson } from './step2_rag.js';
import { generateImages } from './step3_images.js';
import { generate3DModels } from './step4_models3d.js';
import { buildFiwarePayloads } from './step5_fiware.js';
import { createLogger } from '../services/logger.js';
import { config } from '../config.js';

export async function runPipeline({ vcfContent, location, sowingDate, weeks }) {
  const runId = `r_${uuidv4().slice(0, 8)}`;
  const runDir = path.join(config.runsDir, runId);
  await mkdir(runDir, { recursive: true });

  const logger = createLogger(runId);
  logger.info(`🌱 Run iniciado — ${runId}`, { runId, weeks, location });

  await writeFile(path.join(runDir, 'input.vcf'), vcfContent);
  await writeFile(path.join(runDir, 'metadata.json'),
    JSON.stringify({ runId, location, sowingDate, weeks, startedAt: new Date().toISOString() }, null, 2));

  // Fire-and-forget pipeline
  (async () => {
    try {
      logger.info('🧬 [1/5] Parseando archivo VCF...');
      const genomeSummary = await parseVcf(vcfContent, logger);
      await writeFile(path.join(runDir, 'step1_genome.json'), JSON.stringify(genomeSummary, null, 2));
      logger.info(`✓ VCF parseado: ${genomeSummary.totalVariants} variantes, ${genomeSummary.keyVariants.length} de interés (${genomeSummary.inferredCultivar})`);

      logger.info('📚 [2/5] Consultando base de conocimiento + Claude...');
      const phenologyJson = await generatePhenologyJson({ genomeSummary, location, sowingDate, weeks }, logger);
      await writeFile(path.join(runDir, 'step2_phenology.json'), JSON.stringify(phenologyJson, null, 2));
      logger.info(`✓ Fenología generada para ${weeks} semanas`);

      logger.info('🎨 [3/5] Generando imágenes con fal.ai FLUX...');
      const imagePaths = await generateImages(phenologyJson, runDir, logger);
      logger.info(`✓ ${imagePaths.filter(i => i.url).length}/${imagePaths.length} imágenes generadas`);

      logger.info('🧊 [4/5] Generando modelos 3D con fal.ai Tripo...');
      const glbPaths = await generate3DModels(imagePaths, runDir, logger);
      logger.info(`✓ ${glbPaths.filter(g => g.path).length}/${glbPaths.length} modelos GLB generados`);

      logger.info('📡 [5/5] Construyendo payloads NGSI-LD FIWARE...');
      const fiwareEntities = await buildFiwarePayloads({ runId, location, sowingDate, phenologyJson, genomeSummary });
      await writeFile(path.join(runDir, 'step5_fiware.jsonld'), JSON.stringify(fiwareEntities, null, 2));
      logger.info(`✓ ${fiwareEntities.length} entidades NGSI-LD generadas`);

      logger.info('🎉 Pipeline completado. Visor listo.');
      logger.event('DONE', { runId });
    } catch (err) {
      logger.error(`💥 Pipeline falló: ${err.message}`);
      logger.event('ERROR', { error: err.message });
    }
  })();

  return { runId };
}
