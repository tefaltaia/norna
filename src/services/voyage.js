import { config } from '../config.js';

export async function embedQuery(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.voyageApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'voyage-3-large', input: [text], input_type: 'query' })
  });
  if (!res.ok) throw new Error(`Voyage API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}
