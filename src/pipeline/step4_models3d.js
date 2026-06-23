import { fal } from '@fal-ai/client';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

fal.config({ credentials: config.falKey });

const FAL_AVAILABLE = config.falKey && !config.falKey.includes('REPLACE_ME');

export async function generate3DModels(imagePaths, runDir, logger) {
  if (!FAL_AVAILABLE) {
    logger.info('  · [DEMO MODE] FAL_KEY no configurada — saltando generación 3D');
    return imagePaths.map(({ week }) => ({ week, path: null }));
  }

  logger.info('  · Lanzando tareas Tripo en paralelo...');

  const tasks = imagePaths.map(async ({ week, url }) => {
    if (!url) {
      logger.error(`    ✗ Semana ${week} sin URL de imagen, saltando 3D`);
      return { week, path: null };
    }
    try {
      const result = await fal.subscribe('tripo3d/tripo/v3.1/image-to-3d', {
        input: {
          image_url: url,
          texture: 'standard',
          pbr: true,
          face_limit: 50000,
          orientation: 'default'
        },
        logs: false
      });

      const glbUrl = result.data.model_mesh.url;
      const glbRes = await fetch(glbUrl);
      const buffer = Buffer.from(await glbRes.arrayBuffer());
      const localPath = path.join(runDir, `week_${week}.glb`);
      await writeFile(localPath, buffer);
      logger.info(`    ✓ week_${week}.glb listo`);
      return { week, path: localPath };
    } catch (err) {
      logger.error(`    ✗ week_${week} 3D falló: ${err.message}`);
      return { week, path: null };
    }
  });

  return await Promise.all(tasks);
}
