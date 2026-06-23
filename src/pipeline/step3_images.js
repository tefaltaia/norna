import { fal } from '@fal-ai/client';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

fal.config({ credentials: config.falKey });

const STYLE_SUFFIX = ", botanical scientific illustration style, single tomato plant centered, plain neutral white background, soft diffuse lighting, no shadows, three-quarter front view, clean professional, high detail";

const FAL_AVAILABLE = config.falKey && config.falKey.trim() !== '' && !config.falKey.includes('REPLACE_ME');

export async function generateImages(phenologyJson, runDir, logger) {
  if (!FAL_AVAILABLE) {
    logger.info('  · [DEMO MODE] FAL_KEY no configurada — saltando generación de imágenes');
    return phenologyJson.weeks.map(w => ({ week: w.week, path: null, url: null }));
  }

  const imagePaths = [];
  let previousImageUrl = null;

  for (const week of phenologyJson.weeks) {
    const fullPrompt = week.visual_prompt + STYLE_SUFFIX;
    logger.info(`  · Generando imagen semana ${week.week}...`);

    let result;
    try {
      if (previousImageUrl === null) {
        result = await fal.subscribe('fal-ai/flux/dev', {
          input: {
            prompt: fullPrompt,
            image_size: 'square_hd',
            num_inference_steps: 28,
            guidance_scale: 3.5,
            num_images: 1,
            enable_safety_checker: false
          },
          logs: false
        });
      } else {
        result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
          input: {
            prompt: fullPrompt,
            image_url: previousImageUrl,
            strength: 0.65,
            num_inference_steps: 28,
            guidance_scale: 3.5,
            num_images: 1
          },
          logs: false
        });
      }

      const generatedUrl = result.data.images[0].url;
      previousImageUrl = generatedUrl;

      const imgRes = await fetch(generatedUrl);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const localPath = path.join(runDir, `week_${week.week}.png`);
      await writeFile(localPath, buffer);
      imagePaths.push({ week: week.week, path: localPath, url: generatedUrl });
      logger.info(`    ✓ week_${week.week}.png guardada`);
    } catch (err) {
      logger.error(`    ✗ Imagen semana ${week.week} falló: ${err.message}`);
      // Create a placeholder path so pipeline continues
      const localPath = path.join(runDir, `week_${week.week}.png`);
      imagePaths.push({ week: week.week, path: localPath, url: null });
    }
  }

  return imagePaths;
}
