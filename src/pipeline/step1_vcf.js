import { readFileSync } from 'node:fs';
import { config } from '../config.js';

const QTL_CATALOG = JSON.parse(readFileSync(config.qtlCatalogPath, 'utf-8'));
const TOLERANCE = 50000;

export async function parseVcf(vcfContent, logger) {
  const lines = vcfContent.split(/\r?\n/);
  let totalVariants = 0;
  const keyVariants = [];

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    totalVariants++;
    const [chrom, pos, _id, ref, alt] = line.split('\t');
    const position = parseInt(pos, 10);
    if (isNaN(position)) continue;

    for (const qtl of QTL_CATALOG) {
      if (qtl.chrom === chrom && Math.abs(qtl.pos - position) < TOLERANCE) {
        keyVariants.push({
          chrom, position, ref, alt,
          qtl_match: qtl.name,
          trait: qtl.trait,
          effect: qtl.effect
        });
        logger.debug(`Match QTL: ${qtl.name} (${qtl.trait}) en ${chrom}:${position}`);
      }
    }
  }

  const inferredCultivar = inferCultivar(keyVariants);
  return { totalVariants, keyVariants, inferredCultivar, species: 'Solanum lycopersicum' };
}

function inferCultivar(keyVariants) {
  const traits = new Set(keyVariants.map(v => v.trait));
  if (traits.has('peso_fruto') && keyVariants.some(v => v.qtl_match === 'fw2.2')) {
    return 'Tipo beef/Heinz (fruto grande)';
  }
  if (traits.has('licopeno') && !traits.has('peso_fruto')) {
    return 'Tipo cherry (fruto pequeño, alto licopeno)';
  }
  if (traits.has('tolerancia_sequia')) {
    return 'Variedad rústica/silvestre tolerante a sequía';
  }
  return 'Variedad comercial estándar';
}
