import path from 'node:path';
import { createApp } from './app.ts';

const app = await createApp({ dataDir: process.env.DATA_DIR || path.resolve('data') });
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Listening on http://localhost:${port}`));
