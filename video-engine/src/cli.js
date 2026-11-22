#!/usr/bin/env node
import { analyzeVideo, optimizeVideo } from './optimizer.js';
import { rebuildGopVideo } from './gop-engine.js';

const [, , commandOrInput, maybeInput, maybeOutput] = process.argv;
const isAnalyze = commandOrInput === 'analyze';
const isGop = commandOrInput === 'gop';
const input = (isAnalyze || isGop) ? maybeInput : commandOrInput;
const output = (isAnalyze || isGop) ? (isGop ? maybeOutput : null) : maybeInput;

if (!input || (!isAnalyze && !output)) {
  console.error('Usage:\n  npm run optimize -- <input.mp4|input.mov> <output.mp4>\n  npm run gop -- <input.mp4|input.mov> <output.mp4>\n  npm run analyze -- <input.mp4|input.mov>');
  process.exit(2);
}

try {
  const result = isAnalyze
    ? await analyzeVideo(input)
    : isGop
      ? await rebuildGopVideo(input, output)
      : await optimizeVideo(input, output);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
}
