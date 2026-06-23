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
  const geneticAnalysis = buildGeneticAnalysis(keyVariants);
  return { totalVariants, keyVariants, inferredCultivar, geneticAnalysis, species: 'Solanum lycopersicum' };
}

// Bloque "genética pura": rasgos fijados por el genoma, independientes de dónde se plante.
function buildGeneticAnalysis(keyVariants) {
  const byCategory = (cat) => {
    const seen = new Set();
    return keyVariants.filter(v => {
      const qtl = QTL_CATALOG.find(q => q.name === v.qtl_match);
      if (qtl?.category !== cat || seen.has(v.qtl_match)) return false;
      seen.add(v.qtl_match);
      return true;
    });
  };

  const produccionQtls = byCategory('produccion');
  const calidadQtls = byCategory('calidad_visual');
  const resistenciaQtls = byCategory('resistencia');

  return {
    produccion_potencial: {
      qtls: produccionQtls.map(v => ({ name: v.qtl_match, trait: v.trait, effect: v.effect })),
      resumen: produccionQtls.length
        ? `Potencial de rendimiento por encima del estándar (${produccionQtls.map(v => v.effect).join(', ')})`
        : 'Sin QTLs de rendimiento detectados — potencial estándar'
    },
    calidad_visual: {
      qtls: calidadQtls.map(v => ({ name: v.qtl_match, trait: v.trait, effect: v.effect })),
      resumen: calidadQtls.length
        ? `Rasgos visuales diferenciados: ${calidadQtls.map(v => `${v.trait} (${v.effect})`).join(', ')}`
        : 'Sin QTLs de calidad visual detectados — fenotipo estándar'
    },
    resistencia_genetica: {
      qtls: resistenciaQtls.map(v => ({ name: v.qtl_match, trait: v.trait, effect: v.effect })),
      resumen: resistenciaQtls.length
        ? `Resistencias detectadas: ${resistenciaQtls.map(v => v.trait.replace('resistencia_', '').replace('tolerancia_', '')).join(', ')}`
        : 'Sin resistencias genéticas conocidas detectadas'
    }
  };
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
