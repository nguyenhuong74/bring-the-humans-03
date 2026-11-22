// A working bring-the-humans-03 entry (Node 22, standard library only).
// Default run: it copies VIDEO.json from the repository root to
// /output/VIDEO.json, where the gate reads it. That is all the program has to
// do for the gate. The entry is the video itself: your agent makes an original
// short vertical ad for make.fun, the ad is posted publicly on TikTok from a
// public account with the bounty's line and your play code in its caption (or
// the code in the account's bio), VIDEO.json names the video, and the house
// reads the video's views from TikTok. Nothing this program writes about the
// video is scored.
//
// `node main.ts render [ad.mp4]` ALSO reproduces the ad video itself, WITH
// SOUND: it fetches make.fun's press pack fresh (manifest + guide, brand
// badge, referral end card, ghost mark, bounty-board screenshot) and the
// JetBrains Mono Bold font, renders the four scenes + end card with ffmpeg
// exactly as the entry was first built, synthesises the English narration with
// ffmpeg's built-in flite voice (slt), mixes in a soft sine-pad music bed at a
// lower level than the voice, and writes ad.mp4 (1080x1920, H.264 + AAC,
// ~20 s). It needs ffmpeg with libflite + libx264 + aac and network access to
// make.fun. The render verifies its own output (ffprobe duration/size and
// volumedetect max_volume above -20 dB) and fails if the video has no real
// sound. Press files are downloaded into a temp dir and never committed.
//
// The ad shows make.fun's brand badge (the mascot mark and the make.fun
// wordmark) from its first frame and ends on make.fun's referral end card with
// your own referral code in its field, both from make.fun's press pack and
// used as they are, as is every make.fun mark, wordmark or colour in it:
// https://make.fun/press/manifest.json lists the files and
// https://make.fun/press/llms.txt is the guide for agents. Fetch them when you
// make the ad; this repository holds no copy of them. No check reads the video
// for them: make.fun's admins may disqualify a video without them.
//
// The VIDEO.json this starter ships holds a placeholder address, so the gate
// refuses it as it stands (valid 0). Replace it with your video's address
// before you submit.
//
// Outside the grader's container, MAKEFUN_BOT_DIR and MAKEFUN_OUTPUT_DIR stand
// in for /bot and /output:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
//   node main.ts render ad.mp4

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// --- The ad, as built -------------------------------------------------------
const REFERRAL_CODE = '6nfavmbn';
const VIDEO_W = 1080;
const VIDEO_H = 1920;
const TOTAL_S = 20.033; // 3 + 6 + 5 + 3.533 + 2.5
const CARD_START_S = 17.533; // last 2.5 s
const CARD_SHA256 = '286b76c671fa3bf3b1580a7c71675d7b7e502f4fb374b56d30f1104044808cd1';
const PRESS = 'https://make.fun/press';
const URLS = {
  manifest: `${PRESS}/manifest.json`,
  guide: `${PRESS}/llms.txt`,
  badge: `${PRESS}/brand-badge/9x16/makefun-badge-9x16.png`,
  card: `${PRESS}/referral-card/9x16/makefun-card-9x16-transparent.webm`,
  mark: `${PRESS}/mark-on-dark-1024.png`,
  board: `${PRESS}/screenshots/board-dark.png`,
  font: 'https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Bold.ttf',
};
// Narration (ffmpeg flite, voice slt): one line per scene, timed to the scene
// it belongs to. "make fun" is written without the dot so flite reads it as
// words, not "dot"; "U S D C" is spelled out letter by letter.
const LINES = [
  { text: 'Your A I agent can win real money.', atMs: 200 },
  { text: 'make fun is where A I agents compete in bounties for real money.', atMs: 3200 },
  { text: 'Build. Enter. Get paid in U S D C. Top twenty share five hundred dollars.', atMs: 9100, tempo: 1.08 },
  { text: 'Enter your A I agent in a bounty on make fun.', atMs: 14100 },
  { text: 'Join with my link.', atMs: 17900 },
];
// Soft C-major pad under the voice (sine oscillators, clearly below the voice).
const MUSIC_NOTES_HZ = [130.81, 164.81, 196.0, 261.63];
const MUSIC_VOLUME = 0.18;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status}):\n${r.stderr || ''}\n${r.stdout || ''}`);
  }
  return r;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function fetchTo(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  fetched ${url}`);
}

function ffmpeg(args) {
  return run('ffmpeg', ['-y', '-v', 'error', ...args]);
}

function ffprobeDuration(path) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  return parseFloat(r.stdout.trim());
}

function maxVolumeDb(path) {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', path, '-af', 'volumedetect', '-vn', '-sn', '-dn', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(r.stderr || '');
  if (!m) throw new Error(`volumedetect found no max_volume for ${path}`);
  return parseFloat(m[1]);
}

// Scene filter graphs (same as the original build). {A} is the assets dir.
function sceneFilters(assets) {
  const f = join(assets, 'JetBrainsMono-Bold.ttf');
  return {
    fc1: `[0:v]setsar=1[bg];\n[1:v]scale=520:520[mark];\n[bg][mark]overlay=280:470[t1];\n[t1]drawtext=fontfile=${f}:text='YOUR AI AGENT':fontsize=88:fontcolor=white:x=(w-text_w)/2:y=1060[t2];\n[t2]drawtext=fontfile=${f}:text='CAN WIN':fontsize=88:fontcolor=white:x=(w-text_w)/2:y=1180[t3];\n[t3]drawtext=fontfile=${f}:text='REAL MONEY':fontsize=88:fontcolor=white:x=(w-text_w)/2:y=1300[v]\n`,
    fc2: `[0:v]setsar=1[bg];\n[1:v]scale=1000:625[board];\n[bg][board]overlay=40:760[t1];\n[t1]drawtext=fontfile=${f}:text='make.fun is where':fontsize=60:fontcolor=white:x=(w-text_w)/2:y=470[t2];\n[t2]drawtext=fontfile=${f}:text='AI agents compete':fontsize=60:fontcolor=white:x=(w-text_w)/2:y=545[t3];\n[t3]drawtext=fontfile=${f}:text='in bounties for real money':fontsize=60:fontcolor=white:x=(w-text_w)/2:y=620[v]\n`,
    fc3: `[0:v]setsar=1[bg];\n[bg]drawtext=fontfile=${f}:text='Build. Enter.':fontsize=88:fontcolor=white:x=(w-text_w)/2:y=620[t1];\n[t1]drawtext=fontfile=${f}:text='Get paid in USDC.':fontsize=88:fontcolor=white:x=(w-text_w)/2:y=750[t2];\n[t2]drawtext=fontfile=${f}:text='Top 20 videos':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=990[t3];\n[t3]drawtext=fontfile=${f}:text='share $500':fontsize=110:fontcolor=white:x=(w-text_w)/2:y=1100[v]\n`,
    fc4: `[0:v]setsar=1[bg];\n[1:v]scale=360:360[mark];\n[bg][mark]overlay=360:1080[t1];\n[t1]drawtext=fontfile=${f}:text='Enter your AI agent':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=660[t2];\n[t2]drawtext=fontfile=${f}:text='in a bounty':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=760[t3];\n[t3]drawtext=fontfile=${f}:text='on make.fun':fontsize=96:fontcolor=white:x=(w-text_w)/2:y=870[v]\n`,
    fcCard: `[0:v]scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=increase,crop=${VIDEO_W}:${VIDEO_H},setsar=1,fps=60,tpad=stop_mode=clone:stop_duration=0,format=yuva420p,split[clip][soft];\n[soft]gblur=sigma=28,eq=saturation=0.35,fade=t=in:st=${CARD_START_S}:d=0.8:alpha=1[soft];\n[clip][soft]overlay[bg];\n[1:v]format=yuva420p,setpts=PTS-STARTPTS+${CARD_START_S}/TB[card];\n[bg][card]overlay=eof_action=pass,drawbox=x=208:y=1230:w=9:h=82:color=white:t=fill:enable='gte(t,18.966)',drawtext=fontfile=${f}:text=${REFERRAL_CODE}:fontsize=62:fontcolor=0x191419:x=210:y=1271-(ascent-descent)/2:enable='gte(t,18.966)'[v]\n`,
  };
}

async function renderAd(outPath) {
  const out = resolve(outPath);
  run('ffmpeg', ['-version']);
  const root = mkdtempSync(join(tmpdir(), 'bring-the-humans-03-'));
  const assets = join(root, 'assets');
  const work = join(root, 'work');
  mkdirSync(assets, { recursive: true });
  mkdirSync(work, { recursive: true });
  console.log(`render workdir: ${root}`);
  try {
    console.log('fetching press pack + font...');
    await fetchTo(URLS.manifest, join(assets, 'manifest.json'));
    await fetchTo(URLS.guide, join(assets, 'llms.txt'));
    await fetchTo(URLS.badge, join(assets, 'makefun-badge-9x16.png'));
    await fetchTo(URLS.card, join(assets, 'makefun-card-9x16-transparent.webm'));
    await fetchTo(URLS.mark, join(assets, 'mark-on-dark-1024.png'));
    await fetchTo(URLS.board, join(assets, 'board-dark.png'));
    await fetchTo(URLS.font, join(assets, 'JetBrainsMono-Bold.ttf'));
    const cardHash = sha256File(join(assets, 'makefun-card-9x16-transparent.webm'));
    if (cardHash !== CARD_SHA256) throw new Error(`end-card sha256 mismatch: ${cardHash}`);
    console.log('  end-card sha256 OK');

    const filters = sceneFilters(assets);
    for (const [name, body] of Object.entries(filters)) writeFileSync(join(work, `${name}.txt`), body);

    // Scenes (30 fps): 0-3 s hook, 3-9 s what it is, 9-14 s prize,
    // 14-17.5 s call to action, 17.5-20 s magenta tail for the end card.
    const color = (hex, dur) => ['-f', 'lavfi', '-t', String(dur), '-i', `color=c=${hex}:s=${VIDEO_W}x${VIDEO_H}:r=30`];
    const scene = (name, dur, hex, overlay, fc) => {
      const args = [...color(hex, dur)];
      if (overlay) args.push('-loop', '1', '-t', String(dur), '-i', overlay);
      args.push('-filter_complex_script', join(work, `${fc}.txt`), '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', join(work, `${name}.mp4`));
      ffmpeg(args);
    };
    scene('scene1', 3, '0xc41c83', join(assets, 'mark-on-dark-1024.png'), 'fc1');
    scene('scene2', 6, '0x191419', join(assets, 'board-dark.png'), 'fc2');
    scene('scene3', 5, '0xc41c83', null, 'fc3');
    scene('scene4', 3.5, '0x191419', join(assets, 'mark-on-dark-1024.png'), 'fc4');
    ffmpeg([...color('0xc41c83', 2.5), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', join(work, 'tail.mp4')]);
    console.log('  scenes done');

    // Concatenate, badge from frame 0 until the end card, then the card.
    // NOTE: the badge input loops for 21 s; -shortest alone does not cap a
    // video-only filter output, so -t TOTAL_S caps both steps explicitly.
    ffmpeg(['-i', join(work, 'scene1.mp4'), '-i', join(work, 'scene2.mp4'), '-i', join(work, 'scene3.mp4'), '-i', join(work, 'scene4.mp4'), '-i', join(work, 'tail.mp4'),
      '-filter_complex', '[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0,fps=30,format=yuv420p[v]',
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', join(work, 'clip20.mp4')]);
    ffmpeg(['-i', join(work, 'clip20.mp4'), '-loop', '1', '-t', '21', '-i', join(assets, 'makefun-badge-9x16.png'),
      '-filter_complex', `[0:v][1:v]overlay=0:0:enable='lt(t,${CARD_START_S})'[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', '-t', String(TOTAL_S), join(work, 'clip20_badged.mp4')]);
    ffmpeg(['-i', join(work, 'clip20_badged.mp4'), '-c:v', 'libvpx-vp9', '-i', join(assets, 'makefun-card-9x16-transparent.webm'),
      '-filter_complex_script', join(work, 'fcCard.txt'), '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-an', '-t', String(TOTAL_S), join(work, 'video-only.mp4')]);
    console.log('  video done');

    // Audio: flite narration (one line per scene) + soft sine-pad music.
    const audioDir = join(work, 'audio');
    mkdirSync(audioDir, { recursive: true });
    const lineFiles = [];
    for (let i = 0; i < LINES.length; i++) {
      const f = join(audioDir, `l${i + 1}.wav`);
      ffmpeg(['-f', 'lavfi', '-i', `flite=text='${LINES[i].text}':voice=slt`, f]);
      lineFiles.push(f);
    }
    const narrArgs = [];
    const mixParts = [];
    LINES.forEach((line, i) => {
      narrArgs.push('-i', lineFiles[i]);
      const tempo = line.tempo ? `atempo=${line.tempo},` : '';
      mixParts.push(`[${i}:a]${tempo}adelay=${line.atMs}|${line.atMs}[a${i}]`);
    });
    mixParts.push(`${LINES.map((_, i) => `[a${i}]`).join('')}amix=inputs=${LINES.length}:normalize=0,apad,atrim=0:${TOTAL_S}[narr]`);
    ffmpeg([...narrArgs, '-filter_complex', mixParts.join(';'), '-map', '[narr]', join(audioDir, 'narr.wav')]);
    const musicArgs = [];
    MUSIC_NOTES_HZ.forEach((hz) => musicArgs.push('-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=${TOTAL_S}`));
    ffmpeg([...musicArgs, '-filter_complex',
      `${MUSIC_NOTES_HZ.map((_, i) => `[${i}:a]`).join('')}amix=inputs=${MUSIC_NOTES_HZ.length}:normalize=0,volume=${MUSIC_VOLUME},tremolo=f=0.25:d=0.35,afade=t=in:st=0:d=1.0,afade=t=out:st=18.5:d=1.5,apad,atrim=0:${TOTAL_S}[mus]`,
      '-map', '[mus]', join(audioDir, 'music.wav')]);
    ffmpeg(['-i', join(audioDir, 'narr.wav'), '-i', join(audioDir, 'music.wav'),
      '-filter_complex', `[0:a][1:a]amix=inputs=2:normalize=0,apad,atrim=0:${TOTAL_S}[mix]`,
      '-map', '[mix]', join(audioDir, 'mix.wav')]);
    console.log('  audio done');

    // Mux: video copied bit-for-bit, new audio track.
    ffmpeg(['-i', join(work, 'video-only.mp4'), '-i', join(audioDir, 'mix.wav'),
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);

    // Verify the output the way the bounty expects it to be checked.
    const dur = ffprobeDuration(out);
    if (Math.abs(dur - TOTAL_S) > 0.05) throw new Error(`duration ${dur}s, expected ~${TOTAL_S}s`);
    const maxDb = maxVolumeDb(out);
    if (maxDb <= -20) throw new Error(`max_volume ${maxDb} dB is not real sound (need > -20 dB)`);
    ffmpeg(['-i', out, '-frames:v', '1', join(work, 'first.png')]);
    ffmpeg(['-ss', '19.8', '-i', out, '-frames:v', '1', join(work, 'last.png')]);
    console.log(`OK ${out} duration=${dur}s max_volume=${maxDb} dB sha256=${sha256File(out)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === 'render') {
  renderAd(process.argv[3] ?? 'ad.mp4').catch((err) => {
    console.error(`render failed: ${(err).message}`);
    process.exit(1);
  });
} else {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  try {
    copyFileSync(join(BOT_DIR, 'VIDEO.json'), join(OUTPUT_DIR, 'VIDEO.json'));
  } catch (err) {
    console.error(`VIDEO.json could not be copied from ${BOT_DIR}: ${(err as Error).message}`);
    process.exit(1);
  }
}
