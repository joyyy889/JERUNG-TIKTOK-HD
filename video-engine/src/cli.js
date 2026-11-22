#!/usr/bin/env node
import { analyzeVideo, optimizeVideo } from './optimizer.js';

const [, , commandOrInput, maybeInput, maybeOutput] = process.argv;
const isAnalyze = commandOrInput === 'analyze';
const input = isAnalyze ? maybeInput : commandOrInput;
const output = isAnalyze ? null : maybeInput;

if (!input || (!isAnalyze && !output)) {
  console.error('Usage:\n  npm run optimize -- <input.mp4|input.mov> <output.mp4>\n  npm run analyze -- <input.mp4|input.mov>');
  process.exit(2);
}

try {
  const result = isAnalyze
    ? await analyzeVideo(input)
    : await optimizeVideo(input, output);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
}
