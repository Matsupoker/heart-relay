# ナレーション v2: 文ごとに pyopenjtalk で生成し、文間に無音を入れて 1 カット 1 wav にまとめる。
# 文ごとの開始・終了秒を timing.json に出す（字幕の同期に使う）。
# 使い方: python3 gen_narration_v2.py narration_v2.json <out dir> [speed=1.05] [gap_sec=0.45]
import json, sys, wave, os
import numpy as np, pyopenjtalk
src, out = sys.argv[1], sys.argv[2]
speed = float(sys.argv[3]) if len(sys.argv) > 3 else 1.05
gap = float(sys.argv[4]) if len(sys.argv) > 4 else 0.45
lead = 0.25
os.makedirs(out, exist_ok=True)
items = json.load(open(src, encoding='utf-8'))
timing = {}
for it in items:
    parts = []; t = lead; sents = []
    sr = 48000
    for s in it['sentences']:
        x, sr = pyopenjtalk.tts(s, speed=speed)
        x = x / max(1.0, np.abs(x).max() / 26000)
        # 先頭・末尾の無音を詰める
        nz = np.where(np.abs(x) > 300)[0]
        if len(nz): x = x[max(0, nz[0] - int(0.05 * sr)): min(len(x), nz[-1] + int(0.12 * sr))]
        d = len(x) / sr
        sents.append({'text': s, 'start': round(t, 3), 'end': round(t + d, 3)})
        parts.append(np.zeros(int((gap if parts else lead) * sr))); parts.append(x)
        t = sents[-1]['end'] + gap
    parts.append(np.zeros(int(0.3 * sr)))
    y = np.concatenate(parts)
    p = os.path.join(out, f"nar_{it['id']}.wav")
    with wave.open(p, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(sr); f.writeframes(y.astype(np.int16).tobytes())
    total = len(y) / sr
    timing[it['id']] = {'cut': it['cut'], 'total': round(total, 3), 'sentences': sents}
    chars = sum(len(s) for s in it['sentences'])
    print(it['id'], it['cut'], round(total, 2), 's', round(chars / total, 1), 'chars/s')
json.dump(timing, open(os.path.join(out, 'timing.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
