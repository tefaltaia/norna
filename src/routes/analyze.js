import express from 'express';
import { runPipeline } from '../pipeline/orchestrator.js';

const router = express.Router();

router.post('/analyze', async (req, res) => {
  try {
    const { vcf_content, vcf_filename, location, sowing_date, weeks = 4 } = req.body;

    if (!vcf_content) return res.status(400).json({ error: 'vcf_content requerido' });
    if (!location?.lat || !location?.lon) return res.status(400).json({ error: 'location requerida' });

    const { runId } = await runPipeline({
      vcfContent: vcf_content,
      location,
      sowingDate: sowing_date || new Date().toISOString().slice(0, 10),
      weeks: parseInt(weeks, 10) || 4
    });

    res.json({ run_id: runId, stream_url: `/api/runs/${runId}/stream` });
  } catch (err) {
    console.error('Error en /analyze:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
