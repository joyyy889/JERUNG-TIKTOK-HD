#!/usr/bin/env node
import { optimizeVideo } from './optimizer.js';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('Usage: npm run optimize -- <input.mp4|input.mov> <output.mp4>');
  process.exit(2);
}

try {
  const result = await optimizeVideo(input, output);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
}
